/**
 * PostgreSQL Database Driver 单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ResolvedConnection } from '../../core/types.js'
import { PostgreSQLDriver } from './postgresql.js'

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

  describe('type', () => {
    it('should return postgresql as type', () => {
      expect(driver.type).toBe('postgresql')
    })
  })

  describe('connection settings', () => {
    it('should use provided connection settings', () => {
      const driver = new PostgreSQLDriver(mockConnection, 'secret')
      expect(driver.type).toBe('postgresql')
    })

    it('should work without password', () => {
      const driverWithoutPassword = new PostgreSQLDriver(mockConnection)
      expect(driverWithoutPassword.type).toBe('postgresql')
    })
  })

  describe('dump', () => {
    it('should spawn pg_dump with basic arguments', async () => {
      const mockSpawn = vi.fn()
        .mockReturnValue({
          stdout: { on: vi.fn().mockReturnThis(), pipe: vi.fn() },
          stderr: { on: vi.fn() },
          on: vi.fn().mockReturnThis(),
          kill: vi.fn(),
        /* eslint-disable @typescript-eslint/no-explicit-any */
        } as any)

      vi.doMock('node:child_process', async (importOriginal) => {
        const actual = await importOriginal() as Record<string, unknown>
        return {
          ...actual,
          spawn: mockSpawn,
        }
      })

      await driver.dump({ database: 'testdb', tables: [] })

      expect(mockSpawn).toHaveBeenCalledWith(
        'pg_dump',
        expect.arrayContaining([
          '-h', 'localhost',
          '-p', '5432',
          '-U', 'postgres',
          '-d', 'testdb',
        ]),
        expect.any(Object)
      )

      const args = mockSpawn.mock.calls[0]?.[1] as string[]
      expect(args).not.toContain('--stdout')
      expect(args).not.toEqual(expect.arrayContaining(['-f', '/dev/null']))
    })

    it('should use password from connection when constructor password is omitted', async () => {
      const mockSpawn = vi.fn()
        .mockReturnValue({
          stdout: { on: vi.fn().mockReturnThis(), pipe: vi.fn() },
          stderr: { on: vi.fn() },
          on: vi.fn().mockReturnThis(),
          kill: vi.fn(),
        /* eslint-disable @typescript-eslint/no-explicit-any */
        } as any)

      vi.doMock('node:child_process', async (importOriginal) => {
        const actual = await importOriginal() as Record<string, unknown>
        return {
          ...actual,
          spawn: mockSpawn,
        }
      })

      const localDriver = new PostgreSQLDriver(mockConnection)
      await localDriver.dump({ database: 'testdb', tables: [] })

      expect(mockSpawn).toHaveBeenCalledWith(
        'pg_dump',
        expect.any(Array),
        expect.objectContaining({
          env: expect.objectContaining({
            PGPASSWORD: 'secret',
          }),
        })
      )
    })

    it('should emit an error when pg_dump exits with a non-zero code', async () => {
      const stdout = new PassThrough()
      const stderr = new PassThrough()
      const processMock = new EventEmitter() as EventEmitter & {
        stdout: PassThrough
        stderr: PassThrough
        kill: ReturnType<typeof vi.fn>
      }
      processMock.stdout = stdout
      processMock.stderr = stderr
      processMock.kill = vi.fn()

      const mockSpawn = vi.fn().mockReturnValue(processMock)

      vi.doMock('node:child_process', async (importOriginal) => {
        const actual = await importOriginal() as Record<string, unknown>
        return {
          ...actual,
          spawn: mockSpawn,
        }
      })

      const localDriver = new PostgreSQLDriver(mockConnection)
      const stream = await localDriver.dump({ database: 'testdb', tables: [] })

      const streamResult = new Promise<string>((resolve, reject) => {
        stream.on('error', (err) => resolve(err instanceof Error ? err.message : String(err)))
        stream.on('end', () => reject(new Error('stream should not end successfully')))
      })

      stdout.end('partial dump')
      processMock.emit('close', 1)

      await expect(streamResult).resolves.toContain('pg_dump exited with code 1')
    })

    it('should keep the gzip output open until compression finishes flushing', async () => {
      const pgDumpProcess = new EventEmitter() as EventEmitter & {
        stdout: PassThrough
        stderr: PassThrough
        kill: ReturnType<typeof vi.fn>
      }
      pgDumpProcess.stdout = new PassThrough()
      pgDumpProcess.stderr = new PassThrough()
      pgDumpProcess.kill = vi.fn()

      const gzipProcess = new EventEmitter() as EventEmitter & {
        stdin: PassThrough
        stdout: PassThrough
        stderr: PassThrough
      }
      gzipProcess.stdin = new PassThrough()
      gzipProcess.stdout = new PassThrough()
      gzipProcess.stderr = new PassThrough()

      const mockSpawn = vi.fn()
        .mockImplementation((command: string) => {
          if (command === 'pg_dump') {
            return pgDumpProcess
          }
          if (command === 'gzip') {
            return gzipProcess
          }
          throw new Error(`Unexpected command: ${command}`)
        })

      vi.doMock('node:child_process', async (importOriginal) => {
        const actual = await importOriginal() as Record<string, unknown>
        return {
          ...actual,
          spawn: mockSpawn,
        }
      })

      const localDriver = new PostgreSQLDriver(mockConnection)
      const stream = await localDriver.dump({ database: 'testdb', tables: [], compression: 'gzip' })

      const streamResult = new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = []
        stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
        stream.on('error', reject)
      })

      pgDumpProcess.emit('close', 0)
      gzipProcess.stdout.write('compressed-data')
      gzipProcess.stdout.end()
      gzipProcess.emit('close', 0)

      await expect(streamResult).resolves.toBe('compressed-data')
    })

    it('should fail when pg_dump reports no matching tables even if the exit code is zero', async () => {
      const pgDumpProcess = new EventEmitter() as EventEmitter & {
        stdout: PassThrough
        stderr: PassThrough
        kill: ReturnType<typeof vi.fn>
      }
      pgDumpProcess.stdout = new PassThrough()
      pgDumpProcess.stderr = new PassThrough()
      pgDumpProcess.kill = vi.fn()

      const mockSpawn = vi.fn().mockReturnValue(pgDumpProcess)

      vi.doMock('node:child_process', async (importOriginal) => {
        const actual = await importOriginal() as Record<string, unknown>
        return {
          ...actual,
          spawn: mockSpawn,
        }
      })

      const localDriver = new PostgreSQLDriver(mockConnection)
      const stream = await localDriver.dump({ database: 'testdb', tables: ['public.users'] })

      const streamResult = new Promise<string>((resolve, reject) => {
        stream.on('error', (err) => resolve(err instanceof Error ? err.message : String(err)))
        stream.on('end', () => reject(new Error('stream should not end successfully')))
      })

      pgDumpProcess.stderr.write('pg_dump: error: no matching tables were found')
      pgDumpProcess.stdout.end()
      pgDumpProcess.emit('close', 0)

      await expect(streamResult).resolves.toContain('no matching tables were found')
    })

    it('should dump all schemas when no table filter is provided', async () => {
      const mockSpawn = vi.fn()
        .mockReturnValue({
          stdout: { on: vi.fn().mockReturnThis(), pipe: vi.fn() },
          stderr: { on: vi.fn() },
          on: vi.fn().mockReturnThis(),
          kill: vi.fn(),
        /* eslint-disable @typescript-eslint/no-explicit-any */
        } as any)

      vi.doMock('node:child_process', async (importOriginal) => {
        const actual = await importOriginal() as Record<string, unknown>
        return {
          ...actual,
          spawn: mockSpawn,
        }
      })

      await driver.dump({ database: 'testdb', tables: [] })

      const args = mockSpawn.mock.calls[0]?.[1] as string[]
      expect(args).not.toContain('-n')
      expect(args).not.toContain('-t')
    })

    it('should not force the public schema for unqualified table names', async () => {
      const mockSpawn = vi.fn()
        .mockReturnValue({
          stdout: { on: vi.fn().mockReturnThis(), pipe: vi.fn() },
          stderr: { on: vi.fn() },
          on: vi.fn().mockReturnThis(),
          kill: vi.fn(),
        /* eslint-disable @typescript-eslint/no-explicit-any */
        } as any)

      vi.doMock('node:child_process', async (importOriginal) => {
        const actual = await importOriginal() as Record<string, unknown>
        return {
          ...actual,
          spawn: mockSpawn,
        }
      })

      await driver.dump({ database: 'testdb', tables: ['users'] })

      const args = mockSpawn.mock.calls[0]?.[1] as string[]
      expect(args).toContain('users')
      expect(args).not.toContain('public.users')
    })

    it('should preserve schema-qualified table names for cross-schema backups', async () => {
      const mockSpawn = vi.fn()
        .mockReturnValue({
          stdout: { on: vi.fn().mockReturnThis(), pipe: vi.fn() },
          stderr: { on: vi.fn() },
          on: vi.fn().mockReturnThis(),
          kill: vi.fn(),
        /* eslint-disable @typescript-eslint/no-explicit-any */
        } as any)

      vi.doMock('node:child_process', async (importOriginal) => {
        const actual = await importOriginal() as Record<string, unknown>
        return {
          ...actual,
          spawn: mockSpawn,
        }
      })

      await driver.dump({ database: 'testdb', tables: ['public.users', 'audit.logs'] })

      const args = mockSpawn.mock.calls[0]?.[1] as string[]
      expect(args).toContain('public.users')
      expect(args).toContain('audit.logs')
    })
  })

  describe('close', () => {
    it('should return resolved promise', async () => {
      await expect(driver.close()).resolves.toBeUndefined()
    })
  })
})
