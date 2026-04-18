/**
 * @fileoverview Logger tests
 * @module @taicode/backup/core/logger.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createLogger, DefaultLogger } from './logger.js'

describe('Logger', () => {
  let logs: string[] = []
  let originalConsoleLog: typeof console.log

  beforeEach(() => {
    logs = []
    originalConsoleLog = console.log
    console.log = (...args: unknown[]) => {
      logs.push(args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '))
    }
  })

  afterEach(() => {
    console.log = originalConsoleLog
  })

  describe('createLogger', () => {
    it('should create a logger with default level', () => {
      const logger = createLogger()
      logger.info('test message')

      expect(logs.length).toBe(1)
      const entry = JSON.parse(logs[0])
      expect(entry.level).toBe('info')
      expect(entry.message).toBe('test message')
      expect(entry.requestId).toBeDefined()
      expect(entry.timestamp).toBeDefined()
    })

    it('should create logger with custom requestId', () => {
      const logger = createLogger('info', 'custom-id-123')
      logger.info('test')

      const entry = JSON.parse(logs[0])
      expect(entry.requestId).toBe('custom-id-123')
    })
  })

  describe('log levels', () => {
    it('should log info level', () => {
      const logger = createLogger('info')
      logger.info('info message', { key: 'value' })

      const entry = JSON.parse(logs[0])
      expect(entry.level).toBe('info')
      expect(entry.message).toBe('info message')
      expect(entry.metadata.key).toBe('value')
    })

    it('should log warn level', () => {
      const logger = createLogger('info')
      logger.warn('warn message')

      const entry = JSON.parse(logs[0])
      expect(entry.level).toBe('warn')
    })

    it('should log error level', () => {
      const logger = createLogger('info')
      logger.error('error message')

      const entry = JSON.parse(logs[0])
      expect(entry.level).toBe('error')
    })

    it('should not log debug when level is info', () => {
      const logger = createLogger('info')
      logger.debug('debug message')

      expect(logs.length).toBe(0)
    })
  })

  describe('metadata handling', () => {
    it('should include metadata in log entry', () => {
      const logger = createLogger()
      logger.info('backup completed', { database: 'myapp', size: 1024 })

      const entry = JSON.parse(logs[0])
      expect(entry.metadata.database).toBe('myapp')
      expect(entry.metadata.size).toBe(1024)
    })

    it('should extract duration to top level', () => {
      const logger = createLogger()
      logger.info('operation done', { duration: 1500, other: 'data' })

      const entry = JSON.parse(logs[0])
      expect(entry.duration).toBe(1500)
      expect(entry.metadata.other).toBe('data')
      expect(entry.metadata.duration).toBeUndefined()
    })

    it('should not include metadata if not provided', () => {
      const logger = createLogger()
      logger.info('simple message')

      const entry = JSON.parse(logs[0])
      expect(entry.metadata).toBeUndefined()
    })
  })

  describe('child logger', () => {
    it('should create child with new requestId', () => {
      const parent = createLogger('info', 'parent-id')
      const child = parent.child('child-id')

      child.info('from child')

      const entry = JSON.parse(logs[0])
      expect(entry.requestId).toBe('child-id')
    })
  })

  describe('DefaultLogger', () => {
    it('should generate requestId if not provided', () => {
      const logger = new DefaultLogger()
      logger.info('test')

      const entry = JSON.parse(logs[0])
      expect(entry.requestId).toBeDefined()
      expect(entry.requestId.length).toBeGreaterThan(0)
    })

    it('should respect log level threshold', () => {
      const logger = new DefaultLogger('warn')

      logger.debug('should not appear')
      logger.info('should not appear')
      logger.warn('should appear')
      logger.error('should appear')

      expect(logs.length).toBe(2)
    })
  })
})
