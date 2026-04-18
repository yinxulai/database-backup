/**
 * Health Check Server 测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHealthServer } from './server.js'
import type { DatabaseDriver } from '@core/interfaces'

describe('createHealthServer', () => {
  let mockDriver: DatabaseDriver

  beforeEach(() => {
    mockDriver = {
      type: 'postgresql',
      testConnection: vi.fn(),
      dump: vi.fn(),
      close: vi.fn(),
    }
  })

  it('should return 200 for /health/live', async () => {
    const server = createHealthServer({
      port: 0, // 0 = random available port
      databaseDrivers: [mockDriver],
    })

    await new Promise<void>((resolve) => server.listen(0, resolve))
    const address = server.address() as { port: number }

    try {
      const response = await fetch(`http://localhost:${address.port}/health/live`)
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.status).toBe('ok')
      expect(body.timestamp).toBeDefined()
    } finally {
      server.close()
    }
  })

  it('should return 200 for /health/ready when DB is connected', async () => {
    vi.mocked(mockDriver.testConnection).mockResolvedValue(true)

    const server = createHealthServer({
      port: 0,
      databaseDrivers: [mockDriver],
    })

    await new Promise<void>((resolve) => server.listen(0, resolve))
    const address = server.address() as { port: number }

    try {
      const response = await fetch(`http://localhost:${address.port}/health/ready`)
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.status).toBe('ok')
    } finally {
      server.close()
    }
  })

  it('should return 503 for /health/ready when DB is not connected', async () => {
    vi.mocked(mockDriver.testConnection).mockResolvedValue(false)

    const server = createHealthServer({
      port: 0,
      databaseDrivers: [mockDriver],
    })

    await new Promise<void>((resolve) => server.listen(0, resolve))
    const address = server.address() as { port: number }

    try {
      const response = await fetch(`http://localhost:${address.port}/health/ready`)
      expect(response.status).toBe(503)
    } finally {
      server.close()
    }
  })

  it('should return 404 for unknown paths', async () => {
    const server = createHealthServer({
      port: 0,
      databaseDrivers: [mockDriver],
    })

    await new Promise<void>((resolve) => server.listen(0, resolve))
    const address = server.address() as { port: number }

    try {
      const response = await fetch(`http://localhost:${address.port}/unknown`)
      expect(response.status).toBe(404)
    } finally {
      server.close()
    }
  })
})
