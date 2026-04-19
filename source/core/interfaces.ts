import type { Readable } from 'node:stream'

import type {
  BackupConfig,
  BackupResult,
  DumpOptions,
  UploadResult,
  ResolvedConfig,
  RestoreOptions,
  RestoreInput,
  RestoreResult,
} from './types.js'

export interface DatabaseDriver {
  /** 数据库类型 */
  readonly type: string

  /**
   * 测试数据库连接
   * @returns 连接是否成功
   */
  testConnection(): Promise<boolean>

  /**
   * 执行数据库备份，将结果直接写入到指定文件
   * @param options 备份选项
   * @param destFilePath 目标文件路径（由 executor 提供的临时文件）
   */
  dump(options: DumpOptions, destFilePath: string): Promise<void>

  /**
   * 执行数据库恢复，从指定文件读取备份数据
   * @param options 恢复选项
   * @param srcFilePath 备份文件路径（由 executor 提供的已下载文件）
   */
  restore(options: RestoreOptions, srcFilePath: string): Promise<void>

  /**
   * 关闭连接
   */
  close(): Promise<void>
}

export interface StorageDriver {
  /** 存储类型 */
  readonly type: string

  /**
   * 上传已落盘的备份文件
   * @param filePath 临时文件路径
   * @param key 存储路径
   * @param contentLength 文件大小（字节）
   * @returns 上传结果
   */
  upload(filePath: string, key: string, contentLength: number): Promise<UploadResult>

  /**
   * 下载数据
   * @param key 存储路径
   * @returns 下载数据流
   */
  download(key: string): Promise<Readable>

  /**
   * 删除文件
   * @param key 存储路径
   */
  delete(key: string): Promise<void>

  /**
   * 列出存储对象
   * @param prefix 路径前缀（可选）
   * @returns 存储对象列表
   */
  list(prefix?: string): Promise<StorageObject[]>
}

export interface ConfigScanner {
  /**
   * 扫描配置文件
   * @param path 配置文件路径
   * @returns 解析后的备份组配置
   */
  scan(path: string): Promise<BackupConfig[]>

  /**
   * 扫描多个配置文件
   * @param paths 配置文件路径列表
   * @returns 解析后的备份组配置列表
   */
  scanMultiple(paths: string[]): Promise<BackupConfig[]>

  /**
   * 校验配置内容
   * @param content YAML 内容
   * @returns 校验结果
   */
  validate(content: string): ValidationResult
}

export interface ValidationResult {
  /** 是否有效 */
  valid: boolean
  /** 错误列表 */
  errors: ValidationError[]
}

export interface ValidationError {
  /** 错误路径 */
  path: string
  /** 错误消息 */
  message: string
}

export interface StorageObject {
  /** 存储路径 */
  key: string
  /** 文件大小（字节）*/
  size: number
  /** 最后修改时间 */
  lastModified: Date
}

export interface ResultStore {
  /**
   * 保存备份结果
   * @param result 备份结果
   */
  save(result: BackupResult): Promise<void>

  /**
   * 查询备份历史
   * @param taskName 任务名称
   * @param limit 返回数量限制
   * @returns 备份结果列表
   */
  list(taskName: string, limit?: number): Promise<BackupResult[]>

  /**
   * 获取单个备份结果
   * @param id 结果 ID
   * @returns 备份结果
   */
  get(id: string): Promise<BackupResult | null>
}

export interface BackupExecutor {
  execute(config: ResolvedConfig, outputKey?: string, dryRun?: boolean): Promise<BackupResult>
  restore(config: ResolvedConfig, input: RestoreInput): Promise<RestoreResult>
}

export interface BackupExecutorOptions {
  /** 数据库驱动工厂 */
  databaseDriverFactory: DatabaseDriverFactory
  /** 存储驱动工厂 */
  storageDriverFactory: StorageDriverFactory
  /** 结果存储器 */
  resultStore?: ResultStore
}

export interface DatabaseDriverFactory {
  create(config: ResolvedConfig): DatabaseDriver
}

export interface StorageDriverFactory {
  create(config: ResolvedConfig): StorageDriver
}
