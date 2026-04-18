/**
 * Scanner 单元测试
 */

import { describe, it, expect } from 'vitest'
import { YamlConfigScanner } from './scanner.js'

describe('YamlConfigScanner', () => {
  describe('validate()', () => {
    const scanner = new YamlConfigScanner()

    it('should validate correct config', () => {
      const config = `
apiVersion: backup.taicode/v1
kind: BackupGroup
metadata:
  name: test-backup
spec:
  source:
    type: postgresql
    connection:
      host: localhost
      port: 5432
      username: postgres
      passwordSecretRef:
        type: env
        envVar: DB_PASSWORD
    database: testdb
  destination:
    type: s3
    s3:
      endpoint: https://s3.amazonaws.com
      region: us-east-1
      bucket: my-backups
`

      const result = scanner.validate(config)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should reject invalid apiVersion', () => {
      const config = `
apiVersion: invalid/version
kind: BackupGroup
metadata:
  name: test-backup
spec:
  source:
    type: postgresql
    connection:
      host: localhost
      port: 5432
      username: postgres
      passwordSecretRef:
        type: env
        envVar: DB_PASSWORD
    database: testdb
  destination:
    type: s3
    s3:
      endpoint: https://s3.amazonaws.com
      region: us-east-1
      bucket: my-backups
`

      const result = scanner.validate(config)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e: { message: string }) => e.message.includes('apiVersion'))).toBe(true)
    })

    it('should reject missing metadata.name', () => {
      const config = `
apiVersion: backup.taicode/v1
kind: BackupGroup
metadata: {}
spec:
  source:
    type: postgresql
    connection:
      host: localhost
      port: 5432
      username: postgres
      passwordSecretRef:
        type: env
        envVar: DB_PASSWORD
    database: testdb
  destination:
    type: s3
    s3:
      endpoint: https://s3.amazonaws.com
      region: us-east-1
      bucket: my-backups
`

      const result = scanner.validate(config)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e: { path: string }) => e.path.includes('metadata.name'))).toBe(true)
    })

    it('should reject missing source', () => {
      const config = `
apiVersion: backup.taicode/v1
kind: BackupGroup
metadata:
  name: test-backup
spec:
  destination:
    type: s3
    s3:
      endpoint: https://s3.amazonaws.com
      region: us-east-1
      bucket: my-backups
`

      const result = scanner.validate(config)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e: { path: string }) => e.path.includes('spec.source'))).toBe(true)
    })

    it('should reject missing destination', () => {
      const config = `
apiVersion: backup.taicode/v1
kind: BackupGroup
metadata:
  name: test-backup
spec:
  source:
    type: postgresql
    connection:
      host: localhost
      port: 5432
      username: postgres
      passwordSecretRef:
        type: env
        envVar: DB_PASSWORD
    database: testdb
`

      const result = scanner.validate(config)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e: { path: string }) => e.path.includes('spec.destination'))).toBe(true)
    })

    it('should reject invalid database type', () => {
      const config = `
apiVersion: backup.taicode/v1
kind: BackupGroup
metadata:
  name: test-backup
spec:
  source:
    type: invalid
    connection:
      host: localhost
      port: 5432
      username: postgres
      passwordSecretRef:
        type: env
        envVar: DB_PASSWORD
    database: testdb
  destination:
    type: s3
    s3:
      endpoint: https://s3.amazonaws.com
      region: us-east-1
      bucket: my-backups
`

      const result = scanner.validate(config)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e: { message: string }) => e.message.includes('source.type'))).toBe(true)
    })

    it('should accept valid cron expression', () => {
      const config = `
apiVersion: backup.taicode/v1
kind: BackupGroup
metadata:
  name: test-backup
spec:
  source:
    type: postgresql
    connection:
      host: localhost
      port: 5432
      username: postgres
      passwordSecretRef:
        type: env
        envVar: DB_PASSWORD
    database: testdb
  destination:
    type: s3
    s3:
      endpoint: https://s3.amazonaws.com
      region: us-east-1
      bucket: my-backups
  schedule:
    cron: "0 2 * * *"
`

      const result = scanner.validate(config)
      expect(result.valid).toBe(true)
    })

    it('should handle YAML parse errors', () => {
      const config = `
apiVersion: backup.taicode/v1
kind: BackupGroup
metadata:
  name: test-backup
spec:
  source:
    type: [invalid yaml
`

      const result = scanner.validate(config)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e: { message: string }) => e.message.includes('YAML'))).toBe(true)
    })
  })
})
