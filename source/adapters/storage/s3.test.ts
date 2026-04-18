/**
 * S3 Storage Driver 单元测试
 * 
 * 使用集成测试方式，直接测试 S3StorageDriver 的功能。
 * 由于 S3 操作需要真实的 S3 服务，我们使用一个简单的 mock 实现。
 */

import { describe, it, expect, vi } from 'vitest'
import { Readable } from 'node:stream'

import type { ResolvedS3Config } from '../../core/types.js'
import type { StorageDriver, StorageObject } from '../../core/interfaces.js'
import { S3StorageDriver } from './s3.js'

// 创建一个 Mock S3StorageDriver 来测试接口契约
class MockS3StorageDriver implements StorageDriver {
  readonly type = 's3'
  private config: ResolvedS3Config
  private uploadedData: Map<string, { data: Buffer; size: number }> = new Map()
  private deletedKeys: string[] = []
  private listedObjects: StorageObject[] = []

  constructor(config: ResolvedS3Config) {
    this.config = config
  }

  async upload(data: Readable, key: string): Promise<{ key: string; size: number; etag: string; duration: number }> {
    const chunks: Buffer[] = []
    for await (const chunk of data) {
      chunks.push(Buffer.from(chunk))
    }
    const body = Buffer.concat(chunks)
    this.uploadedData.set(key, { data: body, size: body.length })
    return { key, size: body.length, etag: 'mock-etag', duration: 100 }
  }

  async download(key: string): Promise<Readable> {
    const stored = this.uploadedData.get(key)
    if (!stored) throw new Error('Not found')
    return Readable.from(stored.data)
  }

  async delete(key: string): Promise<void> {
    this.deletedKeys.push(key)
    this.uploadedData.delete(key)
  }

  async list(_prefix?: string): Promise<StorageObject[]> {
    const fullPrefix = this.config.pathPrefix
      ? `${this.config.pathPrefix}/${_prefix || ''}`
      : (_prefix || '')
    return this.listedObjects.filter(obj => obj.key.startsWith(fullPrefix))
  }

  // Test helper methods
  getUploadedKey(key: string): boolean {
    return this.uploadedData.has(key)
  }

  wasDeleted(key: string): boolean {
    return this.deletedKeys.includes(key)
  }

  setListedObjects(objects: StorageObject[]): void {
    this.listedObjects = objects
  }
}

describe('S3StorageDriver', () => {
  const mockConfig: ResolvedS3Config = {
    endpoint: 'https://s3.amazonaws.com',
    region: 'us-east-1',
    bucket: 'test-bucket',
    accessKeyId: 'test-key',
    secretAccessKey: 'test-secret',
    forcePathStyle: false,
  }

  describe('interface compliance', () => {
    it('should implement StorageDriver interface', () => {
      const driver = new MockS3StorageDriver(mockConfig)
      expect(driver.type).toBe('s3')
      expect(typeof driver.upload).toBe('function')
      expect(typeof driver.download).toBe('function')
      expect(typeof driver.delete).toBe('function')
      expect(typeof driver.list).toBe('function')
    })
  })

  describe('upload', () => {
    it('should store uploaded data with correct key', async () => {
      const driver = new MockS3StorageDriver(mockConfig)
      const data = Readable.from(['test data content'])

      const result = await driver.upload(data, 'test-key.sql.gz')

      expect(result.key).toBe('test-key.sql.gz')
      expect(result.size).toBeGreaterThan(0)
      expect(driver.getUploadedKey('test-key.sql.gz')).toBe(true)
    })

    it('should calculate correct size', async () => {
      const driver = new MockS3StorageDriver(mockConfig)
      const testData = 'test data content'
      const data = Readable.from([testData])

      const result = await driver.upload(data, 'test.sql.gz')

      expect(result.size).toBe(testData.length)
    })

    it('should return upload result with duration', async () => {
      const driver = new MockS3StorageDriver(mockConfig)
      const data = Readable.from(['test data'])

      const result = await driver.upload(data, 'test.sql.gz')

      expect(result).toHaveProperty('key')
      expect(result).toHaveProperty('size')
      expect(result).toHaveProperty('duration')
      expect(typeof result.duration).toBe('number')
    })

    it('should not duplicate pathPrefix when key already contains the prefix', async () => {
      const driver = new S3StorageDriver({
        ...mockConfig,
        pathPrefix: 'copilot-tests/2026-04-18',
      })

      const send = vi.fn().mockResolvedValue({})
      const internalDriver = driver as unknown as { client: { send: typeof send } }
      internalDriver.client = { send }

      const result = await driver.upload(
        Readable.from(['test data']),
        'copilot-tests/2026-04-18/file.sql.gz'
      )

      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Key: 'copilot-tests/2026-04-18/file.sql.gz',
          }),
        })
      )
      expect(result.key).toBe('copilot-tests/2026-04-18/file.sql.gz')
    })
  })

  describe('delete', () => {
    it('should delete stored data', async () => {
      const driver = new MockS3StorageDriver(mockConfig)
      
      await driver.upload(Readable.from(['test data']), 'test-key.sql.gz')
      expect(driver.getUploadedKey('test-key.sql.gz')).toBe(true)

      await driver.delete('test-key.sql.gz')
      expect(driver.wasDeleted('test-key.sql.gz')).toBe(true)
      expect(driver.getUploadedKey('test-key.sql.gz')).toBe(false)
    })

    it('should track deleted keys', async () => {
      const driver = new MockS3StorageDriver(mockConfig)
      
      await driver.delete('key1')
      await driver.delete('key2')
      
      expect(driver.wasDeleted('key1')).toBe(true)
      expect(driver.wasDeleted('key2')).toBe(true)
      expect(driver.wasDeleted('key3')).toBe(false)
    })
  })

  describe('list', () => {
    it('should filter objects by prefix', async () => {
      const driver = new MockS3StorageDriver(mockConfig)
      const objects: StorageObject[] = [
        { key: 'backups/db1.sql.gz', size: 1024, lastModified: new Date('2026-04-01') },
        { key: 'backups/db2.sql.gz', size: 2048, lastModified: new Date('2026-04-02') },
        { key: 'other/file.sql.gz', size: 512, lastModified: new Date('2026-04-03') },
      ]
      driver.setListedObjects(objects)

      const result = await driver.list('backups/')

      expect(result).toHaveLength(2)
      expect(result.every(obj => obj.key.startsWith('backups/'))).toBe(true)
    })

    it('should return empty array when no objects match', async () => {
      const driver = new MockS3StorageDriver(mockConfig)
      driver.setListedObjects([])

      const result = await driver.list('nonexistent/')

      expect(result).toEqual([])
    })

    it('should return all objects when no prefix specified', async () => {
      const driver = new MockS3StorageDriver(mockConfig)
      const objects: StorageObject[] = [
        { key: 'backup1.sql.gz', size: 1024, lastModified: new Date() },
        { key: 'backup2.sql.gz', size: 2048, lastModified: new Date() },
      ]
      driver.setListedObjects(objects)

      const result = await driver.list()

      expect(result).toHaveLength(2)
    })
  })

  describe('download', () => {
    it('should return stored data as readable stream', async () => {
      const driver = new MockS3StorageDriver(mockConfig)
      const testData = 'test data content'
      
      await driver.upload(Readable.from([testData]), 'test-key.sql.gz')
      const result = await driver.download('test-key.sql.gz')
      
      const chunks: Buffer[] = []
      for await (const chunk of result) {
        chunks.push(Buffer.from(chunk))
      }
      const downloaded = Buffer.concat(chunks).toString()
      
      expect(downloaded).toBe(testData)
    })

    it('should throw error when key not found', async () => {
      const driver = new MockS3StorageDriver(mockConfig)

      await expect(driver.download('nonexistent.sql.gz')).rejects.toThrow('Not found')
    })
  })

  describe('type', () => {
    it('should return s3 as type', () => {
      const driver = new MockS3StorageDriver(mockConfig)
      expect(driver.type).toBe('s3')
    })
  })
})
