/**
 * PostgreSQL 数据库驱动
 * 
 * 使用 pg_dump 执行 PostgreSQL 数据库备份
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Readable, Writable } from 'node:stream'
import type { DumpOptions, RestoreOptions, ResolvedConnection } from '@core/types'
import type { DatabaseDriver } from '@core/interfaces'

const execFileAsync = promisify(execFile)

/**
 * PostgreSQL 数据库驱动
 */
export class PostgreSQLDriver implements DatabaseDriver {
  readonly type = 'postgresql'

  constructor(
    private connection: ResolvedConnection,
    private password?: string
  ) {}

  /**
   * 测试数据库连接
   */
  async testConnection(): Promise<boolean> {
    try {
      const env = this.createEnv()
      await execFileAsync('psql', [
        '-h', this.connection.host,
        '-p', String(this.connection.port),
        '-U', this.connection.username,
        '-d', this.connection.database,
        '-c', 'SELECT 1',
      ], { env })
      return true
    } catch {
      return false
    }
  }

  /**
   * 执行数据库备份
   */
  async dump(options: DumpOptions): Promise<Readable> {
    const args = this.buildPgDumpArgs(options)
    const env = this.createEnv()

    // 使用 spawn 创建一个可读的流
    const { spawn } = await import('node:child_process')
    
    const pgDump = spawn('pg_dump', args, { env, stdio: ['ignore', 'pipe', 'pipe'] })

    // 如果需要 gzip
    if (options.compression === 'gzip') {
      const { spawn: spawnGzip } = await import('node:child_process')
      const gzip = spawnGzip('gzip', ['-c'], { stdio: ['pipe', 'pipe', 'pipe'] })
      
      pgDump.stdout.pipe(gzip.stdin)
      pgDump.stderr.on('data', (data: Buffer | string) => {
        console.error(`[pg_dump] ${data.toString().trim()}`)
      })
      gzip.stderr.on('data', (data: Buffer | string) => {
        console.error(`[gzip] ${data.toString().trim()}`)
      })
      
      // 当 gzip 退出时，确保 pg_dump 也被终止
      gzip.on('close', (code) => {
        if (code !== 0) {
          pgDump.kill()
        }
      })
      
      return gzip.stdout
    }

    pgDump.stderr.on('data', (data: Buffer | string) => {
      console.error(`[pg_dump] ${data.toString().trim()}`)
    })

    return pgDump.stdout
  }

  /**
   * 执行数据库恢复
   * 支持 pg_restore（自定义格式）和 psql（plain SQL）
   */
  async restore(options: RestoreOptions): Promise<Writable> {
    const { spawn } = await import('node:child_process')

    // 根据格式选择恢复工具
    const format = options.format ?? 'plain'

    if (format === 'custom') {
      // 使用 pg_restore 恢复自定义格式
      return this.restoreWithPgRestore(options, spawn)
    } else {
      // 使用 psql 恢复 plain SQL
      return this.restoreWithPsql(options, spawn)
    }
  }

  /**
   * 使用 pg_restore 恢复自定义格式备份
   */
  private async restoreWithPgRestore(
    options: RestoreOptions,
    spawn: (command: string, args?: string[], options?: any) => any
  ): Promise<Writable> {
    const args = this.buildPgRestoreArgs(options)
    const env = this.createEnv()

    const pgRestore = spawn('pg_restore', args, {
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    })

    pgRestore.stderr.on('data', (data: Buffer | string) => {
      console.error(`[pg_restore] ${data.toString().trim()}`)
    })

    return pgRestore.stdin!
  }

  /**
   * 使用 psql 恢复 plain SQL 备份
   */
  private async restoreWithPsql(
    options: RestoreOptions,
    spawn: (command: string, args?: string[], options?: any) => any
  ): Promise<Writable> {
    const args = this.buildPsqlArgs(options)
    const env = this.createEnv()

    const psql = spawn('psql', args, {
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    })

    psql.stderr.on('data', (data: Buffer | string) => {
      console.error(`[psql] ${data.toString().trim()}`)
    })

    return psql.stdin!
  }

  /**
   * 构建 pg_restore 参数
   */
  private buildPgRestoreArgs(options: RestoreOptions): string[] {
    const args: string[] = []

    // 连接参数
    args.push('-h', this.connection.host)
    args.push('-p', String(this.connection.port))
    args.push('-U', this.connection.username)

    // 创建数据库
    if (options.create) {
      args.push('--create')
    }

    // 清理选项
    if (options.clean) {
      args.push('--clean')
    }

    // Schema
    if (options.schema) {
      args.push('-n', options.schema)
    }

    // 表过滤
    if (options.tables && options.tables.length > 0) {
      for (const table of options.tables) {
        const parts = table.split('.')
        if (parts.length === 2) {
          args.push('-t', `${parts[0]}.${parts[1]}`)
        } else {
          args.push('-t', `${options.schema || 'public'}.${table}`)
        }
      }
    }

    // 目标数据库
    if (!options.create) {
      args.push('-d', options.database)
    }

    // 输出到 stdin
    args.push('-f', '-')

    // 禁用提示（恢复时不需要）
    args.push('--quiet')

    return args
  }

  /**
   * 构建 psql 参数
   */
  private buildPsqlArgs(options: RestoreOptions): string[] {
    const args: string[] = []

    // 连接参数
    args.push('-h', this.connection.host)
    args.push('-p', String(this.connection.port))
    args.push('-U', this.connection.username)

    // 创建数据库
    if (options.create) {
      args.push('--create')
    }

    // 目标数据库
    if (!options.create) {
      args.push('-d', options.database)
    }

    // 从 stdin 读取
    args.push('-f', '-')

    // 错误继续（部分失败不中断）
    args.push('--set', 'ON_ERROR_STOP=off')

    return args
  }

  /**
   * 关闭连接（pg_dump/pg_restore/psql 是无状态的不需要关闭）
   */
  async close(): Promise<void> {
    // pg_dump/pg_restore/psql 是无状态命令，无需清理
  }

  /**
   * 构建 pg_dump 参数
   */
  private buildPgDumpArgs(options: DumpOptions): string[] {
    const args: string[] = []

    // 连接参数
    args.push('-h', this.connection.host)
    args.push('-p', String(this.connection.port))
    args.push('-U', this.connection.username)
    args.push('-d', options.database || this.connection.database)

    // SSL
    if (this.connection.ssl) {
      args.push('--ssl-mode=require')
    }

    // Schema
    if (options.schema) {
      args.push('-n', options.schema)
    }

    // 表
    if (options.tables && options.tables.length > 0) {
      for (const table of options.tables) {
        // 支持 schema.table 格式
        const parts = table.split('.')
        if (parts.length === 2) {
          args.push('-t', `${parts[0]}.${parts[1]}`)
        } else {
          args.push('-t', `${options.schema || 'public'}.${table}`)
        }
      }
    }

    // 输出格式
    args.push('-f', '/dev/null') // 我们用 stdout
    args.push('--stdout')

    // 自定义格式（兼容性好）
    // args.push('-Fc')

    return args
  }

  /**
   * 创建环境变量
   */
  private createEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env }
    if (this.password) {
      env.PGPASSWORD = this.password
    }
    // 确保 PATH 包含 pg_dump
    return env
  }
}

/**
 * 创建 PostgreSQL 驱动
 */
export function createPostgreSQLDriver(connection: ResolvedConnection, password?: string): DatabaseDriver {
  return new PostgreSQLDriver(connection, password)
}
