/**
 * EnvSecretResolver 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { EnvSecretResolver } from './env.js'
import type { SecretRef } from '../../core/types.js'

describe('EnvSecretResolver', () => {
  let resolver: EnvSecretResolver

  beforeEach(() => {
    resolver = new EnvSecretResolver()
  })

  describe('resolve()', () => {
    it('should resolve existing environment variable', async () => {
      // Set test env var
      process.env.TEST_DB_PASSWORD = 'my-secret-password'

      const ref: SecretRef = {
        type: 'env',
        envVar: 'TEST_DB_PASSWORD',
      }

      const result = await resolver.resolve(ref)
      expect(result).toBe('my-secret-password')

      // Clean up
      delete process.env.TEST_DB_PASSWORD
    })

    it('should throw when env var does not exist', async () => {
      const ref: SecretRef = {
        type: 'env',
        envVar: 'NON_EXISTENT_VAR_12345',
      }

      await expect(resolver.resolve(ref)).rejects.toThrow('环境变量未设置')
    })

    it('should throw when envVar is not provided', async () => {
      const ref = {
        type: 'env' as const,
        // envVar is intentionally missing
      }

      await expect(resolver.resolve(ref as SecretRef)).rejects.toThrow('envVar 是必填字段')
    })

    it('should throw when secret type is not env', async () => {
      const ref: SecretRef = {
        type: 'k8s',
        secretName: 'my-secret',
        secretKey: 'password',
      }

      await expect(resolver.resolve(ref)).rejects.toThrow('EnvSecretResolver 不支持')
    })

    it('should handle empty string value', async () => {
      process.env.TEST_EMPTY_PASSWORD = ''

      const ref: SecretRef = {
        type: 'env',
        envVar: 'TEST_EMPTY_PASSWORD',
      }

      const result = await resolver.resolve(ref)
      expect(result).toBe('')

      // Clean up
      delete process.env.TEST_EMPTY_PASSWORD
    })

    it('should handle special characters in password', async () => {
      process.env.TEST_SPECIAL_PASSWORD = 'p@ss!#$%^&*()_+-=[]{}|;:\',.<>?/'

      const ref: SecretRef = {
        type: 'env',
        envVar: 'TEST_SPECIAL_PASSWORD',
      }

      const result = await resolver.resolve(ref)
      expect(result).toBe('p@ss!#$%^&*()_+-=[]{}|;:\',.<>?/')

      // Clean up
      delete process.env.TEST_SPECIAL_PASSWORD
    })
  })
})
