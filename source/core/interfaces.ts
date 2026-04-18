/**
 * 核心接口定义
 * 
 * 定义模块间通信的接口契约
 */

import type { Readable } from 'node:stream'
import type {
  SecretRef,
  BackupGroup,
  BackupResult,
  DumpOptions,
  UploadResult,
  ResolvedConfig,
} from './types.js'

// Re-export BackupError so implementations can use it
export { BackupExecutionError as BackupError } from './executor.js'

/**
 * 密钥解析器
 * 
 * 负责解析 SecretRef 获取实际密钥值
 */
export interface SecretResolver {
  /**
   * 解析密钥引用
   * @param ref 密钥引用
   * @returns 实际密钥值
   */
  resolve(ref: SecretRef): Promise<string>
}

/**
 * 数据库驱动
 * 
 * 负责数据库连接和备份操作
 */
export interface DatabaseDriver {
  /** 数据库类型 */
  readonly type: string

  /**
   * 测试数据库连接
   * @returns 连接是否成功
   */
  testConnection(): Promise<boolean>

  /**
   * 执行数据库备份
   * @param options 备份选项
   * @returns 备份数据流
   */
  dump(options: DumpOptions): Promise<Readable>

  /**
   * 关闭连接
   */
  close(): Promise<void>
}

/**
 * 存储驱动
 * 
 * 负责将备份数据上传到存储
 */
export interface StorageDriver {
  /** 存储类型 */
  readonly type: string

  /**
   * 上传数据
   * @param data 数据流
   * @param key 存储路径
   * @returns 上传结果
   */
  upload(data: Readable, key: string): Promise<UploadResult>

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

/**
 * 配置扫描器
 * 
 * 负责读取和解析配置文件
 */
export interface ConfigScanner {
  /**
   * 扫描配置文件
   * @param path 配置文件路径
   * @returns 解析后的备份组配置
   */
  scan(path: string): Promise<BackupGroup[]>

  /**
   * 扫描多个配置文件
   * @param paths 配置文件路径列表
   * @returns 解析后的备份组配置列表
   */
  scanMultiple(paths: string[]): Promise<BackupGroup[]>

  /**
   * 校验配置内容
   * @param content YAML 内容
   * @returns 校验结果
   */
  validate(content: string): ValidationResult
}

/**
 * 配置校验结果
 */
export interface ValidationResult {
  /** 是否有效 */
  valid: boolean
  /** 错误列表 */
  errors: ValidationError[]
}

/**
 * 配置校验错误
 */
export interface ValidationError {
  /** 错误路径 */
  path: string
  /** 错误消息 */
  message: string
}

/**
 * 结果存储器
 * 
 * 负责存储和查询备份结果
 */
/**
 * 存储对象元数据
 */
export interface StorageObject {
  /** 存储路径 */
  key: string
  /** 文件大小（字节）*/
  size: number
  /** 最后修改时间 */
  lastModified: Date
}

/**
 * 结果存储器
 */
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

/**
 * 备份执行器
 * 
 * 核心备份执行逻辑
 */
export interface BackupExecutor {
  /**
   * 执行备份
   * @param config 已解析的配置
   * @returns 备份结果
   */
  execute(config: ResolvedConfig): Promise<BackupResult>

  /**
   * 执行备份并指定输出
   * @param config 已解析的配置
   * @param outputKey 指定的存储 key（可选）
   * @param dryRun 是否为 dry-run 模式（只验证不上传）
   * @returns 备份结果
   */
  executeTo(config: ResolvedConfig, outputKey?: string, dryRun?: boolean): Promise<BackupResult>
}

/**
 * 备份执行器选项
 */
export interface BackupExecutorOptions {
  /** 密钥解析器 */
  secretResolver: SecretResolver
  /** 数据库驱动工厂 */
  databaseDriverFactory: DatabaseDriverFactory
  /** 存储驱动工厂 */
  storageDriverFactory: StorageDriverFactory
  /** 结果存储器 */
  resultStore?: ResultStore
}

/**
 * 数据库驱动工厂
 */
export interface DatabaseDriverFactory {
  /**
   * 创建数据库驱动
   * @param config 已解析的配置
   * @returns 数据库驱动实例
   */
  create(config: ResolvedConfig): DatabaseDriver
}

/**
 * 存储驱动工厂
 */
export interface StorageDriverFactory {
  /**
   * 创建存储驱动
   * @param config 已解析的配置
   * @returns 存储驱动实例
   */
  create(config: ResolvedConfig): StorageDriver
}

/**
 * 备份错误代码
 */
export type BackupErrorCode =
  | 'CONNECTION_FAILED'
  | 'DUMP_FAILED'
  | 'UPLOAD_FAILED'
  | 'CONFIG_INVALID'
  | 'SECRET_RESOLVE_FAILED'
  | 'UNKNOWN'
