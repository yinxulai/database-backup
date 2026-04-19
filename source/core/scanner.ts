/**
 * 配置扫描器
 * 
 * 负责读取和解析 YAML/JSON 配置文件
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import YAML from 'yaml'
import type {
  BackupConfig,
  DatabaseType,
  StorageType,
} from './types.js'
import type {
  ConfigScanner,
  ValidationResult,
  ValidationError,
} from './interfaces.js'

/**
 * YAML 配置扫描器
 */
export class YamlConfigScanner implements ConfigScanner {
  /**
   * 扫描配置文件
   */
  async scan(path: string): Promise<BackupConfig[]> {
    const content = await readFile(resolve(path), 'utf-8')
    const parsed = YAML.parse(content)

    // 支持单个配置或数组
    if (Array.isArray(parsed)) {
      return parsed.map((config) => this.normalizeConfig(config as Record<string, unknown>))
    }

    // 单个配置
    return [this.normalizeConfig(parsed as Record<string, unknown>)]
  }

  /**
   * 扫描多个配置文件
   */
  async scanMultiple(paths: string[]): Promise<BackupConfig[]> {
    const results = await Promise.all(paths.map((p) => this.scan(p)))
    return results.flat()
  }

  /**
   * 校验配置内容
   */
  validate(content: string): ValidationResult {
    const errors: ValidationError[] = []

    let parsed: unknown
    try {
      parsed = YAML.parse(content)
    } catch (err) {
      errors.push({
        path: '',
        message: `YAML 解析失败: ${err instanceof Error ? err.message : String(err)}`,
      })
      return { valid: false, errors }
    }

    if (!parsed || typeof parsed !== 'object') {
      errors.push({
        path: '',
        message: '配置格式错误：期望是对象或数组',
      })
      return { valid: false, errors }
    }

    // 标准化为数组
    const configs = Array.isArray(parsed) ? parsed : [parsed]

    for (let i = 0; i < configs.length; i++) {
      const config = configs[i] as Record<string, unknown>
      this.validateConfig(config, i, errors)
    }

    return {
      valid: errors.length === 0,
      errors,
    }
  }

  /**
   * 归一化配置格式
   */
  private normalizeConfig(config: Record<string, unknown>): BackupConfig {
    const name = typeof config.name === 'string' && config.name.trim().length > 0
      ? config.name.trim()
      : 'default-backup'

    return {
      name,
      source: config.source as BackupConfig['source'],
      destination: config.destination as BackupConfig['destination'],
      schedule: config.schedule as BackupConfig['schedule'],
      retention: config.retention as BackupConfig['retention'],
    }
  }

  /**
   * 校验单个配置
   */
  private validateConfig(config: Record<string, unknown>, index: number, errors: ValidationError[]): void {
    const prefix = Array.isArray(config) ? `[${index}].` : ''

    if (!config.name) {
      errors.push({
        path: `${prefix}name`,
        message: 'name 是必填字段',
      })
    }

    const source = config.source as Record<string, unknown> | undefined
    if (!source) {
      errors.push({
        path: `${prefix}source`,
        message: 'source 是必填字段',
      })
    } else {
      this.validateSource(source, `${prefix}source`, errors)
    }

    const destination = config.destination as Record<string, unknown> | undefined
    if (!destination) {
      errors.push({
        path: `${prefix}destination`,
        message: 'destination 是必填字段',
      })
    } else {
      this.validateDestination(destination, `${prefix}destination`, errors)
    }

    const schedule = config.schedule as BackupConfig['schedule'] | undefined
    if (schedule?.cron && !this.isValidCron(schedule.cron)) {
      errors.push({
        path: `${prefix}schedule.cron`,
        message: `无效的 Cron 表达式: ${schedule.cron}`,
      })
    }
  }

  /**
   * 校验 source 配置
   */
  private validateSource(source: Record<string, unknown>, prefix: string, errors: ValidationError[]): void {
    // type
    const validDbTypes: DatabaseType[] = ['postgresql', 'mysql', 'mongodb', 'redis']
    if (!validDbTypes.includes(source.type as DatabaseType)) {
      errors.push({
        path: `${prefix}.type`,
        message: `source.type 必须是 ${validDbTypes.join(' | ')} 之一`,
      })
    }

    // connection
    if (!source.connection) {
      errors.push({
        path: `${prefix}.connection`,
        message: 'source.connection 是必填字段',
      })
    } else {
      const conn = source.connection as Record<string, unknown>
      if (!conn.host) {
        errors.push({ path: `${prefix}.connection.host`, message: 'host 是必填字段' })
      }
      if (!conn.port || typeof conn.port !== 'number') {
        errors.push({ path: `${prefix}.connection.port`, message: 'port 是必填字段且必须是数字' })
      }
      if (!conn.username) {
        errors.push({ path: `${prefix}.connection.username`, message: 'username 是必填字段' })
      }
      if (!conn.password) {
        errors.push({ path: `${prefix}.connection.password`, message: 'password 是必填字段，可直接填写或使用 ${ENV_VAR}' })
      }
      if (conn.database !== undefined) {
        errors.push({
          path: `${prefix}.connection.database`,
          message: 'source.connection.database 已不再支持，请只使用 source.database',
        })
      }
    }

    // database
    if (!source.database) {
      errors.push({
        path: `${prefix}.database`,
        message: 'database 是必填字段',
      })
    }
  }

  /**
   * 校验 destination 配置
   */
  private validateDestination(destination: Record<string, unknown>, prefix: string, errors: ValidationError[]): void {
    // type
    const validStorageTypes: StorageType[] = ['s3', 'gcs', 'azure', 'local']
    if (!validStorageTypes.includes(destination.type as StorageType)) {
      errors.push({
        path: `${prefix}.type`,
        message: `destination.type 必须是 ${validStorageTypes.join(' | ')} 之一`,
      })
    }

    // s3 配置
    if (destination.type === 's3') {
      const s3 = destination.s3 as Record<string, unknown> | undefined
      if (!s3) {
        errors.push({ path: `${prefix}.s3`, message: 'destination.s3 是必填字段' })
        return
      }
      if (!s3.endpoint) {
        errors.push({ path: `${prefix}.s3.endpoint`, message: 'endpoint 是必填字段' })
      }
      if (!s3.region) {
        errors.push({ path: `${prefix}.s3.region`, message: 'region 是必填字段' })
      }
      if (!s3.bucket) {
        errors.push({ path: `${prefix}.s3.bucket`, message: 'bucket 是必填字段' })
      }
      if (!s3.accessKeyId) {
        errors.push({ path: `${prefix}.s3.accessKeyId`, message: 'accessKeyId 是必填字段，可直接填写或使用 ${ENV_VAR}' })
      }
      if (!s3.secretAccessKey) {
        errors.push({ path: `${prefix}.s3.secretAccessKey`, message: 'secretAccessKey 是必填字段，可直接填写或使用 ${ENV_VAR}' })
      }
    }
  }

  /**
   * 校验 Cron 表达式（简化版）
   */
  private isValidCron(cron: string): boolean {
    // 简化校验：检查是否是 5 段格式
    const parts = cron.trim().split(/\s+/)
    return parts.length === 5
  }
}

/**
 * 创建配置扫描器
 */
export function createConfigScanner(): ConfigScanner {
  return new YamlConfigScanner()
}
