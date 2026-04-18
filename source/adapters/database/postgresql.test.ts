/**
 * PostgreSQL Database Driver 单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PostgreSQLDriver } from './postgresql.js'
import type { ResolvedConnection } from '@core/types'

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
        } as any)

      // 直接测试 dump 方法的 spawn 调用
      vi.doMock('node:child_process', () => ({
        spawn: mockSpawn,
      }))

      // 重新创建 driver 以使用新的 mock
      const { PostgreSQLDriver: MockedDriver } = await import('./postgresql.js')
      const mockedDriver = new MockedDriver(mockConnection, 'secret')
      await mockedDriver.dump({})

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
    })
  })

  describe('close', () => {
    it('should return resolved promise', async () => {
      await expect(driver.close()).resolves.toBeUndefined()
    })
  })
})
