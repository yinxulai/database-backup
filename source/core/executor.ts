/**
 * 备份执行器
 * 
 * 核心备份执行逻辑，协调扫描、dump、压缩、上传流程
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

/**
 * 默认重试配置
 */
const DEFAULT_RETRY_CONFIG = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  backoffMultiplier: 2,
}

/**
 * 备份执行错误
 */
export class BackupExecutionError extends Error {
  constructor(
    /** 错误代码 */
    public readonly code: BackupErrorCode,
    /** 任务名称 */
    public readonly taskName: string,
    message: string,
    /** 原始错误 */
    public readonly cause?: Error
  ) {
    super(message)
    this.name = 'BackupExecutionError'
  }
}

/**
 * 备份执行器实现
 */
export class DefaultBackupExecutor implements BackupExecutor {
  private retryConfig = DEFAULT_RETRY_CONFIG

  constructor(private options: BackupExecutorOptions) {}

  /**
   * 执行备份
   */
  async execute(config: ResolvedConfig): Promise<BackupResult> {
    return this.executeTo(config)
  }

  /**
   * 执行备份并指定输出 key
   */
  async executeTo(config: ResolvedConfig, outputKey?: string): Promise<BackupResult> {
    const result: BackupResult = {
      id: randomUUID(),
      taskName: config.group.metadata.name,
      status: 'running',
      startTime: new Date(),
    }

    const { source, destination } = config.group.spec

    // 创建数据库驱动
    const dbDriver = this.options.databaseDriverFactory.create(config)
    // 创建存储驱动
    const storageDriver = this.options.storageDriverFactory.create(config)

    try {
      // 1. 测试连接
      console.log(`[backup] Testing connection to ${source.type}...`)
      const connected = await dbDriver.testConnection()
      if (!connected) {
        throw new BackupExecutionError('CONNECTION_FAILED', config.group.metadata.name, '数据库连接失败')
      }
      console.log(`[backup] ✓ Connected`)

      // 2. 生成文件 key
      const fileKey = outputKey ?? this.generateFileKey(config)
      result.fileKey = fileKey
      result.tables = source.tables ?? []

      // 3. 执行 dump
      console.log(`[backup] Dumping ${source.type}://${source.database}...`)
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
        'DUMP_FAILED'
      )
      console.log(`[backup] ✓ Dump completed`)

      // 4. 计算 checksum
      console.log(`[backup] Computing checksum...`)
      const checksum = await this.computeChecksum(dumpStream)
      result.checksum = checksum
      console.log(`[backup] ✓ Checksum: ${checksum}`)

      // 5. 重新获取 dump 流（因为 computeChecksum 消费了它）
      const dumpStreamForUpload = await dbDriver.dump(dumpOptions)

      // 6. 上传到存储
      console.log(`[backup] Uploading to ${destination.type}...`)
      const uploadResult = await this.withRetry(
        () => storageDriver.upload(dumpStreamForUpload, fileKey),
        'UPLOAD_FAILED'
      )

      result.size = uploadResult.size
      result.status = 'completed'
      result.endTime = new Date()
      result.duration = Math.round((result.endTime.getTime() - result.startTime.getTime()) / 1000)

      console.log(`[backup] ✓ Uploaded to ${uploadResult.key} (${this.formatSize(uploadResult.size)})`)
      console.log(`[backup] ✓ Backup completed in ${result.duration}s`)

      // 7. 保存结果
      if (this.options.resultStore) {
        await this.options.resultStore.save(result)
      }

      return result

    } catch (err) {
      result.status = 'failed'
      result.endTime = new Date()
      result.duration = Math.round((result.endTime.getTime() - result.startTime.getTime()) / 1000)
      result.error = err instanceof Error ? err.message : String(err)

      console.error(`[backup] ✗ Backup failed: ${result.error}`)

      // 保存失败结果
      if (this.options.resultStore) {
        await this.options.resultStore.save(result)
      }

      return result

    } finally {
      await dbDriver.close()
    }
  }

  /**
   * 生成文件 key
   */
  private generateFileKey(config: ResolvedConfig): string {
    const { source, destination } = config.group.spec
    const now = new Date()
    const date = now.toISOString().split('T')[0]
    const time = now.toTimeString().split(' ')[0].replace(/:/g, '-')

    let key = `${source.type}-${source.database}-${date}-${time}.sql`

    if (destination.type === 's3' && destination.s3?.pathPrefix) {
      // 简单替换变量
      let prefix = destination.s3.pathPrefix
      prefix = prefix.replace('{{.Database}}', source.database)
      prefix = prefix.replace('{{.Schema}}', source.schema ?? 'public')
      prefix = prefix.replace('{{.Date}}', date)
      prefix = prefix.replace('{{.Time}}', time)
      prefix = prefix.replace('{{.Type}}', source.type)
      key = `${prefix}/${key}`
    }

    // 添加 .gz 后缀
    key += '.gz'

    return key
  }

  /**
   * 计算 SHA256 checksum
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
   * 带重试的执行
   */
  private async withRetry<T>(
    fn: () => Promise<T>,
    errorCode: BackupErrorCode
  ): Promise<T> {
    let lastError: Error | undefined
    let delay = this.retryConfig.initialDelayMs

    for (let attempt = 1; attempt <= this.retryConfig.maxAttempts; attempt++) {
      try {
        return await fn()
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        
        if (attempt < this.retryConfig.maxAttempts) {
          console.log(`[backup] Retry in ${delay}ms (attempt ${attempt}/${this.retryConfig.maxAttempts})`)
          await this.sleep(delay)
          delay *= this.retryConfig.backoffMultiplier
        }
      }
    }

    throw new BackupExecutionError(errorCode, '', lastError?.message ?? 'Unknown error', lastError)
  }

  /**
   * 睡眠
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * 格式化文件大小
   */
  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
  }
}

/**
 * 创建备份执行器
 */
export function createBackupExecutor(options: BackupExecutorOptions): BackupExecutor {
  return new DefaultBackupExecutor(options)
}
