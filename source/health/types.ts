/**
 * Health Check 类型定义
 */

/**
 * 健康检查状态
 */
export interface HealthStatus {
  /** 状态 */
  status: 'ok' | 'error'
  /** 时间戳 */
  timestamp: string
  /** 检查项详情 */
  checks: {
    database?: DatabaseHealthCheck
  }
}

/**
 * 数据库健康检查
 */
export interface DatabaseHealthCheck {
  /** 状态 */
  status: 'ok' | 'error'
  /** 延迟（毫秒）*/
  latencyMs?: number
  /** 错误信息 */
  error?: string
}

/**
 * HTTP 健康检查响应
 */
export type HealthResponse = HealthStatus
