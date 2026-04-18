
import { createServer, type Server } from 'node:http'
import type { DatabaseDriver } from '@core/interfaces'
import type { HealthStatus } from './types.js'

export interface HealthServerOptions {
  port: number
  databaseDrivers: DatabaseDriver[]
  handler?: (path: string) => Promise<HealthStatus>
}

export function createHealthServer(options: HealthServerOptions): Server {
  const { port, databaseDrivers } = options

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`)

    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Type', 'application/json')

    if (url.pathname === '/health/live') {
      const status: HealthStatus = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        checks: {},
      }
      res.statusCode = 200
      res.end(JSON.stringify(status))
      return
    }

    if (url.pathname === '/health/ready') {
      const result = await checkReadiness(databaseDrivers)
      res.statusCode = result.status === 'ok' ? 200 : 503
      res.end(JSON.stringify(result))
      return
    }

    if (url.pathname === '/health') {
      const result = await checkReadiness(databaseDrivers)
      res.statusCode = result.status === 'ok' ? 200 : 503
      res.end(JSON.stringify(result))
      return
    }

    // Unknown path
    res.statusCode = 404
    res.end(JSON.stringify({ status: 'error', message: 'Not found' }))
  })

  return server
}

async function checkReadiness(drivers: DatabaseDriver[]): Promise<HealthStatus> {
  const checks: HealthStatus['checks'] = {}
  let allHealthy = true

  for (const driver of drivers) {
    const start = Date.now()
    try {
      const connected = await driver.testConnection()
      checks.database = {
        status: connected ? 'ok' : 'error',
        latencyMs: Date.now() - start,
      }
      if (!connected) allHealthy = false
    } catch (err) {
      checks.database = {
        status: 'error',
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      }
      allHealthy = false
    }
  }

  return {
    status: allHealthy ? 'ok' : 'error',
    timestamp: new Date().toISOString(),
    checks,
  }
}
