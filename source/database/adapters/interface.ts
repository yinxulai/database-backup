/**
 * 数据库适配器接口
 */

import type { Readable } from 'node:stream'
import type { DatabaseType, ConnectionConfig, DumpOptions } from './types.js'

export interface DatabaseAdapter {
  readonly type: DatabaseType
  readonly version: string

  testConnection(): Promise<boolean>
  listTables(): Promise<string[]>
  dump(options: DumpOptions): Promise<Readable>
  close(): Promise<void>
}

export interface CreateDatabaseAdapterOptions {
  type: DatabaseType
  connection: ConnectionConfig
}

export interface DumpResult {
  data: Readable
  metadata: {
    size: number
    checksum: string
    tables: string[]
  }
}
