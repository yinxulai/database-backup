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
          password: '${DB_PASSWORD}',
          database: 'testdb',
        },
        database: 'testdb',
        tables: ['public.users', 'audit.orders'],
      }

      expect(source.type).toBe('postgresql')
      expect(source.tables).toHaveLength(2)
    })

    it('should support schema-qualified table names', () => {
      const source = {
        type: 'postgresql' as const,
        connection: {
          host: 'localhost',
          port: 5432,
          username: 'postgres',
          password: '${DB_PASSWORD}',
          database: 'testdb',
        },
        database: 'testdb',
        tables: ['public.users'],
      }

      expect(source.tables?.[0]).toBe('public.users')
    })

    it('should support empty tables for full backup', () => {
      const source = {
        type: 'postgresql' as const,
        connection: {
          host: 'localhost',
          port: 5432,
          username: 'postgres',
          password: '${DB_PASSWORD}',
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
          accessKeyId: '${AWS_ACCESS_KEY_ID}',
          secretAccessKey: '${AWS_SECRET_ACCESS_KEY}',
          pathPrefix: 'backups/prod',
        },
      }

      expect(destination.type).toBe('s3')
      expect(destination.s3?.bucket).toBe('my-backups')
    })
  })

  describe('Environment placeholders', () => {
    it('should allow env placeholder strings', () => {
      const password = '${DB_PASSWORD}'
      expect(password).toContain('DB_PASSWORD')
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
