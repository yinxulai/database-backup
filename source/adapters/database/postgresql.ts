/**
 * PostgreSQL 数据库驱动
 * 
 * 使用 pg_dump / pg_restore / psql 执行 PostgreSQL 数据库备份与恢复
 */

import { promisify } from 'node:util'
import { execFile, spawn } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import type { DatabaseDriver } from '@core/interfaces'
import type { DumpOptions, RestoreOptions, ResolvedConnection } from '@core/types'

const execFileAsync = promisify(execFile)

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
   * 执行数据库备份，将结果写入指定文件
   * 若 options.compression === 'gzip'，输出为 .sql.gz；否则为 plain SQL
   */
  async dump(options: DumpOptions, destFilePath: string): Promise<void> {
    const args = this.buildPgDumpArgs(options, destFilePath)
    const env = this.createEnv()
    await execFileAsync('pg_dump', args, { env })
  }

  /**
   * 执行数据库恢复，从指定文件读取备份数据
   * 根据文件后缀自动选择工具：.gz → psql + gunzip 管道，.sql → psql，custom → pg_restore
   */
  async restore(options: RestoreOptions, srcFilePath: string): Promise<void> {
    const env = this.createEnv()

    if (srcFilePath.endsWith('.sql.gz')) {
      await this.restorePlainGzip(options, srcFilePath, env)
    } else if (srcFilePath.endsWith('.sql')) {
      await this.restorePlain(options, srcFilePath, env)
    } else {
      await this.restoreCustomFormat(options, srcFilePath, env)
    }
  }

  /**
   * 关闭连接（pg_dump/pg_restore/psql 是无状态命令，无需清理）
   */
  async close(): Promise<void> {}

  // ── Restore helpers ─────────────────────────────────────────────────────────

  private async restorePlainGzip(
    options: RestoreOptions,
    srcFilePath: string,
    env: NodeJS.ProcessEnv
  ): Promise<void> {
    // gunzip -c file.sql.gz | psql ...
    const psqlArgs = this.buildPsqlArgs(options)

    const gunzip = spawn('gunzip', ['-c', srcFilePath], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    const psql = spawn('psql', psqlArgs, { env, stdio: ['pipe', 'pipe', 'pipe'] })

    const stderrLines: string[] = []
    gunzip.stderr.on('data', (d: Buffer) => stderrLines.push(`[gunzip] ${d.toString().trim()}`))
    psql.stderr.on('data', (d: Buffer) => stderrLines.push(`[psql] ${d.toString().trim()}`))

    await Promise.all([
      pipeline(gunzip.stdout, psql.stdin),
      this.waitForExit(gunzip, 'gunzip', stderrLines),
      this.waitForExit(psql, 'psql', stderrLines),
    ])
  }

  private async restorePlain(
    options: RestoreOptions,
    srcFilePath: string,
    env: NodeJS.ProcessEnv
  ): Promise<void> {
    const args = [...this.buildPsqlArgs(options), '-f', srcFilePath]
    await execFileAsync('psql', args, { env })
  }

  private async restoreCustomFormat(
    options: RestoreOptions,
    srcFilePath: string,
    env: NodeJS.ProcessEnv
  ): Promise<void> {
    const args = [...this.buildPgRestoreArgs(options), srcFilePath]
    await execFileAsync('pg_restore', args, { env })
  }

  private waitForExit(
    proc: { on(event: 'close', cb: (code: number | null) => void): void },
    name: string,
    stderrLines: string[]
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`${name} exited with code ${code}.\n${stderrLines.join('\n')}`))
        } else {
          resolve()
        }
      })
    })
  }

  // ── Arg builders ─────────────────────────────────────────────────────────────

  private buildPgDumpArgs(options: DumpOptions, destFilePath: string): string[] {
    const args: string[] = []

    args.push('-h', this.connection.host)
    args.push('-p', String(this.connection.port))
    args.push('-U', this.connection.username)
    args.push('-d', options.database || this.connection.database)

    if (this.connection.ssl) {
      args.push('--ssl-mode=require')
    }

    // Schema 筛选（可重复 -n 参数）
    if (options.schemas && options.schemas.length > 0) {
      for (const schema of options.schemas) {
        args.push('-n', schema.trim())
      }
    }

    if (options.tables && options.tables.length > 0) {
      for (const table of options.tables) {
        args.push('-t', table.trim())
      }
    }

    if (options.compression === 'gzip') {
      args.push('--compress=9')
    }

    args.push('-f', destFilePath)

    return args
  }

  private buildPgRestoreArgs(options: RestoreOptions): string[] {
    const args: string[] = []

    args.push('-h', this.connection.host)
    args.push('-p', String(this.connection.port))
    args.push('-U', this.connection.username)

    if (options.create) args.push('--create')
    if (options.clean) args.push('--clean')

    if (options.tables && options.tables.length > 0) {
      for (const table of options.tables) {
        args.push('-t', table.trim())
      }
    }

    if (!options.create) {
      args.push('-d', options.database)
    }

    args.push('--quiet')

    return args
  }

  private buildPsqlArgs(options: RestoreOptions): string[] {
    const args: string[] = []

    args.push('-h', this.connection.host)
    args.push('-p', String(this.connection.port))
    args.push('-U', this.connection.username)

    if (options.create) args.push('--create')

    if (!options.create) {
      args.push('-d', options.database)
    }

    args.push('--set', 'ON_ERROR_STOP=off')

    return args
  }

  private createEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env }
    if (this.password) {
      env.PGPASSWORD = this.password
    }
    return env
  }
}

/**
 * 创建 PostgreSQL 驱动
 */
export function createPostgreSQLDriver(connection: ResolvedConnection, password?: string): DatabaseDriver {
  return new PostgreSQLDriver(connection, password)
}
