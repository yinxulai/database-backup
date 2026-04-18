/**
 * 数据库类型定义
 */

export type DatabaseType = 'postgresql' | 'mysql' | 'mongodb' | 'redis'

export interface ConnectionConfig {
  host: string
  port: number
  username: string
  password: string
  database: string
  ssl?: boolean
}

export interface DumpOptions {
  /** 要备份的表列表（空 = 全库）*/
  tables?: string[]
  /** 每表行数限制（分块备份用）*/
  rowsLimit?: number
  /** 压缩格式 */
  compression?: 'gzip' | 'none'
}

export interface DatabaseAdapter {
  readonly type: DatabaseType
  readonly version: string

  testConnection(): Promise<boolean>
  listTables(): Promise<string[]>
  dump(options: DumpOptions): Promise<NodeJS.ReadableStream>
}
