/**
 * 保留策略执行器测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RetentionExecutor } from './executor.js'
import type { StorageDriver } from '@core/interfaces'
import type { ResolvedConfig } from '@core/types'

describe('RetentionExecutor', () => {
  let mockStorageDriver: StorageDriver
  let executor: RetentionExecutor

  const mockConfig: ResolvedConfig = {
    config: {
      name: 'test-backup',
      source: {
        type: 'postgresql',
        connection: {
          host: 'localhost',
          port: 5432,
          username: 'postgres',
          password: 'password',
        },
        database: 'testdb',
      },
      destination: {
        type: 's3',
        s3: {
          endpoint: 'https://s3.amazonaws.com',
          region: 'us-east-1',
          bucket: 'test-bucket',
          accessKeyId: 'key',
          secretAccessKey: 'secret',
          pathPrefix: 'backups',
        },
      },
      retention: {
        retentionDays: 7,
      },
    },
    connection: {
      host: 'localhost',
      port: 5432,
      username: 'postgres',
      password: 'password',
      database: 'testdb',
      ssl: false,
    },
    s3: {
      endpoint: 'https://s3.amazonaws.com',
      region: 'us-east-1',
      bucket: 'test-bucket',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      pathPrefix: 'backups',
      forcePathStyle: false,
    },
  }

  beforeEach(() => {
    mockStorageDriver = {
      type: 's3',
      upload: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
    }
    executor = new RetentionExecutor(mockStorageDriver)
  })

  it('should skip when no retention policy is configured', async () => {
    const configWithoutRetention = {
      ...mockConfig,
      config: {
        ...mockConfig.config,
        retention: undefined,
      },
    }

    const result = await executor.applyRetention(configWithoutRetention)

    expect(result.status).toBe('completed')
    expect(result.scannedCount).toBe(0)
    expect(result.deleteCount).toBe(0)
    expect(mockStorageDriver.list).not.toHaveBeenCalled()
  })

  it('should skip when retentionDays is 0', async () => {
    const configZeroRetention = {
      ...mockConfig,
      config: {
        ...mockConfig.config,
        retention: { retentionDays: 0 },
      },
    }

    const result = await executor.applyRetention(configZeroRetention)

    expect(result.status).toBe('completed')
    expect(result.scannedCount).toBe(0)
  })

  it('should delete expired backups', async () => {
    const now = new Date()
    const expiredDate = new Date(now)
    expiredDate.setDate(expiredDate.getDate() - 10)
    const validDate = new Date(now)
    validDate.setDate(validDate.getDate() - 3)

    vi.mocked(mockStorageDriver.list).mockResolvedValue([
      {
        key: 'backups/postgresql-testdb-2026-04-08-12-00-00.sql.gz',
        size: 1024,
        lastModified: expiredDate,
      },
      {
        key: 'backups/postgresql-testdb-2026-04-15-12-00-00.sql.gz',
        size: 2048,
        lastModified: validDate,
      },
    ])

    const result = await executor.applyRetention(mockConfig)

    expect(result.scannedCount).toBe(2)
    expect(result.deleteCount).toBe(1)
    expect(result.deletedCount).toBe(1)
    expect(mockStorageDriver.delete).toHaveBeenCalledTimes(1)
  })

  it('should not delete anything in dry-run mode', async () => {
    const now = new Date()
    const expiredDate = new Date(now)
    expiredDate.setDate(expiredDate.getDate() - 10)

    vi.mocked(mockStorageDriver.list).mockResolvedValue([
      {
        key: 'backups/postgresql-testdb-2026-04-08-12-00-00.sql.gz',
        size: 1024,
        lastModified: expiredDate,
      },
    ])

    const result = await executor.applyRetention(mockConfig, { dryRun: true })

    expect(result.deleteCount).toBe(1)
    expect(result.deletedCount).toBe(0)
    expect(mockStorageDriver.delete).not.toHaveBeenCalled()
  })

  it('should handle empty storage', async () => {
    vi.mocked(mockStorageDriver.list).mockResolvedValue([])

    const result = await executor.applyRetention(mockConfig)

    expect(result.status).toBe('completed')
    expect(result.scannedCount).toBe(0)
    expect(result.deleteCount).toBe(0)
  })

  it('should use S3 LastModified when date cannot be extracted from key', async () => {
    const now = new Date()
    const expiredDate = new Date(now)
    expiredDate.setDate(expiredDate.getDate() - 10)

    // Key without a recognizable date pattern
    vi.mocked(mockStorageDriver.list).mockResolvedValue([
      {
        key: 'backups/unnamed-backup-file.sql.gz',
        size: 1024,
        lastModified: expiredDate,
      },
    ])

    const result = await executor.applyRetention(mockConfig)

    expect(result.deleteCount).toBe(1)
    expect(result.deletedCount).toBe(1)
  })

  it('should return failed status instead of throwing when listing storage fails', async () => {
    vi.mocked(mockStorageDriver.list).mockRejectedValue(new Error('S3 unavailable'))

    const result = await executor.applyRetention(mockConfig)

    expect(result.status).toBe('failed')
    expect(result.error).toContain('S3 unavailable')
  })

  it('should return failed status when deleting expired files fails', async () => {
    const now = new Date()
    const expiredDate = new Date(now)
    expiredDate.setDate(expiredDate.getDate() - 10)

    vi.mocked(mockStorageDriver.list).mockResolvedValue([
      {
        key: 'backups/postgresql-testdb-2026-04-08-12-00-00.sql.gz',
        size: 1024,
        lastModified: expiredDate,
      },
    ])
    vi.mocked(mockStorageDriver.delete).mockRejectedValue(new Error('Delete denied'))

    const result = await executor.applyRetention(mockConfig)

    expect(result.status).toBe('failed')
    expect(result.deletedCount).toBe(0)
    expect(result.error).toContain('Delete denied')
  })
})
