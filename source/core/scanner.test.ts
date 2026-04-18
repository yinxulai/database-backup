/**
 * Scanner 单元测试
 */

import { describe, it, expect } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { YamlConfigScanner } from './scanner.js'

describe('YamlConfigScanner', () => {
  describe('validate()', () => {
    const scanner = new YamlConfigScanner()

    it('should validate correct config', () => {
      const config = `
name: test-backup
source:
  type: postgresql
  connection:
    host: localhost
    port: 5432
    username: postgres
    password: \${DB_PASSWORD}
  database: testdb
destination:
  type: s3
  s3:
    endpoint: https://s3.amazonaws.com
    region: us-east-1
    bucket: my-backups
    accessKeyId: \${AWS_ACCESS_KEY_ID}
    secretAccessKey: \${AWS_SECRET_ACCESS_KEY}
`

      const result = scanner.validate(config)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should reject missing name', () => {
      const config = `
source:
  type: postgresql
  connection:
    host: localhost
    port: 5432
    username: postgres
    password: \${DB_PASSWORD}
destination:
  type: s3
  s3:
    endpoint: https://s3.amazonaws.com
    region: us-east-1
    bucket: my-backups
    accessKeyId: \${AWS_ACCESS_KEY_ID}
    secretAccessKey: \${AWS_SECRET_ACCESS_KEY}
`

      const result = scanner.validate(config)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e: { path: string }) => e.path.includes('name'))).toBe(true)
    })

    it('should reject missing source', () => {
      const config = `
name: test-backup
destination:
  type: s3
  s3:
    endpoint: https://s3.amazonaws.com
    region: us-east-1
    bucket: my-backups
    accessKeyId: \${AWS_ACCESS_KEY_ID}
    secretAccessKey: \${AWS_SECRET_ACCESS_KEY}
`

      const result = scanner.validate(config)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e: { path: string }) => e.path.includes('source'))).toBe(true)
    })

    it('should reject missing destination', () => {
      const config = `
name: test-backup
source:
  type: postgresql
  connection:
    host: localhost
    port: 5432
    username: postgres
    password: \${DB_PASSWORD}
  database: testdb
`

      const result = scanner.validate(config)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e: { path: string }) => e.path.includes('destination'))).toBe(true)
    })

    it('should reject invalid database type', () => {
      const config = `
name: test-backup
source:
  type: invalid
  connection:
    host: localhost
    port: 5432
    username: postgres
    password: \${DB_PASSWORD}
  database: testdb
destination:
  type: s3
  s3:
    endpoint: https://s3.amazonaws.com
    region: us-east-1
    bucket: my-backups
    accessKeyId: \${AWS_ACCESS_KEY_ID}
    secretAccessKey: \${AWS_SECRET_ACCESS_KEY}
`

      const result = scanner.validate(config)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e: { message: string }) => e.message.includes('source.type'))).toBe(true)
    })

    it('should accept valid cron expression', () => {
      const config = `
name: test-backup
source:
  type: postgresql
  connection:
    host: localhost
    port: 5432
    username: postgres
    password: \${DB_PASSWORD}
  database: testdb
destination:
  type: s3
  s3:
    endpoint: https://s3.amazonaws.com
    region: us-east-1
    bucket: my-backups
    accessKeyId: \${AWS_ACCESS_KEY_ID}
    secretAccessKey: \${AWS_SECRET_ACCESS_KEY}
schedule:
  cron: "0 2 * * *"
`

      const result = scanner.validate(config)
      expect(result.valid).toBe(true)
    })

    it('should accept plain text credentials for local use', () => {
      const config = `
name: test-backup
source:
  type: postgresql
  connection:
    host: localhost
    port: 5432
    username: postgres
    password: plain-db-password
  database: testdb
destination:
  type: s3
  s3:
    endpoint: https://s3.amazonaws.com
    region: us-east-1
    bucket: my-backups
    accessKeyId: plain-access-key
    secretAccessKey: plain-secret-key
`

      const result = scanner.validate(config)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should accept simplified config format', () => {
      const config = `
name: test-backup
source:
  type: postgresql
  connection:
    host: localhost
    port: 5432
    username: postgres
    password: plain-db-password
  database: testdb
destination:
  type: s3
  s3:
    endpoint: https://s3.amazonaws.com
    region: us-east-1
    bucket: my-backups
    accessKeyId: plain-access-key
    secretAccessKey: plain-secret-key
`

      const result = scanner.validate(config)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })
  })

  describe('scan()', () => {
    const scanner = new YamlConfigScanner()

    it('should normalize simplified config format', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'database-backup-'))
      const filePath = join(dir, 'simple.yaml')

      await writeFile(filePath, `
name: simple-backup
source:
  type: postgresql
  connection:
    host: localhost
    port: 5432
    username: postgres
    password: plain-db-password
  database: testdb
destination:
  type: s3
  s3:
    endpoint: https://s3.amazonaws.com
    region: us-east-1
    bucket: my-backups
    accessKeyId: plain-access-key
    secretAccessKey: plain-secret-key
`)

      const groups = await scanner.scan(filePath)

      expect(groups).toHaveLength(1)
      expect(groups[0]?.name).toBe('simple-backup')
      expect(groups[0]?.source.connection.password).toBe('plain-db-password')
    })

    it('should handle YAML parse errors', () => {
      const config = `
name: test-backup
source:
  type: [invalid yaml
`

      const result = scanner.validate(config)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e: { message: string }) => e.message.includes('YAML'))).toBe(true)
    })
  })
})
