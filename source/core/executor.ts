/**
 * @fileoverview Backup executor implementation
 * @module @yinxulai/database-backup/core/executor
 */

import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'
import type { Readable } from 'node:stream'
import type {
  ResolvedConfig,
  BackupResult,
} from './types.js'
import type {
  SecretResolver,
  DatabaseDriver,
  StorageDriver,
  BackupExecutor,
  BackupExecutorOptions,
  BackupError,
  BackupErrorCode,
} from './interfaces.js'
import { createLogger, type Logger } from './logger.js'

/**
 * Default retry configuration
 */
const DEFAULT_RETRY_CONFIG = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  backoffMultiplier: 2,
}

/**
 * Backup execution error
 */
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

/**
 * Default backup executor implementation
 */
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
      taskName: config.group.metadata.name,
      status: 'running',
      startTime: new Date(),
    }

    const { source, destination } = config.group.spec

    // Create database and storage drivers
    const dbDriver = this.options.databaseDriverFactory.create(config)
    const storageDriver = this.options.storageDriverFactory.create(config)

    try {
      // 1. Test connection
      log.info('Testing database connection', { type: source.type, database: source.database })
      const connected = await dbDriver.testConnection()
      if (!connected) {
        throw new BackupExecutionError('CONNECTION_FAILED', config.group.metadata.name, 'Database connection failed')
      }
      log.info('Database connection successful')

      // 2. Generate file key
      const fileKey = outputKey ?? this.generateFileKey(config)
      result.fileKey = fileKey
      result.tables = source.tables ?? []

      // 3. Execute dump
      log.info('Starting database dump', { database: source.database, tables: result.tables })
      const tables = source.tables ?? []
      const compression: 'gzip' | 'none' | undefined = destination.type === 's3' ? 'gzip' : undefined
      const dumpOptions = {
        database: source.database,
        schema: source.schema,
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
   * Generate file key for backup
   */
  private generateFileKey(config: ResolvedConfig): string {
    const { source, destination } = config.group.spec
    const now = new Date()
    const date = now.toISOString().split('T')[0]
    const time = now.toTimeString().split(' ')[0].replace(/:/g, '-')

    let key = `${source.type}-${source.database}-${date}-${time}.sql`

    if (destination.type === 's3' && destination.s3?.pathPrefix) {
      let prefix = destination.s3.pathPrefix
      prefix = prefix.replace('{{.Database}}', source.database)
      prefix = prefix.replace('{{.Schema}}', source.schema ?? 'public')
      prefix = prefix.replace('{{.Date}}', date)
      prefix = prefix.replace('{{.Time}}', time)
      prefix = prefix.replace('{{.Type}}', source.type)
      key = `${prefix}/${key}`
    }

    key += '.gz'

    return key
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

/**
 * Create backup executor
 */
export function createBackupExecutor(options: BackupExecutorOptions, logger?: Logger): BackupExecutor {
  return new DefaultBackupExecutor(options, logger)
}
