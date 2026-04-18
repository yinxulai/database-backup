/**
 * Health Check HTTP Server
 * 
 * 提供 /health/live 和 /health/ready 端点
 */

import { createServer, type Server } from 'node:http'
import type { DatabaseDriver } from '../core/interfaces.js'
import type { HealthStatus } from './types.js'

/**
 * 健康检查服务器选项
 */
export interface HealthServerOptions {
  /** HTTP 端口 */
  port: number
  /** 数据库驱动列表（用于 readiness 检查）*/
  databaseDrivers: DatabaseDriver[]
  /** 健康检查处理器 */
  handler?: (path: string) => Promise<HealthStatus>
}

/**
 * 创建健康检查服务器
 */
export function createHealthServer(options: HealthServerOptions): Server {
  const { port, databaseDrivers } = options

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`)

    // CORS headers for k8s probes
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Type', 'application/json')

    if (url.pathname === '/health/live') {
      // Liveness probe - 进程是否存活
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
      // Readiness probe - 数据库连接是否正常
      const result = await checkReadiness(databaseDrivers)
      res.statusCode = result.status === 'ok' ? 200 : 503
      res.end(JSON.stringify(result))
      return
    }

    if (url.pathname === '/health') {
      // Summary endpoint
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

/**
 * 检查就绪状态
 */
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
