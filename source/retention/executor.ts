
import type { StorageDriver } from '@core/interfaces'
import type { ResolvedConfig } from '@core/types'
import { createLogger, type Logger } from '@core/logger'

export interface RetentionResult {
  taskName: string
  status: 'completed' | 'failed'
  scannedCount: number
  deleteCount: number
  deletedCount: number
  error?: string
  deletedFiles: string[]
}

export interface RetentionOptions {
  dryRun?: boolean
}

export class RetentionExecutor {
  private logger: Logger

  constructor(
    private storageDriver: StorageDriver,
    logger?: Logger
  ) {
    this.logger = logger ?? createLogger()
  }

  /**
   * Apply retention policy
   */
  async applyRetention(
    config: ResolvedConfig,
    options: RetentionOptions = {}
  ): Promise<RetentionResult> {
    const log = this.logger.child(config.config.name)

    const result: RetentionResult = {
      taskName: config.config.name,
      status: 'completed',
      scannedCount: 0,
      deleteCount: 0,
      deletedCount: 0,
      deletedFiles: [],
    }

    const retention = config.config.retention
    if (!retention) {
      log.info('No retention policy configured, skipping')
      return result
    }

    const { retentionDays } = retention
    if (!retentionDays || retentionDays <= 0) {
      log.info('Retention days is 0 or negative, skipping cleanup')
      return result
    }

    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays)
    log.info('Applying retention policy', { retentionDays, cutoffDate: cutoffDate.toISOString() })

    // List all objects
    const objects = await this.storageDriver.list()
    result.scannedCount = objects.length
    log.info('Scanned storage objects', { count: objects.length })

    // Filter expired files
    const expiredFiles: { key: string; backupDate: Date }[] = []
    for (const obj of objects) {
      const backupDate = this.extractBackupDate(obj.key) ?? obj.lastModified
      if (backupDate < cutoffDate) {
        expiredFiles.push({ key: obj.key, backupDate })
      }
    }

    result.deleteCount = expiredFiles.length
    if (expiredFiles.length === 0) {
      log.info('No expired files to delete')
      return result
    }

    log.info('Found expired files', { count: expiredFiles.length, files: expiredFiles.map(f => f.key) })

    if (options.dryRun) {
      log.info('Dry-run mode, skipping deletion')
      return result
    }

    // Delete expired files
    for (const file of expiredFiles) {
      try {
        const relativeKey = this.extractRelativeKey(file.key, config)
        await this.storageDriver.delete(relativeKey)
        result.deletedCount++
        result.deletedFiles.push(file.key)
        log.info('Deleted expired file', { key: file.key })
      } catch (err) {
        log.error('Failed to delete file', { key: file.key, error: err instanceof Error ? err.message : String(err) })
        result.error = 'Failed to delete some files'
      }
    }

    return result
  }

  /**
   * Extract backup date from file key
   */
  private extractBackupDate(key: string): Date | null {
    const dateMatch = key.match(/(\d{4}-\d{2}-\d{2})/)
    if (dateMatch) {
      const date = new Date(dateMatch[1] + 'T00:00:00Z')
      if (!isNaN(date.getTime())) {
        return date
      }
    }
    return null
  }

  /**
   * Extract relative key from full key
   */
  private extractRelativeKey(fullKey: string, config: ResolvedConfig): string {
    const pathPrefix = config.s3?.pathPrefix
    if (pathPrefix && fullKey.startsWith(pathPrefix + '/')) {
      return fullKey.slice(pathPrefix.length + 1)
    }
    return fullKey
  }
}

export function createRetentionExecutor(storageDriver: StorageDriver, logger?: Logger): RetentionExecutor {
  return new RetentionExecutor(storageDriver, logger)
}
