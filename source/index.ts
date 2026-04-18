/**
 * Database Backup 核心模块
 */

// Config types
export * from './config/types.js'

// Database adapters
export * from './database/types.js'
export * from './database/adapters/interface.js'
export { PostgreSQLAdapter, createPostgreSQLAdapter } from './database/adapters/postgresql.js'

// Storage adapters
export { S3Adapter, createS3Adapter, type S3Config, type StorageAdapter } from './upload/adapters/s3.js'

// Backup executor
export { BackupExecutor, createBackupExecutor } from './backup/executor.js'
