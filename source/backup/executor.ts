/**
 * 备份执行器
 */

import type { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'

import type { BackupTask, BackupResult, DatabaseType } from '../config/types.js'
import type { StorageAdapter } from '../upload/adapters/s3.js'
import type { DatabaseAdapter, DumpOptions } from '../database/adapters/interface.js'
import { createPostgreSQLAdapter } from '../database/adapters/postgresql.js'
import { createS3Adapter } from '../upload/adapters/s3.js'

export interface CreateBackupExecutorOptions {
  tasks?: BackupTask[]
  storage?: StorageAdapter
}

export class BackupExecutor {
  private tasks = new Map<string, BackupTask>()
  private results = new Map<string, BackupResult[]>()
  private storage: StorageAdapter | null = null

  constructor(options: CreateBackupExecutorOptions = {}) {
    if (options.tasks) {
      options.tasks.forEach((task) => this.tasks.set(task.id, task))
    }
    this.storage = options.storage ?? null
  }

  /**
   * 添加存储适配器
   */
  setStorage(storage: StorageAdapter): void {
    this.storage = storage
  }

  /**
   * 注册备份任务
   */
  registerTask(task: BackupTask): void {
    this.tasks.set(task.id, task)
  }

  /**
   * 获取任务
   */
  getTask(taskId: string): BackupTask | undefined {
    return this.tasks.get(taskId)
  }

  /**
   * 执行备份
   */
  async execute(taskId: string): Promise<BackupResult> {
    const task = this.tasks.get(taskId)
    if (!task) {
      throw new Error(`Task not found: ${taskId}`)
    }

    const result: BackupResult = {
      id: randomUUID(),
      taskId,
      status: 'running',
      startTime: Date.now(),
    }

    // 创建数据库适配器
    const dbAdapter = this.createDatabaseAdapter(task.source)

    // 创建存储适配器
    if (!this.storage) {
      this.storage = createS3Adapter(task.destination.s3)
    }

    try {
      // 执行备份
      const dumpOptions: DumpOptions = {
        tables: task.source.tables,
        rowsLimit: task.source.rowsLimit,
        compression: task.destination.compression,
      }

      const dumpStream = await dbAdapter.dump(dumpOptions)

      // 生成文件 key
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const fileKey = `backup/${task.name}/${task.source.type}-${task.source.connection.database}-${timestamp}.sql`

      // 上传到 S3
      await this.storage.upload(dumpStream, fileKey)

      // 计算校验和（简化）
      const checksum = 'sha256-placeholder'

      result.status = 'completed'
      result.endTime = Date.now()
      result.fileKey = fileKey
      result.checksum = checksum

      // 记录结果
      const taskResults = this.results.get(taskId) ?? []
      taskResults.push(result)
      this.results.set(taskId, taskResults)

      return result
    } catch (err) {
      result.status = 'failed'
      result.endTime = Date.now()
      result.error = err instanceof Error ? err.message : String(err)

      const taskResults = this.results.get(taskId) ?? []
      taskResults.push(result)
      this.results.set(taskId, taskResults)

      return result
    } finally {
      await dbAdapter.close()
    }
  }

  /**
   * 获取任务历史
   */
  getHistory(taskId: string): BackupResult[] {
    return this.results.get(taskId) ?? []
  }

  /**
   * 创建数据库适配器
   */
  private createDatabaseAdapter(source: BackupTask['source']): DatabaseAdapter {
    switch (source.type) {
      case 'postgresql':
        return createPostgreSQLAdapter(source.connection)
      default:
        throw new Error(`Unsupported database type: ${source.type}`)
    }
  }
}

// 工厂函数
export function createBackupExecutor(options?: CreateBackupExecutorOptions): BackupExecutor {
  return new BackupExecutor(options)
}
