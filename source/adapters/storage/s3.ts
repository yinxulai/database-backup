/**
 * @fileoverview S3 storage driver
 * @module @yinxulai/database-backup/adapters/storage/s3
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
import { createLogger, type Logger } from '../../core/logger.js'

/**
 * S3 storage driver implementation
 */
export class S3StorageDriver implements StorageDriver {
  readonly type = 's3'
  private client: S3Client
  private logger: Logger

  constructor(
    private config: ResolvedS3Config,
    logger?: Logger
  ) {
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: config.forcePathStyle,
    })
    this.logger = logger ?? createLogger()
  }

  /**
   * Upload data to S3
   */
  async upload(data: NodeReadable, key: string): Promise<UploadResult> {
    const fullKey = this.config.pathPrefix
      ? `${this.config.pathPrefix}/${key}`
      : key

    this.logger.debug('S3 upload started', { key: fullKey, bucket: this.config.bucket })

    const startTime = Date.now()

    // Convert stream to buffer
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

    this.logger.info('S3 upload completed', {
      key: fullKey,
      size: body.length,
      duration,
      bucket: this.config.bucket
    })

    return {
      key: fullKey,
      size: body.length,
      etag: '',
      duration,
    }
  }

  /**
   * Delete S3 object
   */
  async delete(key: string): Promise<void> {
    const fullKey = this.config.pathPrefix
      ? `${this.config.pathPrefix}/${key}`
      : key

    this.logger.debug('S3 delete started', { key: fullKey, bucket: this.config.bucket })

    const command = new DeleteObjectCommand({
      Bucket: this.config.bucket,
      Key: fullKey,
    })

    await this.client.send(command)

    this.logger.info('S3 delete completed', { key: fullKey, bucket: this.config.bucket })
  }

  /**
   * List S3 objects
   */
  async list(prefix?: string): Promise<StorageObject[]> {
    const fullPrefix = prefix
      ? this.config.pathPrefix
        ? `${this.config.pathPrefix}/${prefix}`
        : prefix
      : this.config.pathPrefix ?? ''

    this.logger.debug('S3 list started', { prefix: fullPrefix, bucket: this.config.bucket })

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

    this.logger.debug('S3 list completed', {
      prefix: fullPrefix,
      count: objects.length,
      bucket: this.config.bucket
    })

    return objects
  }

  /**
   * Get S3 object metadata
   */
  async head(key: string): Promise<{ size: number; lastModified: Date } | null> {
    const fullKey = this.config.pathPrefix
      ? `${this.config.pathPrefix}/${key}`
      : key

    this.logger.debug('S3 head started', { key: fullKey, bucket: this.config.bucket })

    try {
      const command = new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: fullKey,
      })

      const response = await this.client.send(command)

      this.logger.debug('S3 head completed', { key: fullKey, size: response.ContentLength })

      return {
        size: response.ContentLength ?? 0,
        lastModified: response.LastModified ?? new Date(),
      }
    } catch {
      this.logger.debug('S3 head failed', { key: fullKey })
      return null
    }
  }
}

/**
 * Create S3 storage driver
 */
export function createS3StorageDriver(config: ResolvedS3Config, logger?: Logger): StorageDriver {
  return new S3StorageDriver(config, logger)
}
