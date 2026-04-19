/**
 * PostgreSQL Database Driver 单元测试
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ResolvedConnection } from '../../core/types.js'
import { PostgreSQLDriver } from './postgresql.js'

// 顶层 mock — 在 postgresql.ts 加载前生效，使 promisify(execFile) 绑定到 mockExecFileCb
const mockExecFileCb = vi.fn()

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return {
    ...actual,
    execFile: (...args: unknown[]) => mockExecFileCb(...args),
  }
})

describe('PostgreSQLDriver', () => {
  let driver: PostgreSQLDriver

  const mockConnection: ResolvedConnection = {
    host: 'localhost',
    port: 5432,
    username: 'postgres',
    password: 'secret',
    database: 'testdb',
    ssl: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    driver = new PostgreSQLDriver(mockConnection, 'secret')
  })

  function succeedExec(assertFn?: (cmd: string, args: string[], opts: { env?: NodeJS.ProcessEnv }) => void) {
    mockExecFileCb.mockImplementation(
      (cmd: string, args: string[], opts: { env?: NodeJS.ProcessEnv }, cb: (err: null, stdout: string, stderr: string) => void) => {
        assertFn?.(cmd, args, opts)
        cb(null, '', '')
      }
    )
  }

  function failExec(code = 1) {
    mockExecFileCb.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error, stdout: string, stderr: string) => void) => {
        cb(Object.assign(new Error(`pg_dump exited with code ${code}`), { code }), '', '')
      }
    )
  }

  async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), 'pg-test-'))
    try {
      return await fn(dir)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  describe('type', () => {
    it('should return postgresql as type', () => {
      expect(driver.type).toBe('postgresql')
    })
  })

  describe('connection settings', () => {
    it('should use provided connection settings', () => {
      expect(new PostgreSQLDriver(mockConnection, 'secret').type).toBe('postgresql')
    })

    it('should work without password', () => {
      expect(new PostgreSQLDriver(mockConnection).type).toBe('postgresql')
    })
  })

  describe('dump', () => {
    it('should call pg_dump with basic connection arguments', async () => {
      succeedExec()
      await withTempDir(async (dir) => {
        const destFile = join(dir, 'dump.sql')
        await driver.dump({ database: 'testdb', tables: [] }, destFile)

        expect(mockExecFileCb).toHaveBeenCalledWith(
          'pg_dump',
          expect.arrayContaining(['-h', 'localhost', '-p', '5432', '-U', 'postgres', '-d', 'testdb', '-f', destFile]),
          expect.any(Object),
          expect.any(Function)
        )
      })
    })

    it('should pass PGPASSWORD in env', async () => {
      succeedExec((_cmd, _args, opts) => {
        expect(opts.env?.PGPASSWORD).toBe('secret')
      })
      await withTempDir(async (dir) => {
        await driver.dump({ database: 'testdb', tables: [] }, join(dir, 'dump.sql'))
      })
    })

    it('should use password from connection when constructor password is omitted', async () => {
      succeedExec((_cmd, _args, opts) => {
        expect(opts.env?.PGPASSWORD).toBe('secret')
      })
      const localDriver = new PostgreSQLDriver(mockConnection)
      await withTempDir(async (dir) => {
        await localDriver.dump({ database: 'testdb', tables: [] }, join(dir, 'dump.sql'))
      })
    })

    it('should reject when pg_dump exits with non-zero code', async () => {
      failExec(1)
      await withTempDir(async (dir) => {
        await expect(
          driver.dump({ database: 'testdb', tables: [] }, join(dir, 'dump.sql'))
        ).rejects.toThrow()
      })
    })

    it('should add --compress=9 flag when compression is gzip', async () => {
      succeedExec((_cmd, args) => {
        expect(args).toContain('--compress=9')
      })
      await withTempDir(async (dir) => {
        await driver.dump({ database: 'testdb', tables: [], compression: 'gzip' }, join(dir, 'dump.sql.gz'))
      })
    })

    it('should not add -t flags when no tables are specified', async () => {
      succeedExec((_cmd, args) => {
        expect(args).not.toContain('-t')
      })
      await withTempDir(async (dir) => {
        await driver.dump({ database: 'testdb', tables: [] }, join(dir, 'dump.sql'))
      })
    })

    it('should not force the public schema for unqualified table names', async () => {
      succeedExec((_cmd, args) => {
        expect(args).toContain('users')
        expect(args).not.toContain('public.users')
      })
      await withTempDir(async (dir) => {
        await driver.dump({ database: 'testdb', tables: ['users'] }, join(dir, 'dump.sql'))
      })
    })

    it('should preserve schema-qualified table names for cross-schema backups', async () => {
      succeedExec((_cmd, args) => {
        expect(args).toContain('public.users')
        expect(args).toContain('audit.logs')
      })
      await withTempDir(async (dir) => {
        await driver.dump({ database: 'testdb', tables: ['public.users', 'audit.logs'] }, join(dir, 'dump.sql'))
      })
    })

    it('should pass the destination file path via -f flag', async () => {
      await withTempDir(async (dir) => {
        const destFile = join(dir, 'dump.sql')
        succeedExec((_cmd, args) => {
          const idx = args.indexOf('-f')
          expect(idx).toBeGreaterThanOrEqual(0)
          expect(args[idx + 1]).toBe(destFile)
        })
        await driver.dump({ database: 'testdb', tables: [] }, destFile)
      })
    })
  })

  describe('close', () => {
    it('should return resolved promise', async () => {
      await expect(driver.close()).resolves.toBeUndefined()
    })
  })
})
