/**
 * 环境变量密钥解析器
 * 
 * 从环境变量获取密钥值
 */

import type { SecretRef } from '@core/types'
import type { SecretResolver } from '@core/interfaces'

/**
 * 环境变量密钥解析器
 */
export class EnvSecretResolver implements SecretResolver {
  /**
   * 解析密钥引用
   */
  async resolve(ref: SecretRef): Promise<string> {
    if (ref.type !== 'env') {
      throw new Error(`EnvSecretResolver 不支持 SecretRef 类型: ${ref.type}`)
    }

    if (!ref.envVar) {
      throw new Error('SecretRef.envVar 是必填字段')
    }

    const value = process.env[ref.envVar]
    // 空字符串是有效值，只检查 undefined
    if (value === undefined) {
      throw new Error(`环境变量未设置: ${ref.envVar}`)
    }

    return value
  }
}

/**
 * 创建环境变量密钥解析器
 */
export function createEnvSecretResolver(): SecretResolver {
  return new EnvSecretResolver()
}
