/**
 * Executor 单元测试
 */

import { writeFile } from 'node:fs/promises'
import { describe, it, expect, beforeEach } from 'vitest'
import type { DatabaseDriver, StorageDriver, StorageObject } from './interfaces.js'
import type { DumpOptions, ResolvedConfig } from './types.js'
import { DefaultBackupExecutor } from './executor.js'

// Mock DatabaseDriver
class MockDatabaseDriver implements DatabaseDriver {
  readonly type = 'postgresql'
  private connected = true
  private dumpCalled = false
  private dumpCallCount = 0
  private lastDumpOptions?: DumpOptions

  testConnection(): Promise<boolean> {
    return Promise.resolve(this.connected)
  }

  async dump(options: DumpOptions, destFilePath: string): Promise<void> {
    this.dumpCalled = true
    this.dumpCallCount += 1
    this.lastDumpOptions = options
    await writeFile(destFilePath, 'mock dump data')
  }

  close(): Promise<void> {
    return Promise.resolve()
  }

  wasDumpCalled(): boolean {
    return this.dumpCalled
  }

  getLastDumpOptions(): DumpOptions | undefined {
    return this.lastDumpOptions
  }

  getDumpCallCount(): number {
    return this.dumpCallCount
  }
}

// Mock StorageDriver
class MockStorageDriver implements StorageDriver {
  readonly type = 's3'
  private uploadedKey: string | null = null
  private failUploadCount = 0

  async upload(_filePath: string, key: string, contentLength: number): Promise<{ key: string; size: number; etag: string; duration: number }> {
    this.uploadedKey = key

    if (this.failUploadCount > 0) {
      this.failUploadCount -= 1
      throw new Error('Transient upload failure')
    }

    return {
      key,
      size: contentLength,
      etag: 'mock-etag',
      duration: 1,
    }
  }

  failNextUploads(count: number): void {
    this.failUploadCount = count
  }

  delete(_key: string): Promise<void> {
    return Promise.resolve()
  }

  list(_prefix?: string): Promise<StorageObject[]> {
    return Promise.resolve([])
  }

  getUploadedKey(): string | null {
    return this.uploadedKey
  }
}

describe('DefaultBackupExecutor', () => {
  let executor: DefaultBackupExecutor
  let mockDbDriver: MockDatabaseDriver
  let mockStorageDriver: MockStorageDriver

  const createMockConfig = (): ResolvedConfig => ({
    config: {
      name: 'test-backup',
      source: {
        type: 'postgresql',
        connection: {
          host: 'localhost',
          port: 5432,
          username: 'postgres',
          password: 'secret',
          ssl: false,
        },
        database: 'testdb',
        tables: ['public.users'],
      },
      destination: {
        type: 's3',
        s3: {
          endpoint: 'https://s3.amazonaws.com',
          region: 'us-east-1',
          bucket: 'test-bucket',
          accessKeyId: 'xxx',
          secretAccessKey: 'xxx',
          forcePathStyle: false,
        },
      },
    },
    connection: {
      host: 'localhost',
      port: 5432,
      username: 'postgres',
      password: 'secret',
      database: 'testdb',
      ssl: false,
    },
    s3: {
      endpoint: 'https://s3.amazonaws.com',
      region: 'us-east-1',
      bucket: 'test-bucket',
      accessKeyId: 'xxx',
      secretAccessKey: 'xxx',
      forcePathStyle: false,
    },
  })

  beforeEach(() => {
    mockDbDriver = new MockDatabaseDriver()
    mockStorageDriver = new MockStorageDriver()

    executor = new DefaultBackupExecutor({
      databaseDriverFactory: {
        create: () => mockDbDriver,
      },
      storageDriverFactory: {
        create: () => mockStorageDriver,
      },
    })
  })

  it('should execute backup successfully', async () => {
    const config = createMockConfig()
    const result = await executor.execute(config)

    expect(result.status).toBe('completed')
    expect(result.taskName).toBe('test-backup')
    expect(result.fileKey).toBeDefined()
    expect(result.checksum).toBeDefined()
    expect(result.checksum).toContain('sha256')
  })

  it('should generate correct file key', async () => {
    const config = createMockConfig()
    const result = await executor.execute(config)

    expect(result.fileKey).toContain('postgresql')
    expect(result.fileKey).toContain('testdb')
    expect(result.fileKey).toContain('.gz')
  })

  it('should use a flat date segment in the file key when a prefix is provided', async () => {
    const config = createMockConfig()
    config.config.destination.s3!.pathPrefix = '/prod/backups/'
    config.s3!.pathPrefix = '/prod/backups/'

    const result = await executor.execute(config)

    expect(result.fileKey).toMatch(/^prod\/backups\/postgresql\/testdb\/\d{4}-\d{2}-\d{2}\/test-backup-\d{2}-\d{2}-\d{2}\.sql\.gz$/)
  })

  it('should use source.database as the backup target and in the structured key', async () => {
    const config = createMockConfig()
    config.config.source.database = 'taicode-labs'
    config.connection.database = 'postgres'
    config.config.destination.s3!.pathPrefix = 'prod'
    config.s3!.pathPrefix = 'prod'

    const result = await executor.execute(config)

    expect(mockDbDriver.getLastDumpOptions()?.database).toBe('taicode-labs')
    expect(result.fileKey).toContain('prod/postgresql/taicode-labs/')
    expect(result.fileKey).not.toContain('prod/postgresql/postgres/')
  })

  it('should call database dump', async () => {
    const config = createMockConfig()
    await executor.execute(config)

    expect(mockDbDriver.wasDumpCalled()).toBe(true)
  })

  it('should only dump once for a completed backup upload', async () => {
    const config = createMockConfig()
    await executor.execute(config)

    expect(mockDbDriver.getDumpCallCount()).toBe(1)
  })

  it('should not dump again when an upload retry succeeds after a transient storage failure', async () => {
    const config = createMockConfig()
    mockStorageDriver.failNextUploads(1)

    const result = await executor.execute(config)

    expect(result.status).toBe('completed')
    expect(mockDbDriver.getDumpCallCount()).toBe(1)
  })

  it('should call storage upload', async () => {
    const config = createMockConfig()
    const result = await executor.execute(config)

    expect(mockStorageDriver.getUploadedKey()).toBe(result.fileKey)
  })

  it('should track backup metadata', async () => {
    const config = createMockConfig()
    const result = await executor.execute(config)

    expect(result.id).toBeDefined()
    expect(result.startTime).toBeInstanceOf(Date)
    expect(result.endTime).toBeInstanceOf(Date)
    expect(result.duration).toBeGreaterThanOrEqual(0)
    expect(result.tables).toEqual(['public.users'])
  })

  it('should set failed status when connection fails', async () => {
    const failingDriver = new MockDatabaseDriver()
    failingDriver.testConnection = () => Promise.resolve(false)

    const localExecutor = new DefaultBackupExecutor({
      databaseDriverFactory: { create: () => failingDriver },
      storageDriverFactory: { create: () => mockStorageDriver },
    })

    const config = createMockConfig()
    const result = await localExecutor.execute(config)

    expect(result.status).toBe('failed')
    expect(result.error).toBeDefined()
  })

  it('should track size in result', async () => {
    const config = createMockConfig()
    const result = await executor.execute(config)

    expect(result.size).toBeDefined()
    expect(typeof result.size).toBe('number')
  })

  it('should return dry-run-completed without uploading', async () => {
    const config = createMockConfig()
    const result = await executor.execute(config, undefined, true)

    expect(result.status).toBe('dry-run-completed')
    expect(result.checksum).toBeDefined()
    expect(mockStorageDriver.getUploadedKey()).toBeNull()
  })

  it('should fail when the dump stream is empty', async () => {
    const emptyDriver = new MockDatabaseDriver()
    emptyDriver.dump = async (_opts: DumpOptions, destFilePath: string) => { await writeFile(destFilePath, '') }

    const localExecutor = new DefaultBackupExecutor({
      databaseDriverFactory: { create: () => emptyDriver },
      storageDriverFactory: { create: () => mockStorageDriver },
    })

    const config = createMockConfig()
    const result = await localExecutor.execute(config, undefined, true)

    expect(result.status).toBe('failed')
    expect(result.error).toContain('no data')
  })
})
