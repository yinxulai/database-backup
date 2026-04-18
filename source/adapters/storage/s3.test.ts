/**
 * S3 Storage Driver 单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { S3StorageDriver } from './s3.js'
import type { ResolvedS3Config } from '@core/types'
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3'

// Mock AWS SDK
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(),
  PutObjectCommand: vi.fn(),
  DeleteObjectCommand: vi.fn(),
  ListObjectsV2Command: vi.fn(),
  GetObjectCommand: vi.fn(),
  HeadObjectCommand: vi.fn(),
}))

describe('S3StorageDriver', () => {
  let driver: S3StorageDriver
  let mockSend: ReturnType<typeof vi.fn>

  const mockConfig: ResolvedS3Config = {
    endpoint: 'https://s3.amazonaws.com',
    region: 'us-east-1',
    bucket: 'test-bucket',
    accessKeyId: 'test-key',
    secretAccessKey: 'test-secret',
    forcePathStyle: false,
  }

  const createMockSend = () => {
    return vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockSend = createMockSend()
    ;(S3Client as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      send: mockSend,
    }))
    driver = new S3StorageDriver(mockConfig)
  })

  describe('upload', () => {
    it('should upload data to S3 with correct key', async () => {
      mockSend.mockResolvedValue({ ETag: '"mock-etag"' })

      const { Readable } = await import('node:stream')
      const data = Readable.from(['test data content'])

      const result = await driver.upload(data, 'test-key.sql.gz')

      expect(PutObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'test-key.sql.gz',
        Body: expect.any(Buffer),
        ContentType: 'application/octet-stream',
      })
      expect(result.key).toBe('test-key.sql.gz')
      expect(result.size).toBeGreaterThan(0)
    })

    it('should prepend pathPrefix to key when configured', async () => {
      const configWithPrefix: ResolvedS3Config = {
        ...mockConfig,
        pathPrefix: 'backups/testdb',
      }
      driver = new S3StorageDriver(configWithPrefix)
      mockSend.mockResolvedValue({ ETag: '"mock-etag"' })

      const { Readable } = await import('node:stream')
      const data = Readable.from(['test data'])

      await driver.upload(data, 'backup.sql.gz')

      expect(PutObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: 'backups/testdb/backup.sql.gz',
        })
      )
    })

    it('should return upload result with size and duration', async () => {
      mockSend.mockResolvedValue({ ETag: '"mock-etag"' })

      const { Readable } = await import('node:stream')
      const data = Readable.from(['test data'])

      const result = await driver.upload(data, 'test.sql.gz')

      expect(result).toHaveProperty('key')
      expect(result).toHaveProperty('size')
      expect(result).toHaveProperty('duration')
      expect(typeof result.duration).toBe('number')
    })
  })

  describe('delete', () => {
    it('should delete object from S3', async () => {
      mockSend.mockResolvedValue({})

      await driver.delete('test-key.sql.gz')

      expect(DeleteObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'test-key.sql.gz',
      })
    })

    it('should prepend pathPrefix to key when configured', async () => {
      const configWithPrefix: ResolvedS3Config = {
        ...mockConfig,
        pathPrefix: 'backups',
      }
      driver = new S3StorageDriver(configWithPrefix)
      mockSend.mockResolvedValue({})

      await driver.delete('old-backup.sql.gz')

      expect(DeleteObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: 'backups/old-backup.sql.gz',
        })
      )
    })
  })

  describe('list', () => {
    it('should list objects with given prefix', async () => {
      mockSend.mockResolvedValue({
        Contents: [
          { Key: 'backups/db1.sql.gz', Size: 1024, LastModified: new Date('2026-04-01') },
          { Key: 'backups/db2.sql.gz', Size: 2048, LastModified: new Date('2026-04-02') },
        ],
      })

      const result = await driver.list('backups/')

      expect(ListObjectsV2Command).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Prefix: 'backups/',
        ContinuationToken: undefined,
      })
      expect(result).toHaveLength(2)
      expect(result[0].key).toBe('backups/db1.sql.gz')
      expect(result[0].size).toBe(1024)
    })

    it('should use pathPrefix as default prefix when configured', async () => {
      const configWithPrefix: ResolvedS3Config = {
        ...mockConfig,
        pathPrefix: 'backups/testdb',
      }
      driver = new S3StorageDriver(configWithPrefix)
      mockSend.mockResolvedValue({ Contents: [] })

      await driver.list()

      expect(ListObjectsV2Command).toHaveBeenCalledWith(
        expect.objectContaining({
          Prefix: 'backups/testdb',
        })
      )
    })

    it('should handle pagination correctly', async () => {
      mockSend
        .mockResolvedValueOnce({
          Contents: [{ Key: 'backup1.sql.gz', Size: 1024, LastModified: new Date() }],
          NextContinuationToken: 'token-1',
        })
        .mockResolvedValueOnce({
          Contents: [{ Key: 'backup2.sql.gz', Size: 2048, LastModified: new Date() }],
        })

      const result = await driver.list()

      expect(mockSend).toHaveBeenCalledTimes(2)
      expect(result).toHaveLength(2)
    })

    it('should return empty array when no objects found', async () => {
      mockSend.mockResolvedValue({ Contents: undefined })

      const result = await driver.list()

      expect(result).toEqual([])
    })
  })

  describe('download', () => {
    it('should download object from S3', async () => {
      const mockStream = {
        on: vi.fn().mockReturnThis(),
        pipe: vi.fn().mockReturnThis(),
      }
      mockSend.mockResolvedValue({ Body: mockStream })

      const result = await driver.download('test-key.sql.gz')

      expect(GetObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'test-key.sql.gz',
      })
      expect(result).toBe(mockStream)
    })

    it('should prepend pathPrefix to key when configured', async () => {
      const configWithPrefix: ResolvedS3Config = {
        ...mockConfig,
        pathPrefix: 'backups',
      }
      driver = new S3StorageDriver(configWithPrefix)
      mockSend.mockResolvedValue({ Body: { on: vi.fn() } })

      await driver.download('test.sql.gz')

      expect(GetObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: 'backups/test.sql.gz',
        })
      )
    })
  })

  describe('head', () => {
    it('should return object metadata', async () => {
      mockSend.mockResolvedValue({
        ContentLength: 1024,
        LastModified: new Date('2026-04-01'),
      })

      const result = await driver.head('test-key.sql.gz')

      expect(HeadObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'test-key.sql.gz',
      })
      expect(result).toEqual({
        size: 1024,
        lastModified: expect.any(Date),
      })
    })

    it('should return null when object not found', async () => {
      mockSend.mockRejectedValue(new Error('NotFound'))

      const result = await driver.head('nonexistent.sql.gz')

      expect(result).toBeNull()
    })

    it('should prepend pathPrefix to key when configured', async () => {
      const configWithPrefix: ResolvedS3Config = {
        ...mockConfig,
        pathPrefix: 'backups',
      }
      driver = new S3StorageDriver(configWithPrefix)
      mockSend.mockResolvedValue({ ContentLength: 512, LastModified: new Date() })

      await driver.head('test.sql.gz')

      expect(HeadObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: 'backups/test.sql.gz',
        })
      )
    })
  })

  describe('type', () => {
    it('should return s3 as type', () => {
      expect(driver.type).toBe('s3')
    })
  })
})
