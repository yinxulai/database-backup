/**
 * Types 单元测试
 */

import { describe, it, expect } from 'vitest'

describe('Core Types', () => {
  describe('BackupSource', () => {
    it('should accept valid source config', () => {
      const source = {
        type: 'postgresql' as const,
        connection: {
          host: 'localhost',
          port: 5432,
          username: 'postgres',
          passwordSecretRef: { type: 'env' as const, envVar: 'DB_PASSWORD' },
          database: 'testdb',
        },
        database: 'testdb',
        schema: 'public',
        tables: ['users', 'orders'],
      }

      expect(source.type).toBe('postgresql')
      expect(source.tables).toHaveLength(2)
    })

    it('should support optional schema', () => {
      const source = {
        type: 'postgresql' as const,
        connection: {
          host: 'localhost',
          port: 5432,
          username: 'postgres',
          passwordSecretRef: { type: 'env' as const, envVar: 'DB_PASSWORD' },
          database: 'testdb',
        },
        database: 'testdb',
      }

      expect(source.schema).toBeUndefined()
    })

    it('should support empty tables for full backup', () => {
      const source = {
        type: 'postgresql' as const,
        connection: {
          host: 'localhost',
          port: 5432,
          username: 'postgres',
          passwordSecretRef: { type: 'env' as const, envVar: 'DB_PASSWORD' },
          database: 'testdb',
        },
        database: 'testdb',
        tables: [],
      }

      expect(source.tables).toHaveLength(0)
    })
  })

  describe('BackupDestination', () => {
    it('should accept S3 destination', () => {
      const destination = {
        type: 's3' as const,
        s3: {
          endpoint: 'https://s3.amazonaws.com',
          region: 'us-east-1',
          bucket: 'my-backups',
          accessKeySecretRef: { type: 'env' as const, envVar: 'AWS_ACCESS_KEY_ID' },
          secretKeySecretRef: { type: 'env' as const, envVar: 'AWS_SECRET_ACCESS_KEY' },
          pathPrefix: '{{.Database}}/{{.Date}}',
        },
      }

      expect(destination.type).toBe('s3')
      expect(destination.s3?.bucket).toBe('my-backups')
    })
  })

  describe('SecretRef', () => {
    it('should support env type', () => {
      const ref = { type: 'env' as const, envVar: 'DB_PASSWORD' }
      expect(ref.type).toBe('env')
      expect(ref.envVar).toBe('DB_PASSWORD')
    })

    it('should support k8s type', () => {
      const ref = { type: 'k8s' as const, secretName: 'my-secret', secretKey: 'password' }
      expect(ref.type).toBe('k8s')
      expect(ref.secretName).toBe('my-secret')
      expect(ref.secretKey).toBe('password')
    })
  })

  describe('ScheduleConfig', () => {
    it('should accept valid cron expression', () => {
      const schedule = {
        cron: '0 2 * * *',
        timezone: 'Asia/Shanghai',
        enabled: true,
      }

      expect(schedule.cron).toBe('0 2 * * *')
      expect(schedule.timezone).toBe('Asia/Shanghai')
      expect(schedule.enabled).toBe(true)
    })
  })

  describe('BackupResult', () => {
    it('should track backup status', () => {
      const result = {
        id: 'test-id',
        taskName: 'test-backup',
        status: 'running' as const,
        startTime: new Date(),
      }

      expect(result.status).toBe('running')
      expect(result.id).toBe('test-id')
    })

    it('should support completed status with metadata', () => {
      const result = {
        id: 'test-id',
        taskName: 'test-backup',
        status: 'completed' as const,
        startTime: new Date(),
        endTime: new Date(),
        duration: 30,
        size: 1024000,
        checksum: 'sha256:abc123',
        fileKey: 'test/backup-2024.sql.gz',
        tables: ['users', 'orders'],
      }

      expect(result.status).toBe('completed')
      expect(result.duration).toBe(30)
      expect(result.checksum).toContain('sha256')
    })

    it('should support failed status with error', () => {
      const result = {
        id: 'test-id',
        taskName: 'test-backup',
        status: 'failed' as const,
        startTime: new Date(),
        endTime: new Date(),
        duration: 5,
        error: 'Connection refused',
      }

      expect(result.status).toBe('failed')
      expect(result.error).toBe('Connection refused')
    })
  })
})
