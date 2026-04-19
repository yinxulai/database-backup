/**
 * Executor 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest'
import type { DumpOptions, ResolvedConfig } from './types.js'
import type { DatabaseDriver, StorageDriver, StorageObject } from './interfaces.js'
import { DefaultBackupExecutor } from './executor.js'
import { Readable } from 'node:stream'

// Mock DatabaseDriver
class MockDatabaseDriver implements DatabaseDriver {
  readonly type = 'postgresql'
  private connected = true
  private dumpCalled = false
  private lastDumpOptions?: DumpOptions

  testConnection(): Promise<boolean> {
    return Promise.resolve(this.connected)
  }

  dump(options: DumpOptions): Promise<Readable> {
    this.dumpCalled = true
    this.lastDumpOptions = options
    return Promise.resolve(Readable.from(['mock dump data']))
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
}

// Mock StorageDriver
class MockStorageDriver implements StorageDriver {
  readonly type = 's3'
  private uploadedKey: string | null = null

  upload(_data: Readable, key: string): Promise<{ key: string; size: number; etag: string; duration: number }> {
    this.uploadedKey = key
    return Promise.resolve({
      key,
      size: 1024,
      etag: 'mock-etag',
      duration: 1,
    })
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

  it('should use pathPrefix in file key when provided', async () => {
    const config = createMockConfig()
    config.config.destination.s3!.pathPrefix = '{{.Database}}/{{.Date}}'
    config.s3!.pathPrefix = '{{.Database}}/{{.Date}}'

    const result = await executor.execute(config)

    expect(result.fileKey).toContain('testdb/')
    expect(result.fileKey).not.toContain('{{.Database}}')
    expect(result.fileKey).not.toContain('{{.Date}}')
  })

  it('should use source.database as the backup target for dump and file key generation', async () => {
    const config = createMockConfig()
    config.config.source.database = 'taicode-labs'
    config.connection.database = 'postgres'
    config.config.destination.s3!.pathPrefix = '{{.Database}}/{{.Date}}'
    config.s3!.pathPrefix = '{{.Database}}/{{.Date}}'

    const result = await executor.execute(config)

    expect(mockDbDriver.getLastDumpOptions()?.database).toBe('taicode-labs')
    expect(result.fileKey).toContain('taicode-labs/')
    expect(result.fileKey).toContain('postgresql-taicode-labs-')
    expect(result.fileKey).not.toContain('postgres/')
  })

  it('should call database dump', async () => {
    const config = createMockConfig()
    await executor.execute(config)

    expect(mockDbDriver.wasDumpCalled()).toBe(true)
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
    const result = await executor.executeTo(config, undefined, true)

    expect(result.status).toBe('dry-run-completed')
    expect(result.checksum).toBeDefined()
    expect(mockStorageDriver.getUploadedKey()).toBeNull()
  })
})
