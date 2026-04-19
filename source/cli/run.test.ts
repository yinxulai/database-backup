import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackupConfig } from '../core/types.js'

const scanMock = vi.fn()
const executeToMock = vi.fn()

vi.mock('@core/scanner', () => ({
  createConfigScanner: () => ({
    scan: scanMock,
  }),
}))

vi.mock('@core/executor', () => ({
  createBackupExecutor: () => ({
    executeTo: executeToMock,
  }),
}))

describe('runCli', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    delete process.env.DB_PASSWORD
    delete process.env.AWS_ACCESS_KEY_ID
    delete process.env.AWS_SECRET_ACCESS_KEY
    executeToMock.mockResolvedValue({ status: 'dry-run-completed' })
  })

  it('should support plain text database password in config', async () => {
    const config: BackupConfig = {
      name: 'test-backup',
      source: {
        type: 'postgresql',
        connection: {
          host: 'localhost',
          port: 5432,
          username: 'postgres',
          password: 'plain-db-password',
          database: 'testdb',
          ssl: false,
        },
        database: 'testdb',
      },
      destination: {
        type: 'local',
        local: {
          path: '/tmp/backups',
        },
      },
    }

    scanMock.mockResolvedValue([config])

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called')
    }) as never)

    const { runCli } = await import('./run.js')

    await expect(runCli(['run', '--config', 'backup.yaml', '--dry-run'])).resolves.toBeUndefined()
    expect(executeToMock).toHaveBeenCalledTimes(1)

    const resolvedConfig = executeToMock.mock.calls[0]?.[0]
    expect(resolvedConfig.connection.password).toBe('plain-db-password')

    exitSpy.mockRestore()
  })

  it('should expand environment placeholders in plain config values', async () => {
    process.env.DB_PASSWORD = 'env-db-password'
    process.env.AWS_ACCESS_KEY_ID = 'env-access-key'
    process.env.AWS_SECRET_ACCESS_KEY = 'env-secret-key'

    const config: BackupConfig = {
      name: 'test-backup',
      source: {
        type: 'postgresql',
        connection: {
          host: 'localhost',
          port: 5432,
          username: 'postgres',
          password: '${DB_PASSWORD}',
          ssl: false,
        },
        database: 'testdb',
      },
      destination: {
        type: 's3',
        s3: {
          endpoint: 'https://s3.example.com',
          region: 'us-east-1',
          bucket: 'test-bucket',
          accessKeyId: '${AWS_ACCESS_KEY_ID}',
          secretAccessKey: '${AWS_SECRET_ACCESS_KEY}',
        },
      },
    }

    scanMock.mockResolvedValue([config])

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called')
    }) as never)

    const { runCli } = await import('./run.js')

    await expect(runCli(['run', '--config', 'backup.yaml', '--dry-run'])).resolves.toBeUndefined()

    const resolvedConfig = executeToMock.mock.calls[0]?.[0]
    expect(resolvedConfig.connection.password).toBe('env-db-password')
    expect(resolvedConfig.s3.accessKeyId).toBe('env-access-key')
    expect(resolvedConfig.s3.secretAccessKey).toBe('env-secret-key')

    exitSpy.mockRestore()
  })

  it('should support plain text s3 credentials in config', async () => {
    const config: BackupConfig = {
      name: 'test-backup',
      source: {
        type: 'postgresql',
        connection: {
          host: 'localhost',
          port: 5432,
          username: 'postgres',
          password: 'plain-db-password',
          database: 'testdb',
          ssl: false,
        },
        database: 'testdb',
      },
      destination: {
        type: 's3',
        s3: {
          endpoint: 'https://s3.example.com',
          region: 'us-east-1',
          bucket: 'test-bucket',
          accessKeyId: 'plain-access-key',
          secretAccessKey: 'plain-secret-key',
        },
      },
    }

    scanMock.mockResolvedValue([config])

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called')
    }) as never)

    const { runCli } = await import('./run.js')

    await expect(runCli(['run', '--config', 'backup.yaml', '--dry-run'])).resolves.toBeUndefined()
    expect(executeToMock).toHaveBeenCalledTimes(1)

    const resolvedConfig = executeToMock.mock.calls[0]?.[0]
    expect(resolvedConfig.s3.accessKeyId).toBe('plain-access-key')
    expect(resolvedConfig.s3.secretAccessKey).toBe('plain-secret-key')

    exitSpy.mockRestore()
  })
})
