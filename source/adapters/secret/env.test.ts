/**
 * EnvSecretResolver 单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { EnvSecretResolver } from './env.js'
import type { SecretRef } from '../../core/types.js'

describe('EnvSecretResolver', () => {
  let resolver: EnvSecretResolver

  beforeEach(() => {
    resolver = new EnvSecretResolver()
  })

  afterEach(() => {
    // Clean up test env vars
    delete process.env.TEST_DB_PASSWORD
    delete process.env.TEST_EMPTY_PASSWORD
    delete process.env.TEST_SPECIAL_PASSWORD
  })

  describe('resolve()', () => {
    it('should resolve existing environment variable', async () => {
      process.env.TEST_DB_PASSWORD = 'my-secret-password'

      const ref: SecretRef = {
        envVar: 'TEST_DB_PASSWORD',
      }

      const result = await resolver.resolve(ref)
      expect(result).toBe('my-secret-password')
    })

    it('should throw when env var does not exist', async () => {
      const ref: SecretRef = {
        envVar: 'NON_EXISTENT_VAR_12345',
      }

      await expect(resolver.resolve(ref)).rejects.toThrow('环境变量未设置')
    })

    it('should throw when envVar is not provided', async () => {
      const ref = {
        // envVar is intentionally missing
      }

      await expect(resolver.resolve(ref as SecretRef)).rejects.toThrow('envVar 是必填字段')
    })

    it('should throw when envVar is missing on a malformed ref', async () => {
      const ref: SecretRef = {}

      await expect(resolver.resolve(ref)).rejects.toThrow('envVar 是必填字段')
    })

    it('should handle empty string value', async () => {
      process.env.TEST_EMPTY_PASSWORD = ''

      const ref: SecretRef = {
        envVar: 'TEST_EMPTY_PASSWORD',
      }

      const result = await resolver.resolve(ref)
      expect(result).toBe('')
    })

    it('should handle special characters in password', async () => {
      process.env.TEST_SPECIAL_PASSWORD = 'p@ss!#$%^&*()_+-=[]{}|;:\',.<>?/'

      const ref: SecretRef = {
        envVar: 'TEST_SPECIAL_PASSWORD',
      }

      const result = await resolver.resolve(ref)
      expect(result).toBe('p@ss!#$%^&*()_+-=[]{}|;:\',.<>?/')
    })
  })
})
