/**
 * S3 存储适配器
 */

import { Readable } from 'node:stream'

export interface S3Config {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  pathPrefix?: string
}

export interface StorageAdapter {
  readonly type: string
  readonly config: S3Config

  upload(data: Readable, key: string): Promise<void>
  download(key: string): Promise<Readable>
  delete(key: string): Promise<void>
  list(prefix?: string): Promise<StorageObject[]>
}

export interface StorageObject {
  key: string
  size: number
  lastModified: Date
  etag: string
}

export interface UploadOptions {
  /** 内容类型 */
  contentType?: string
  /** 压缩后的大小 */
  contentLength?: number
  /** 自定义元数据 */
  metadata?: Record<string, string>
}

export class S3Adapter implements StorageAdapter {
  readonly type = 's3'
  readonly config: S3Config

  constructor(config: S3Config) {
    this.config = config
  }

  async upload(data: Readable, key: string, _options?: UploadOptions): Promise<void> {
    const fullKey = this.config.pathPrefix 
      ? `${this.config.pathPrefix}/${key}` 
      : key

    // 简化实现，实际需要使用 @aws-sdk/client-s3
    console.log(`[S3Adapter] Uploading to ${this.config.bucket}/${fullKey}`)

    return new Promise((resolve, reject) => {
      data.on('data', (chunk) => {
        console.log(`[S3Adapter] Received chunk: ${chunk.length} bytes`)
      })
      data.on('end', () => {
        console.log(`[S3Adapter] Upload complete: ${fullKey}`)
        resolve()
      })
      data.on('error', reject)
    })
  }

  async download(key: string): Promise<Readable> {
    const fullKey = this.config.pathPrefix 
      ? `${this.config.pathPrefix}/${key}` 
      : key

    // 简化实现，实际需要使用 @aws-sdk/client-s3
    console.log(`[S3Adapter] Downloading from ${this.config.bucket}/${fullKey}`)

    return new Readable({
      objectMode: false,
      read() {
        // 简化实现
      }
    })
  }

  async delete(key: string): Promise<void> {
    const fullKey = this.config.pathPrefix 
      ? `${this.config.pathPrefix}/${key}` 
      : key

    console.log(`[S3Adapter] Deleting ${this.config.bucket}/${fullKey}`)
  }

  async list(prefix?: string): Promise<StorageObject[]> {
    const searchPrefix = prefix 
      ? `${this.config.pathPrefix}/${prefix}` 
      : this.config.pathPrefix

    console.log(`[S3Adapter] Listing ${this.config.bucket}/${searchPrefix}`)

    return []
  }
}

export function createS3Adapter(config: S3Config): StorageAdapter {
  return new S3Adapter(config)
}
