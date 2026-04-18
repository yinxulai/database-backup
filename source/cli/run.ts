/**
 * CLI 入口
 * 
 * 命令行接口实现
 */

import { parseArgs } from 'node:util'
import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { createConfigScanner } from '../core/scanner.js'
import { createEnvSecretResolver } from '../adapters/secret/env.js'
import { createPostgreSQLDriver } from '../adapters/database/postgresql.js'
import { createS3StorageDriver } from '../adapters/storage/s3.js'
import { createBackupExecutor } from '../core/executor.js'
import { createRetentionExecutor } from '../retention/executor.js'
import type { SecretResolver, DatabaseDriver, StorageDriver } from '../core/interfaces.js'
import type { ResolvedConfig, BackupGroup, SecretRef } from '../core/types.js'

/**
 * CLI 命令类型
 */
type Command = 'run' | 'validate' | 'retention' | 'version' | 'help'

/**
 * CLI 选项
 */
interface CliOptions {
  command: Command
  config?: string
  output: 'text' | 'json'
}

/**
 * CLI 主函数
 */
export async function runCli(args: string[]): Promise<void> {
  const options = parseCliArgs(args)

  switch (options.command) {
    case 'run':
      await runCommand(options)
      break
    case 'validate':
      await validateCommand(options)
      break
    case 'retention':
      await retentionCommand(options, args)
      break
    case 'version':
      versionCommand()
      break
    case 'help':
    default:
      helpCommand()
      break
  }
}

/**
 * 解析命令行参数
 */
function parseCliArgs(args: string[]): CliOptions {
  const { values, positionals } = parseArgs({
    args,
    options: {
      config: { type: 'string', short: 'c' },
      output: { type: 'string', short: 'o', default: 'text' },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
    },
    allowPositionals: true,
  })

  // 第一个位置参数是命令
  const command = (positionals[0] as Command) || 'help'

  // --version 标志
  if (values.version) {
    return { command: 'version', output: 'text' as const }
  }

  return {
    command,
    config: values.config ?? undefined,
    output: values.output as 'text' | 'json',
  }
}

/**
 * run 命令
 */
async function runCommand(options: CliOptions): Promise<void> {
  if (!options.config) {
    console.error('Error: --config is required')
    console.error('Usage: backup run --config <file>')
    process.exit(1)
  }

  const configPath = resolve(options.config)
  console.log(`[backup] Loading config from: ${configPath}`)

  try {
    // 1. 扫描配置
    const scanner = createConfigScanner()
    const groups = await scanner.scan(configPath)

    if (groups.length === 0) {
      console.error('Error: No BackupGroup found in config')
      process.exit(1)
    }

    // 2. 解析配置（加载 Secret）
    const secretResolver = createEnvSecretResolver()
    const resolvedConfigs = await Promise.all(
      groups.map((group) => resolveConfig(group, secretResolver))
    )

    // 3. 执行备份
    for (const config of resolvedConfigs) {
      const executor = createBackupExecutor({
        secretResolver,
        databaseDriverFactory: { create: createDatabaseDriver },
        storageDriverFactory: { create: createStorageDriver },
      })

      const result = await executor.execute(config)

      // 输出结果
      if (options.output === 'json') {
        console.log(JSON.stringify(result, null, 2))
      }
    }

  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}

/**
 * validate 命令
 */
async function validateCommand(options: CliOptions): Promise<void> {
  if (!options.config) {
    console.error('Error: --config is required')
    console.error('Usage: backup validate --config <file>')
    process.exit(1)
  }

  const configPath = resolve(options.config)

  try {
    const scanner = createConfigScanner()
    const content = await readFile(configPath, 'utf-8')
    const result = scanner.validate(content)

    if (result.valid) {
      console.log('✓ Config is valid')
    } else {
      console.error('✗ Config is invalid:')
      for (const error of result.errors) {
        console.error(`  ${error.path}: ${error.message}`)
      }
      process.exit(1)
    }
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}

/**
 * retention 命令
 */
async function retentionCommand(options: CliOptions, args: string[]): Promise<void> {
  if (!options.config) {
    console.error('Error: --config is required')
    console.error('Usage: backup retention --config <file> [--dry-run]')
    process.exit(1)
  }

  const configPath = resolve(options.config)
  console.log(`[retention] Loading config from: ${configPath}`)

  try {
    // 解析 --dry-run 参数
    const dryRun = args.includes('--dry-run') || args.includes('-d')
    if (dryRun) {
      console.log('[retention] Dry-run mode enabled (no files will be deleted)')
    }

    // 1. 扫描配置
    const scanner = createConfigScanner()
    const groups = await scanner.scan(configPath)

    if (groups.length === 0) {
      console.error('Error: No BackupGroup found in config')
      process.exit(1)
    }

    // 2. 解析配置（加载 Secret）
    const secretResolver = createEnvSecretResolver()
    const resolvedConfigs = await Promise.all(
      groups.map((group) => resolveConfig(group, secretResolver))
    )

    // 3. 执行保留策略
    for (const config of resolvedConfigs) {
      const retentionExecutor = createRetentionExecutor(createStorageDriver(config))
      const result = await retentionExecutor.applyRetention(config, { dryRun })

      if (options.output === 'json') {
        console.log(JSON.stringify(result, null, 2))
      }
    }

  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}

/**
 * version 命令
 */
function versionCommand(): void {
  console.log('backup v0.1.0')
  console.log('Multi-mode database backup tool')
}

/**
 * help 命令
 */
function helpCommand(): void {
  console.log(`
backup - Multi-mode database backup tool

Usage:
  backup <command> [options]

Commands:
  run          Execute backup
  retention    Apply retention policy
  validate     Validate config file
  version      Show version
  help         Show this help

Options:
  -c, --config <file>   Config file path (required for run/retention/validate)
  -o, --output <format> Output format: text (default) or json

Examples:
  backup run --config backup.yaml
  backup retention --config backup.yaml
  backup retention --config backup.yaml --dry-run
  backup validate --config backup.yaml
  backup run --config backup.yaml --output json

For more information, see:
  https://github.com/taicode-labs/database-backup
`)
}

/**
 * 解析配置（加载 SecretRef）
 */
async function resolveConfig(
  group: BackupGroup,
  secretResolver: SecretResolver
): Promise<ResolvedConfig> {
  const { source, destination } = group.spec

  // 解析数据库密码
  const password = await secretResolver.resolve(source.connection.passwordSecretRef)

  // 解析 S3 密钥
  let resolvedS3Config
  if (destination.type === 's3' && destination.s3) {
    const accessKeyId = await secretResolver.resolve(destination.s3.accessKeySecretRef)
    const secretAccessKey = await secretResolver.resolve(destination.s3.secretKeySecretRef)

    resolvedS3Config = {
      endpoint: destination.s3.endpoint,
      region: destination.s3.region,
      bucket: destination.s3.bucket,
      accessKeyId,
      secretAccessKey,
      pathPrefix: destination.s3.pathPrefix ?? undefined,
      forcePathStyle: destination.s3.forcePathStyle ?? false,
    }
  }

  return {
    group,
    connection: {
      host: source.connection.host,
      port: source.connection.port,
      username: source.connection.username,
      password,
      database: source.connection.database,
      ssl: source.connection.ssl ?? false,
    },
    s3: resolvedS3Config,
  }
}

/**
 * 创建数据库驱动
 */
function createDatabaseDriver(config: ResolvedConfig): DatabaseDriver {
  if (config.group.spec.source.type === 'postgresql') {
    return createPostgreSQLDriver(config.connection)
  }
  throw new Error(`Unsupported database type: ${config.group.spec.source.type}`)
}

/**
 * 创建存储驱动
 */
function createStorageDriver(config: ResolvedConfig): StorageDriver {
  if (config.group.spec.destination.type === 's3' && config.s3) {
    return createS3StorageDriver(config.s3)
  }
  throw new Error(`Unsupported storage type: ${config.group.spec.destination.type}`)
}

// CLI 入口点
const isMain = import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  runCli(process.argv.slice(2)).catch((err) => {
    console.error(`Fatal error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  })
}
