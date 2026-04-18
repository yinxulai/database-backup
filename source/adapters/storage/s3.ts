/**
 * S3 存储驱动
 * 
 * 使用 AWS SDK 上传备份文件到 S3
 */

import { Readable } from 'node:stream'
import type { Readable as NodeReadable } from 'node:stream'
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3'
import type { StorageObject } from '../../core/interfaces.js'
import type { ResolvedS3Config, UploadResult } from '../../core/types.js'
import type { StorageDriver } from '../../core/interfaces.js'

/**
 * S3 存储驱动
 */
export class S3StorageDriver implements StorageDriver {
  readonly type = 's3'
  private client: S3Client

  constructor(private config: ResolvedS3Config) {
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: config.forcePathStyle,
    })
  }

  /**
   * 上传数据到 S3
   */
  async upload(data: NodeReadable, key: string): Promise<UploadResult> {
    const fullKey = this.config.pathPrefix
      ? `${this.config.pathPrefix}/${key}`
      : key

    const startTime = Date.now()

    // 将流转换为 Buffer
    const chunks: Buffer[] = []
    for await (const chunk of data) {
      chunks.push(Buffer.from(chunk))
    }
    const body = Buffer.concat(chunks)

    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: fullKey,
      Body: body,
      ContentType: 'application/octet-stream',
    })

    await this.client.send(command)

    const duration = Math.round((Date.now() - startTime) / 1000)

    return {
      key: fullKey,
      size: body.length,
      etag: '',
      duration,
    }
  }

  /**
   * 删除 S3 对象
   */
  async delete(key: string): Promise<void> {
    const fullKey = this.config.pathPrefix
      ? `${this.config.pathPrefix}/${key}`
      : key

    const command = new DeleteObjectCommand({
      Bucket: this.config.bucket,
      Key: fullKey,
    })

    await this.client.send(command)
  }

  /**
   * 列出存储对象
   */
  async list(prefix?: string): Promise<StorageObject[]> {
    const fullPrefix = prefix
      ? this.config.pathPrefix
        ? `${this.config.pathPrefix}/${prefix}`
        : prefix
      : this.config.pathPrefix ?? ''

    const objects: StorageObject[] = []
    let continuationToken: string | undefined

    do {
      const command = new ListObjectsV2Command({
        Bucket: this.config.bucket,
        Prefix: fullPrefix,
        ContinuationToken: continuationToken,
      })

      const response = await this.client.send(command)

      if (response.Contents) {
        for (const item of response.Contents) {
          if (item.Key && item.Size !== undefined) {
            objects.push({
              key: item.Key,
              size: item.Size,
              lastModified: item.LastModified ?? new Date(),
            })
          }
        }
      }

      continuationToken = response.NextContinuationToken
    } while (continuationToken)

    return objects
  }

  /**
   * 获取对象元数据
   */
  async head(key: string): Promise<{ size: number; lastModified: Date } | null> {
    const fullKey = this.config.pathPrefix
      ? `${this.config.pathPrefix}/${key}`
      : key

    try {
      const command = new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: fullKey,
      })

      const response = await this.client.send(command)
      return {
        size: response.ContentLength ?? 0,
        lastModified: response.LastModified ?? new Date(),
      }
    } catch {
      return null
    }
  }
}

/**
 * 创建 S3 存储驱动
 */
export function createS3StorageDriver(config: ResolvedS3Config): StorageDriver {
  return new S3StorageDriver(config)
}
