/**
 * 核心类型定义
 * 
 * 定义数据库备份工具的核心类型
 */

/**
 * 数据库类型
 */
export type DatabaseType = 'postgresql' | 'mysql' | 'mongodb' | 'redis'

/**
 * 存储类型
 */
export type StorageType = 's3' | 'gcs' | 'azure' | 'local'

/**
 * 备份源配置
 */
export interface BackupSource {
  /** 数据库类型 */
  type: DatabaseType
  /** 连接配置 */
  connection: ConnectionConfig
  /** 数据库名称 */
  database: string
  /** Schema（默认 public）*/
  schema?: string
  /** 要备份的表（空 = 全库）*/
  tables?: string[]
}

/**
 * 数据库连接配置
 */
export interface ConnectionConfig {
  /** 主机地址 */
  host: string
  /** 端口 */
  port: number
  /** 用户名 */
  username: string
  /** 明文密码（适合本地测试）*/
  password?: string
  /** 密码（通过 SecretRef 引用）*/
  passwordSecretRef?: SecretRef
  /** 数据库名称 */
  database: string
  /** 是否使用 SSL */
  ssl?: boolean
}

/**
 * 备份目标配置
 */
export interface BackupDestination {
  /** 存储类型 */
  type: StorageType
  /** S3 配置 */
  s3?: S3Config
  /** Local 配置 */
  local?: LocalConfig
}

/**
 * S3 存储配置
 */
export interface S3Config {
  /** S3 端点 */
  endpoint: string
  /** AWS 区域 */
  region: string
  /** Bucket 名称 */
  bucket: string
  /** 明文访问密钥（适合本地测试）*/
  accessKeyId?: string
  /** 明文私有密钥（适合本地测试）*/
  secretAccessKey?: string
  /** 访问密钥（通过 SecretRef 引用）*/
  accessKeySecretRef?: SecretRef
  /** 私有密钥（通过 SecretRef 引用）*/
  secretKeySecretRef?: SecretRef
  /** 路径前缀模板 */
  pathPrefix?: string
  /** 是否使用 Path Style（MinIO 需要）*/
  forcePathStyle?: boolean
}

/**
 * 本地存储配置
 */
export interface LocalConfig {
  /** 存储路径 */
  path: string
}

/**
 * 密钥引用
 */
export interface SecretRef {
  /** 类型: env (环境变量) / k8s (K8s Secret) */
  type: 'env' | 'k8s'
  /** 环境变量名（type=env 时使用）*/
  envVar?: string
  /** K8s Secret 名称（type=k8s 时使用）*/
  secretName?: string
  /** K8s Secret key（type=k8s 时使用）*/
  secretKey?: string
}

/**
 * 调度配置
 */
export interface ScheduleConfig {
  /** 是否启用 */
  enabled?: boolean
  /** Cron 表达式 */
  cron: string
  /** 时区（默认 UTC）*/
  timezone?: string
}

/**
 * 保留策略
 */
export interface RetentionConfig {
  /** 保留天数 */
  retentionDays: number
}

/**
 * 备份任务配置
 */
export interface BackupGroup {
  /** API 版本 */
  apiVersion: string
  /** 资源类型 */
  kind: 'BackupGroup'
  /** 元数据 */
  metadata: BackupGroupMetadata
  /** 规格配置 */
  spec: BackupGroupSpec
}

/**
 * 备份组元数据
 */
export interface BackupGroupMetadata {
  /** 名称 */
  name: string
  /** 标签 */
  labels?: Record<string, string>
}

/**
 * 备份组规格配置
 */
export interface BackupGroupSpec {
  /** 来源配置 */
  source: BackupSource
  /** 目标配置 */
  destination: BackupDestination
  /** 调度配置（可选）*/
  schedule?: ScheduleConfig
  /** 保留策略（可选）*/
  retention?: RetentionConfig
}

/**
 * 备份执行结果
 */
export interface BackupResult {
  /** 结果 ID */
  id: string
  /** 任务名称 */
  taskName: string
  /** 状态 */
  status: BackupStatus
  /** 开始时间 */
  startTime: Date
  /** 结束时间 */
  endTime?: Date
  /** 耗时（秒）*/
  duration?: number
  /** 文件大小（字节）*/
  size?: number
  /** 校验和 */
  checksum?: string
  /** 文件 Key */
  fileKey?: string
  /** 备份的表 */
  tables?: string[]
  /** 错误信息 */
  error?: string
}

/**
 * 备份状态
 */
export type BackupStatus = 'pending' | 'running' | 'completed' | 'failed' | 'dry-run-completed'

/**
 * Dump 选项
 */
export interface DumpOptions {
  /** 要备份的表（空数组 = 全库）*/
  tables: string[]
  /** Schema */
  schema?: string
  /** 数据库名称 */
  database: string
  /** 压缩格式 */
  compression?: 'gzip' | 'none'
}

/**
 * 上传结果
 */
export interface UploadResult {
  /** 文件 Key */
  key: string
  /** 文件大小 */
  size: number
  /** ETag */
  etag?: string
  /** 上传耗时 */
  duration: number
}

/**
 * 解析后的配置（SecretRef 已解析）
 */
export interface ResolvedConfig {
  /** 备份组配置 */
  group: BackupGroup
  /** 解析后的连接配置 */
  connection: ResolvedConnection
  /** 解析后的 S3 配置 */
  s3?: ResolvedS3Config
}

/**
 * 解析后的连接配置
 */
export interface ResolvedConnection {
  host: string
  port: number
  username: string
  password: string
  database: string
  ssl: boolean
}

/**
 * 解析后的 S3 配置
 */
export interface ResolvedS3Config {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  pathPrefix?: string
  forcePathStyle: boolean
}

/**
 * 恢复选项
 */
export interface RestoreOptions {
  /** 备份文件 key（存储中的路径）*/
  backupKey: string
  /** 目标数据库名称 */
  database: string
  /** 要恢复的表（空 = 全部）*/
  tables?: string[]
  /** Schema */
  schema?: string
  /** 恢复前清理（drop existing objects）*/
  clean?: boolean
  /** 创建数据库（如果不存在）*/
  create?: boolean
  /** 备份是否为 gzip 压缩 */
  compressed?: boolean
  /** 备份格式: 'plain' (pg_dump plain SQL) | 'custom' (pg_dump -Fc) */
  format?: 'plain' | 'custom'
}

/**
 * 恢复结果
 */
export interface RestoreResult {
  /** 结果 ID */
  id: string
  /** 任务名称 */
  taskName: string
  /** 状态 */
  status: RestoreStatus
  /** 开始时间 */
  startTime: Date
  /** 结束时间 */
  endTime?: Date
  /** 耗时（秒）*/
  duration?: number
  /** 恢复的文件 key */
  fileKey?: string
  /** 错误信息 */
  error?: string
}

/**
 * 恢复状态
 */
export type RestoreStatus = 'pending' | 'running' | 'completed' | 'failed'

/**
 * 备份对象（从存储中列出）
 */
export interface BackupObject {
  /** 存储 key */
  key: string
  /** 文件大小 */
  size: number
  /** 最后修改时间 */
  lastModified: Date
  /** 数据库类型 */
  databaseType?: string
  /** 数据库名称 */
  databaseName?: string
  /** 备份时间 */
  backupTime?: Date
}

/**
 * Restore options input (before backup key is resolved)
 */
export interface RestoreInput {
  /** 要恢复的备份 key */
  backupKey: string
  /** 目标数据库名称 */
  database?: string
  /** 要恢复的表 */
  tables?: string[]
  /** Schema */
  schema?: string
  /** 恢复前清理 */
  clean?: boolean
  /** 创建数据库 */
  create?: boolean
}
