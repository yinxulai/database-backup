/**
 * 保留策略执行器
 * 
 * 实现基于时间的备份保留策略，自动清理过期备份
 */

import type { StorageDriver } from '../core/interfaces.js'
import type { ResolvedConfig, RetentionConfig } from '../core/types.js'

/**
 * 保留策略执行结果
 */
export interface RetentionResult {
  /** 任务名称 */
  taskName: string
  /** 执行状态 */
  status: 'completed' | 'failed'
  /** 扫描到的文件数 */
  scannedCount: number
  /** 应删除的文件数 */
  deleteCount: number
  /** 实际删除的文件数 */
  deletedCount: number
  /** 错误信息 */
  error?: string
  /** 删除的文件列表 */
  deletedFiles: string[]
}

/**
 * 保留策略选项
 */
export interface RetentionOptions {
  /** 是否为 dry-run 模式（只预览不删除）*/
  dryRun?: boolean
}

/**
 * 保留策略执行器
 */
export class RetentionExecutor {
  constructor(private storageDriver: StorageDriver) {}

  /**
   * 应用保留策略
   * 
   * @param config 已解析的配置
   * @param options 执行选项
   * @returns 保留策略执行结果
   */
  async applyRetention(
    config: ResolvedConfig,
    options: RetentionOptions = {}
  ): Promise<RetentionResult> {
    const result: RetentionResult = {
      taskName: config.group.metadata.name,
      status: 'completed',
      scannedCount: 0,
      deleteCount: 0,
      deletedCount: 0,
      deletedFiles: [],
    }

    const retention = config.group.spec.retention
    if (!retention) {
      console.log('[retention] No retention policy configured, skipping')
      return result
    }

    const { retentionDays } = retention
    if (!retentionDays || retentionDays <= 0) {
      console.log('[retention] retentionDays is 0 or negative, skipping cleanup')
      return result
    }

    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays)
    console.log(`[retention] Retention: ${retentionDays} days, cutoff: ${cutoffDate.toISOString()}`)

    // 列出所有存储对象
    const objects = await this.storageDriver.list()
    result.scannedCount = objects.length
    console.log(`[retention] Scanned ${objects.length} files`)

    // 过滤过期文件
    const expiredFiles: { key: string; backupDate: Date }[] = []
    for (const obj of objects) {
      const backupDate = this.extractBackupDate(obj.key) ?? obj.lastModified
      if (backupDate < cutoffDate) {
        expiredFiles.push({ key: obj.key, backupDate })
      }
    }

    result.deleteCount = expiredFiles.length
    if (expiredFiles.length === 0) {
      console.log('[retention] No expired files to delete')
      return result
    }

    console.log(`[retention] Found ${expiredFiles.length} expired files`)
    for (const file of expiredFiles) {
      console.log(`[retention]   - ${file.key} (${file.backupDate.toISOString()})`)
    }

    if (options.dryRun) {
      console.log('[retention] Dry-run mode, skipping deletion')
      return result
    }

    // 删除过期文件
    for (const file of expiredFiles) {
      try {
        // 移除 pathPrefix 后的相对 key（delete 方法会重新拼接）
        const relativeKey = this.extractRelativeKey(file.key, config)
        await this.storageDriver.delete(relativeKey)
        result.deletedCount++
        result.deletedFiles.push(file.key)
        console.log(`[retention] Deleted: ${file.key}`)
      } catch (err) {
        console.error(`[retention] Failed to delete ${file.key}: ${err instanceof Error ? err.message : err}`)
        result.error = `Failed to delete some files`
      }
    }

    return result
  }

  /**
   * 从文件 key 中提取备份日期
   * 
   * 支持的格式:
   * - {pathPrefix}/{type}-{database}-{YYYY-MM-DD}-{HH-MM-SS}.sql.gz
   */
  private extractBackupDate(key: string): Date | null {
    // 匹配 YYYY-MM-DD 日期模式
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
   * 从完整 key 中提取相对 key（去掉 pathPrefix）
   */
  private extractRelativeKey(fullKey: string, config: ResolvedConfig): string {
    const pathPrefix = config.s3?.pathPrefix
    if (pathPrefix && fullKey.startsWith(pathPrefix + '/')) {
      return fullKey.slice(pathPrefix.length + 1)
    }
    return fullKey
  }
}

/**
 * 创建保留策略执行器
 */
export function createRetentionExecutor(storageDriver: StorageDriver): RetentionExecutor {
  return new RetentionExecutor(storageDriver)
}
