/**
 * 备份任务配置
 */

export interface BackupTask {
  /** 任务 ID */
  id: string
  /** 任务名称 */
  name: string
  /** 任务描述 */
  description?: string
  /** 来源配置 */
  source: BackupSource
  /** 目标配置 */
  destination: BackupDestination
  /** 调度配置 */
  schedule?: ScheduleConfig
  /** 保留策略 */
  retention?: RetentionConfig
  /** 创建时间 */
  createdAt: number
  /** 更新时间 */
  updatedAt: number
}

export interface BackupSource {
  /** 数据库类型 */
  type: DatabaseType
  /** 连接配置 */
  connection: ConnectionConfig
  /** 要备份的表（为空则备份全库）*/
  tables?: string[]
  /** 每表行数限制 */
  rowsLimit?: number
}

export type DatabaseType = 'postgresql' | 'mysql' | 'mongodb' | 'redis'

export interface ConnectionConfig {
  host: string
  port: number
  username: string
  password: string
  database: string
  ssl?: boolean
}

export interface BackupDestination {
  /** 存储类型 */
  type: 's3'
  /** S3 配置 */
  s3: S3Config
  /** 压缩格式 */
  compression?: 'gzip' | 'none'
}

export interface S3Config {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  pathPrefix?: string
}

export interface ScheduleConfig {
  /** Cron 表达式 */
  cron: string
  /** 时区 */
  timezone?: string
  /** 是否启用 */
  enabled?: boolean
}

export interface RetentionConfig {
  /** 保留天数 */
  retentionDays: number
  /** 最大备份数量 */
  maxBackups?: number
}

export interface BackupResult {
  /** 结果 ID */
  id: string
  /** 关联的任务 ID */
  taskId: string
  /** 状态 */
  status: 'pending' | 'running' | 'completed' | 'failed'
  /** 开始时间 */
  startTime: number
  /** 结束时间 */
  endTime?: number
  /** 文件大小 */
  size?: number
  /** 校验和 */
  checksum?: string
  /** 错误信息 */
  error?: string
  /** 备份的文件 key */
  fileKey?: string
}

export interface BackupHistory {
  taskId: string
  results: BackupResult[]
}
