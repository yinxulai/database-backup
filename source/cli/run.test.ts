import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackupGroup, SecretRef } from '../core/types.js'

const scanMock = vi.fn()
const executeToMock = vi.fn()
const resolveMock = vi.fn(async (ref?: SecretRef) => {
  if (!ref) {
    throw new Error('missing secret ref')
  }

  if (ref.type === 'env' && ref.envVar) {
    return process.env[ref.envVar] ?? ''
  }

  return 'resolved-secret'
})

vi.mock('@core/scanner', () => ({
  createConfigScanner: () => ({
    scan: scanMock,
  }),
}))

vi.mock('@adapters/secret/env', () => ({
  createEnvSecretResolver: () => ({
    resolve: resolveMock,
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
    executeToMock.mockResolvedValue({ status: 'dry-run-completed' })
  })

  it('should support plain text database password in config', async () => {
    const group: BackupGroup = {
      apiVersion: 'database-backup.yinxulai/v1',
      kind: 'BackupGroup',
      metadata: { name: 'test-backup' },
      spec: {
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
      },
    }

    scanMock.mockResolvedValue([group])

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called')
    }) as never)

    const { runCli } = await import('./run.js')

    await expect(runCli(['run', '--config', 'backup.yaml', '--dry-run'])).resolves.toBeUndefined()
    expect(executeToMock).toHaveBeenCalledTimes(1)

    const resolvedConfig = executeToMock.mock.calls[0]?.[0]
    expect(resolvedConfig.connection.password).toBe('plain-db-password')
    expect(resolveMock).not.toHaveBeenCalled()

    exitSpy.mockRestore()
  })

  it('should support plain text s3 credentials in config', async () => {
    const group: BackupGroup = {
      apiVersion: 'database-backup.yinxulai/v1',
      kind: 'BackupGroup',
      metadata: { name: 'test-backup' },
      spec: {
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
      },
    }

    scanMock.mockResolvedValue([group])

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called')
    }) as never)

    const { runCli } = await import('./run.js')

    await expect(runCli(['run', '--config', 'backup.yaml', '--dry-run'])).resolves.toBeUndefined()
    expect(executeToMock).toHaveBeenCalledTimes(1)

    const resolvedConfig = executeToMock.mock.calls[0]?.[0]
    expect(resolvedConfig.s3.accessKeyId).toBe('plain-access-key')
    expect(resolvedConfig.s3.secretAccessKey).toBe('plain-secret-key')
    expect(resolveMock).not.toHaveBeenCalled()

    exitSpy.mockRestore()
  })
})
