/**
 * PostgreSQL 数据库驱动
 * 
 * 使用 pg_dump 执行 PostgreSQL 数据库备份
 */

import { promisify } from 'node:util'
import { execFile, type ChildProcess } from 'node:child_process'
import { PassThrough, type Readable, type Writable } from 'node:stream'
import type { DatabaseDriver } from '@core/interfaces'
import type { DumpOptions, RestoreOptions, ResolvedConnection } from '@core/types'

const execFileAsync = promisify(execFile)

interface StreamProcess extends ChildProcess {
  stdout: Readable
  stderr: Readable
  stdin: Writable | null
}

/**
 * PostgreSQL 数据库驱动
 */
export class PostgreSQLDriver implements DatabaseDriver {
  readonly type = 'postgresql'
  private password?: string

  constructor(
    private connection: ResolvedConnection,
    password?: string
  ) {
    this.password = password ?? connection.password
  }

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

    const { spawn } = await import('node:child_process')
    const output = new PassThrough()
    const pgDump = spawn('pg_dump', args, { env, stdio: ['ignore', 'pipe', 'pipe'] }) as StreamProcess
    const pgDumpState = this.attachProcessLogging(pgDump, 'pg_dump', output)

    let compressionProcess: StreamProcess | undefined

    if (options.compression === 'gzip') {
      compressionProcess = spawn('gzip', ['-c'], { stdio: ['pipe', 'pipe', 'pipe'] }) as StreamProcess
      this.attachProcessLogging(compressionProcess, 'gzip', output)

      pgDump.stdout.pipe(compressionProcess.stdin!)
      compressionProcess.stdout.pipe(output, { end: false })
    } else {
      pgDump.stdout.pipe(output, { end: false })
    }

    this.finalizeDumpStream(output, pgDump, pgDumpState, compressionProcess)
    return output
  }

  private attachProcessLogging(
    process: StreamProcess,
    name: string,
    output: PassThrough
  ): { stderr: string } {
    const state = { stderr: '' }

    process.stderr.on('data', (data: Buffer | string) => {
      const message = data.toString()
      state.stderr += message
      console.error(`[${name}] ${message.trim()}`)
    })

    process.on('error', (err) => output.destroy(err))
    return state
  }

  private finalizeDumpStream(
    output: PassThrough,
    pgDump: StreamProcess,
    pgDumpState: { stderr: string },
    compressionProcess?: StreamProcess
  ): void {
    const completion = [
      this.waitForProcessExit(pgDump, 'pg_dump', pgDumpState),
      compressionProcess
        ? this.waitForProcessExit(compressionProcess, 'gzip', undefined, () => pgDump.kill())
        : Promise.resolve(),
    ]

    Promise.all(completion)
      .then(() => {
        if (!output.destroyed) {
          output.end()
        }
      })
      .catch((err) => {
        output.destroy(err instanceof Error ? err : new Error(String(err)))
      })
  }

  private waitForProcessExit(
    process: StreamProcess,
    name: string,
    state?: { stderr: string },
    onFailure?: () => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      process.on('close', (code) => {
        if (code !== 0) {
          onFailure?.()
          reject(new Error(`${name} exited with code ${code}`))
          return
        }

        if (name === 'pg_dump' && /no matching tables were found/i.test(state?.stderr ?? '')) {
          reject(new Error('pg_dump error: no matching tables were found'))
          return
        }

        resolve()
      })
    })
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

    // 表过滤
    if (options.tables && options.tables.length > 0) {
      for (const table of options.tables) {
        args.push('-t', this.buildTableFilter(table))
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

    // 表
    if (options.tables && options.tables.length > 0) {
      for (const table of options.tables) {
        args.push('-t', this.buildTableFilter(table))
      }
    }

    // 默认输出到 stdout，由调用方读取流

    // 自定义格式（兼容性好）
    // args.push('-Fc')

    return args
  }

  /**
   * Build table filter argument.
   * Supports either a plain table name or a schema-qualified name like public.users.
   */
  private buildTableFilter(table: string): string {
    return table.trim()
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
