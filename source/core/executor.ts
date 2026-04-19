
import { randomUUID, createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { stat, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { type Readable } from 'node:stream'
import type {
  ResolvedConfig,
  BackupResult,
  RestoreInput,
  RestoreResult,
  DumpOptions,
} from './types.js'
import {
  BackupExecutionError,
  type BackupErrorCode,
} from './types.js'
import type {
  BackupExecutor,
  BackupExecutorOptions,
  DatabaseDriver,
  StorageDriver,
} from './interfaces.js'
import { createLogger, type Logger } from './logger.js'

const DEFAULT_RETRY_CONFIG = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  backoffMultiplier: 2,
}

export { BackupExecutionError } from './types.js'

// ─── Internal types ────────────────────────────────────────────────────────────

interface StagedFile {
  tempDir: string
  filePath: string
  size: number
}

interface BackupContext {
  log: Logger
  config: ResolvedConfig
  result: BackupResult
  dbDriver: DatabaseDriver
  storageDriver: StorageDriver
  stagedFile?: StagedFile
}

// ─── Executor ──────────────────────────────────────────────────────────────────

export class DefaultBackupExecutor implements BackupExecutor {
  private retryConfig = DEFAULT_RETRY_CONFIG
  private logger: Logger

  constructor(
    private options: BackupExecutorOptions,
    logger?: Logger
  ) {
    this.logger = logger ?? createLogger()
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async execute(config: ResolvedConfig, outputKey?: string, dryRun = false): Promise<BackupResult> {
    const ctx = this.initBackupContext(config, outputKey)

    try {
      await this.stageConnect(ctx)
      await this.stageDump(ctx)
      await this.stageChecksum(ctx)

      if (dryRun) {
        ctx.log.info('Dry-run completed: dump is valid', {
          key: ctx.result.fileKey,
          checksum: ctx.result.checksum,
          size: ctx.result.size,
        })
        return this.finalizeBackup(ctx, 'dry-run-completed')
      }

      await this.stageUpload(ctx)
      return this.finalizeBackup(ctx, 'completed')

    } catch (err) {
      return this.finalizeBackup(ctx, 'failed', err)
    } finally {
      await this.cleanupBackup(ctx)
    }
  }

  async restore(config: ResolvedConfig, input: RestoreInput): Promise<RestoreResult> {
    const log = this.logger.child(randomUUID())

    const result: RestoreResult = {
      id: randomUUID(),
      taskName: input.backupKey,
      status: 'running',
      startTime: new Date(),
      fileKey: input.backupKey,
    }

    const dbDriver = this.options.databaseDriverFactory.create(config)
    const storageDriver = this.options.storageDriverFactory.create(config)
    let tempDir: string | undefined

    try {
      const backupInfo = this.parseBackupKey(input.backupKey)
      const targetDatabase = input.database ?? backupInfo.database ?? config.config.source.database

      log.info('Starting restore', { backupKey: input.backupKey, targetDatabase })

      // Stage 1: Download backup file to a temp location
      log.info('Downloading backup from storage')
      tempDir = await mkdtemp(join(tmpdir(), 'database-restore-'))
      const ext = input.backupKey.endsWith('.gz') ? '.sql.gz' : '.sql'
      const localFilePath = join(tempDir, `restore${ext}`)
      const backupStream = await storageDriver.download(input.backupKey)
      await this.downloadToFile(backupStream, localFilePath)
      log.info('Backup downloaded', { localFilePath })

      // Stage 2: Restore from the local file
      log.info('Restoring database', { database: targetDatabase })
      const restoreOptions = {
        database: targetDatabase,
        tables: input.tables,
        clean: input.clean,
        create: input.create,
      }

      await dbDriver.restore(restoreOptions, localFilePath)

      return this.finalizeRestore(result, log, 'completed')

    } catch (err) {
      return this.finalizeRestore(result, log, 'failed', err)
    } finally {
      if (tempDir) {
        try {
          await rm(tempDir, { recursive: true, force: true })
        } catch (cleanupError) {
          log.warn('Failed to remove restore temp files', {
            error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          })
        }
      }

      try {
        await dbDriver.close()
      } catch (closeError) {
        log.warn('Failed to close database driver', {
          error: closeError instanceof Error ? closeError.message : String(closeError),
        })
      }
    }
  }

  // ── Backup stages ──────────────────────────────────────────────────────────

  private async stageConnect(ctx: BackupContext): Promise<void> {
    const { source } = ctx.config.config
    ctx.log.info('Testing database connection', { type: source.type, database: source.database })

    const connected = await ctx.dbDriver.testConnection()
    if (!connected) {
      throw new BackupExecutionError('CONNECTION_FAILED', ctx.result.taskName, 'Database connection failed')
    }

    ctx.log.info('Database connection successful')
  }

  private async stageDump(ctx: BackupContext): Promise<void> {
    const { source, destination } = ctx.config.config
    const dumpOptions: DumpOptions = {
      database: source.database,
      tables: source.tables ?? [],
      compression: destination.type === 's3' ? 'gzip' : undefined,
    }

    ctx.result.tables = source.tables ?? []

    ctx.stagedFile = await this.withRetry(
      () => this.dumpToTempFile(ctx.dbDriver, dumpOptions, ctx.log),
      'DUMP_FAILED',
      ctx.log
    )

    ctx.result.size = ctx.stagedFile.size
  }

  private async stageChecksum(ctx: BackupContext): Promise<void> {
    const { filePath } = ctx.stagedFile!

    const checksum = await this.withRetry(
      () => this.computeFileChecksum(filePath),
      'CHECKSUM_FAILED',
      ctx.log
    )

    ctx.result.checksum = checksum
    ctx.log.info('Checksum computed', { checksum })
  }

  private async stageUpload(ctx: BackupContext): Promise<void> {
    const { filePath, size } = ctx.stagedFile!
    const fileKey = ctx.result.fileKey!

    ctx.log.info('Uploading backup', {
      destination: ctx.config.config.destination.type,
      key: fileKey,
      size,
    })

    const uploadResult = await this.withRetry(
      () => ctx.storageDriver.upload(filePath, fileKey, size),
      'UPLOAD_FAILED',
      ctx.log
    )

    ctx.log.info('Upload completed', { key: uploadResult.key, size: uploadResult.size })
  }

  // ── Lifecycle helpers ──────────────────────────────────────────────────────

  private initBackupContext(config: ResolvedConfig, outputKey?: string): BackupContext {
    const log = this.logger.child(randomUUID())

    return {
      log,
      config,
      result: {
        id: randomUUID(),
        taskName: config.config.name,
        status: 'running',
        startTime: new Date(),
        fileKey: outputKey ?? this.generateFileKey(config),
      },
      dbDriver: this.options.databaseDriverFactory.create(config),
      storageDriver: this.options.storageDriverFactory.create(config),
    }
  }

  private async finalizeBackup(
    ctx: BackupContext,
    status: BackupResult['status'],
    err?: unknown
  ): Promise<BackupResult> {
    const endTime = new Date()
    ctx.result.status = status
    ctx.result.endTime = endTime
    ctx.result.duration = Math.round((endTime.getTime() - ctx.result.startTime.getTime()) / 1000)

    if (err != null) {
      ctx.result.error = err instanceof Error ? err.message : String(err)
      ctx.log.error('Backup failed', {
        error: ctx.result.error,
        code: (err as BackupExecutionError).code,
      })
    } else if (status === 'completed') {
      ctx.log.info('Backup completed', {
        key: ctx.result.fileKey,
        size: ctx.result.size,
        duration: ctx.result.duration,
      })
    }

    if (status !== 'dry-run-completed') {
      await this.persistResult(ctx.result, ctx.log)
    }

    return ctx.result
  }

  private finalizeRestore(
    result: RestoreResult,
    log: Logger,
    status: RestoreResult['status'],
    err?: unknown
  ): RestoreResult {
    const endTime = new Date()
    result.status = status
    result.endTime = endTime
    result.duration = Math.round((endTime.getTime() - result.startTime.getTime()) / 1000)

    if (err != null) {
      result.error = err instanceof Error ? err.message : String(err)
      log.error('Restore failed', { error: result.error })
    } else {
      log.info('Restore completed', { backupKey: result.fileKey, duration: result.duration })
    }

    return result
  }

  private async persistResult(result: BackupResult, log: Logger): Promise<void> {
    if (!this.options.resultStore) return

    try {
      await this.options.resultStore.save(result)
    } catch (saveError) {
      log.warn('Failed to persist backup result', {
        error: saveError instanceof Error ? saveError.message : String(saveError),
      })
    }
  }

  private async cleanupBackup(ctx: BackupContext): Promise<void> {
    if (ctx.stagedFile) {
      try {
        await rm(ctx.stagedFile.tempDir, { recursive: true, force: true })
      } catch (cleanupError) {
        ctx.log.warn('Failed to remove temporary backup files', {
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        })
      }
    }

    try {
      await ctx.dbDriver.close()
    } catch (closeError) {
      ctx.log.warn('Failed to close database driver', {
        error: closeError instanceof Error ? closeError.message : String(closeError),
      })
    }
  }

  // ── File operations ────────────────────────────────────────────────────────

  private async dumpToTempFile(
    dbDriver: DatabaseDriver,
    dumpOptions: DumpOptions,
    log: Logger
  ): Promise<StagedFile> {
    const tempDir = await mkdtemp(join(tmpdir(), 'database-backup-'))
    const extension = dumpOptions.compression === 'gzip' ? '.sql.gz' : '.sql'
    const filePath = join(tempDir, `${randomUUID()}${extension}`)

    try {
      log.info('Starting database dump', { database: dumpOptions.database })
      await dbDriver.dump(dumpOptions, filePath)

      const { size } = await stat(filePath)
      if (size === 0) {
        throw new Error('Database dump produced no data')
      }

      log.info('Dump completed', { size, filePath })
      return { tempDir, filePath, size }
    } catch (error) {
      await rm(tempDir, { recursive: true, force: true })
      throw error
    }
  }

  private async downloadToFile(stream: Readable, destFilePath: string): Promise<void> {
    await pipeline(stream, createWriteStream(destFilePath))
  }

  private async computeFileChecksum(filePath: string): Promise<string> {
    const hash = createHash('sha256')

    for await (const chunk of createReadStream(filePath)) {
      hash.update(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }

    return `sha256:${hash.digest('hex')}`
  }

  // ── Retry ──────────────────────────────────────────────────────────────────

  private async withRetry<T>(
    fn: () => Promise<T>,
    errorCode: BackupErrorCode,
    log: Logger
  ): Promise<T> {
    let lastError: Error | undefined
    let delay = this.retryConfig.initialDelayMs

    for (let attempt = 1; attempt <= this.retryConfig.maxAttempts; attempt++) {
      try {
        return await fn()
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))

        if (attempt < this.retryConfig.maxAttempts) {
          log.warn('Retrying operation', {
            delay,
            attempt,
            maxAttempts: this.retryConfig.maxAttempts,
            error: lastError.message,
          })
          await this.sleep(delay)
          delay *= this.retryConfig.backoffMultiplier
        }
      }
    }

    throw new BackupExecutionError(errorCode, '', lastError?.message ?? 'Unknown error', lastError)
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  // ── Key generation ─────────────────────────────────────────────────────────

  private generateFileKey(config: ResolvedConfig, now = new Date()): string {
    const { source } = config.config
    const databaseName = this.sanitizePathSegment(source.database)
    const taskName = this.sanitizePathSegment(config.config.name)
    const [date] = now.toISOString().split('T')
    const time = now.toTimeString().split(' ')[0].replace(/:/g, '-')
    const extension = config.config.destination.type === 's3' ? 'sql.gz' : 'sql'

    return this.joinPathSegments(
      this.normalizePathPrefix(config.s3?.pathPrefix),
      source.type,
      databaseName,
      date,
      `${taskName}-${time}.${extension}`,
    )
  }

  private parseBackupKey(key: string): { database?: string; type?: string } {
    const segments = key.split('/').filter(Boolean)
    const flatDatePattern = /^\d{4}-\d{2}-\d{2}$/
    const nestedDatePattern = /^\d{4}$|^\d{2}$/

    if (segments.length >= 4 && flatDatePattern.test(segments[segments.length - 2] ?? '')) {
      return {
        type: segments[segments.length - 4],
        database: segments[segments.length - 3],
      }
    }

    if (
      segments.length >= 6
      && nestedDatePattern.test(segments[segments.length - 4] ?? '')
      && nestedDatePattern.test(segments[segments.length - 3] ?? '')
      && nestedDatePattern.test(segments[segments.length - 2] ?? '')
    ) {
      return {
        type: segments[segments.length - 6],
        database: segments[segments.length - 5],
      }
    }

    const basename = key.split('/').pop() ?? key
    const withoutExt = basename.replace(/\.(sql\.gz|sql)$/, '')
    const parts = withoutExt.split('-')

    return {
      type: parts[0],
      database: parts[1],
    }
  }

  private normalizePathPrefix(prefix?: string): string | undefined {
    const normalized = prefix?.replace(/^\/+|\/+$/g, '').trim()
    return normalized ? normalized : undefined
  }

  private joinPathSegments(...segments: Array<string | undefined>): string {
    return segments
      .map((segment) => segment?.trim())
      .filter((segment): segment is string => Boolean(segment))
      .join('/')
  }

  private sanitizePathSegment(value: string): string {
    return value
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-zA-Z0-9._-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'backup'
  }
}
export function createBackupExecutor(options: BackupExecutorOptions, logger?: Logger): BackupExecutor {
  return new DefaultBackupExecutor(options, logger)
}
