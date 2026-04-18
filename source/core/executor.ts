
import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'
import type { Readable } from 'node:stream'
import type {
  ResolvedConfig,
  BackupResult,
  RestoreInput,
  RestoreResult,
} from './types.js'
import type {
  BackupExecutor,
  BackupExecutorOptions,
  BackupErrorCode,
} from './interfaces.js'
import { createLogger, type Logger } from './logger.js'

const DEFAULT_RETRY_CONFIG = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  backoffMultiplier: 2,
}

export class BackupExecutionError extends Error {
  constructor(
    public readonly code: BackupErrorCode,
    public readonly taskName: string,
    message: string,
    public readonly cause?: Error
  ) {
    super(message)
    this.name = 'BackupExecutionError'
  }
}

export class DefaultBackupExecutor implements BackupExecutor {
  private retryConfig = DEFAULT_RETRY_CONFIG
  private logger: Logger

  constructor(
    private options: BackupExecutorOptions,
    logger?: Logger
  ) {
    this.logger = logger ?? createLogger()
  }

  /**
   * Execute backup
   */
  async execute(config: ResolvedConfig): Promise<BackupResult> {
    return this.executeTo(config)
  }

  /**
   * Execute backup with custom output key
   * @param dryRun If true, validates dump without uploading
   */
  async executeTo(config: ResolvedConfig, outputKey?: string, dryRun = false): Promise<BackupResult> {
    const requestId = randomUUID()
    const log = this.logger.child(requestId)

    const result: BackupResult = {
      id: randomUUID(),
      taskName: config.config.name,
      status: 'running',
      startTime: new Date(),
    }

    const effectiveConfig = this.prepareRuntimeConfig(config, result.startTime)
    const { source, destination } = effectiveConfig.config
    const databaseName = effectiveConfig.connection.database

    // Create database and storage drivers
    const dbDriver = this.options.databaseDriverFactory.create(effectiveConfig)
    const storageDriver = this.options.storageDriverFactory.create(effectiveConfig)

    try {
      // 1. Test connection
      log.info('Testing database connection', { type: source.type, database: databaseName })
      const connected = await dbDriver.testConnection()
      if (!connected) {
        throw new BackupExecutionError('CONNECTION_FAILED', config.config.name, 'Database connection failed')
      }
      log.info('Database connection successful')

      // 2. Generate file key
      const fileKey = outputKey ?? this.generateFileKey(effectiveConfig, result.startTime)
      result.fileKey = fileKey
      result.tables = source.tables ?? []

      // 3. Execute dump
      log.info('Starting database dump', { database: databaseName, tables: result.tables })
      const tables = source.tables ?? []
      const compression: 'gzip' | 'none' | undefined = destination.type === 's3' ? 'gzip' : undefined
      const dumpOptions = {
        database: databaseName,
        tables,
        compression,
      }
      const dumpStream = await this.withRetry(
        () => dbDriver.dump(dumpOptions),
        'DUMP_FAILED',
        log
      )
      log.info('Database dump completed')

      // 4. Compute checksum
      log.info('Computing checksum')
      const checksum = await this.computeChecksum(dumpStream)
      result.checksum = checksum
      log.info('Checksum computed', { checksum })

      // 5. Dry-run: validate without uploading
      if (dryRun) {
        result.status = 'dry-run-completed'
        result.endTime = new Date()
        result.duration = Math.round((result.endTime.getTime() - result.startTime.getTime()) / 1000)
        log.info('Dry-run completed: dump is valid', { checksum, key: fileKey })
        return result
      }

      // 6. Get fresh dump stream for upload (previous was consumed by checksum)
      const dumpStreamForUpload = await dbDriver.dump(dumpOptions)

      // 7. Upload to storage
      log.info('Uploading backup', { destination: destination.type, key: fileKey })
      const uploadResult = await this.withRetry(
        () => storageDriver.upload(dumpStreamForUpload, fileKey),
        'UPLOAD_FAILED',
        log
      )

      result.size = uploadResult.size
      result.status = 'completed'
      result.endTime = new Date()
      result.duration = Math.round((result.endTime.getTime() - result.startTime.getTime()) / 1000)

      log.info('Backup completed', {
        key: uploadResult.key,
        size: uploadResult.size,
        duration: result.duration
      })

      // 8. Save result
      if (this.options.resultStore) {
        await this.options.resultStore.save(result)
      }

      return result

    } catch (err) {
      result.status = 'failed'
      result.endTime = new Date()
      result.duration = Math.round((result.endTime.getTime() - result.startTime.getTime()) / 1000)
      result.error = err instanceof Error ? err.message : String(err)

      log.error('Backup failed', { error: result.error, code: (err as BackupExecutionError).code })

      // Save failed result
      if (this.options.resultStore) {
        await this.options.resultStore.save(result)
      }

      return result

    } finally {
      await dbDriver.close()
    }
  }

  /**
   * Execute restore
   */
  async restore(config: ResolvedConfig, input: RestoreInput): Promise<RestoreResult> {
    const requestId = randomUUID()
    const log = this.logger.child(requestId)

    const result: RestoreResult = {
      id: randomUUID(),
      taskName: input.backupKey,
      status: 'running',
      startTime: new Date(),
      fileKey: input.backupKey,
    }

    // Create database and storage drivers
    const dbDriver = this.options.databaseDriverFactory.create(config)
    const storageDriver = this.options.storageDriverFactory.create(config)

    try {
      // 1. Determine the target database and format from backup key
      const backupInfo = this.parseBackupKey(input.backupKey)
      const targetDatabase = input.database ?? backupInfo.database ?? config.connection.database

      log.info('Starting restore', {
        backupKey: input.backupKey,
        targetDatabase,
        compressed: input.backupKey.endsWith('.gz'),
      })

      // 2. Download backup from storage
      log.info('Downloading backup from storage')
      const backupStream = await storageDriver.download(input.backupKey)

      // 3. Decompress if gzip
      let restoreStream: Readable = backupStream
      if (input.backupKey.endsWith('.gz')) {
        log.info('Decompressing backup')
        const { spawn: spawnGzip } = await import('node:child_process')
        const gunzip = spawnGzip('gunzip', ['-c'], { stdio: ['pipe', 'pipe', 'pipe'] })
        backupStream.pipe(gunzip.stdin)
        gunzip.stderr.on('data', (data) => {
          console.error(`[gunzip] ${data.toString().trim()}`)
        })
        restoreStream = gunzip.stdout
      }

      // 4. Restore to database
      log.info('Restoring database', { database: targetDatabase })

      const restoreOptions = {
        backupKey: input.backupKey,
        database: targetDatabase,
        tables: input.tables,
        clean: input.clean,
        create: input.create,
        compressed: input.backupKey.endsWith('.gz'),
        format: (input.backupKey.includes('.sql.gz') ? 'plain' : 'custom') as 'plain' | 'custom',
      }

      const restoreInput = await dbDriver.restore(restoreOptions)
      restoreStream.pipe(restoreInput)

      // Wait for restore to complete
      await new Promise<void>((resolve, reject) => {
        restoreInput.on('finish', resolve)
        restoreInput.on('error', reject)
        restoreStream.on('error', reject)
      })

      result.status = 'completed'
      result.endTime = new Date()
      result.duration = Math.round((result.endTime.getTime() - result.startTime.getTime()) / 1000)

      log.info('Restore completed', {
        backupKey: input.backupKey,
        duration: result.duration
      })

      return result

    } catch (err) {
      result.status = 'failed'
      result.endTime = new Date()
      result.duration = Math.round((result.endTime.getTime() - result.startTime.getTime()) / 1000)
      result.error = err instanceof Error ? err.message : String(err)

      log.error('Restore failed', { error: result.error })

      return result

    } finally {
      await dbDriver.close()
    }
  }

  /**
   * Parse backup key to extract metadata
   */
  private parseBackupKey(key: string): { database?: string; type?: string } {
    // Key format: {type}-{database}-{date}-{time}.sql[.gz]
    // Example: postgresql-myapp-2026-04-18-10-30-00.sql.gz
    const basename = key.split('/').pop() ?? key
    const withoutExt = basename.replace(/\.(sql\.gz|sql)$/, '')
    const parts = withoutExt.split('-')

    return {
      type: parts[0],
      database: parts[1],
    }
  }

  /**
   * Generate file key for backup
   */
  private generateFileKey(config: ResolvedConfig, now = new Date()): string {
    const { source } = config.config
    const databaseName = config.connection.database
    const date = now.toISOString().split('T')[0]
    const time = now.toTimeString().split(' ')[0].replace(/:/g, '-')

    let key = `${source.type}-${databaseName}-${date}-${time}.sql`

    if (config.s3?.pathPrefix) {
      key = `${config.s3.pathPrefix}/${key}`
    }

    key += '.gz'

    return key
  }

  /**
   * Render runtime-only S3 template variables once so uploads and generated keys stay consistent.
   */
  private prepareRuntimeConfig(config: ResolvedConfig, now = new Date()): ResolvedConfig {
    if (!config.s3?.pathPrefix) {
      return config
    }

    const date = now.toISOString().split('T')[0]
    const time = now.toTimeString().split(' ')[0].replace(/:/g, '-')
    const { source } = config.config
    const databaseName = config.connection.database

    const renderedPathPrefix = config.s3.pathPrefix
      .replaceAll('{{.Database}}', databaseName)
      .replaceAll('{{.Date}}', date)
      .replaceAll('{{.Time}}', time)
      .replaceAll('{{.Type}}', source.type)

    return {
      ...config,
      s3: {
        ...config.s3,
        pathPrefix: renderedPathPrefix,
      },
    }
  }

  /**
   * Compute SHA256 checksum
   */
  private async computeChecksum(stream: Readable): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash('sha256')
      
      stream.on('data', (chunk) => hash.update(chunk))
      stream.on('end', () => resolve(`sha256:${hash.digest('hex')}`))
      stream.on('error', reject)
    })
  }

  /**
   * Execute with retry
   */
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
            maxAttempts: this.retryConfig.maxAttempts
          })
          await this.sleep(delay)
          delay *= this.retryConfig.backoffMultiplier
        }
      }
    }

    throw new BackupExecutionError(errorCode, '', lastError?.message ?? 'Unknown error', lastError)
  }

  /**
   * Sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

export function createBackupExecutor(options: BackupExecutorOptions, logger?: Logger): BackupExecutor {
  return new DefaultBackupExecutor(options, logger)
}
