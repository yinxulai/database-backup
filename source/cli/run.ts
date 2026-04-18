
import { parseArgs } from 'node:util'
import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { createConfigScanner } from '@core/scanner'
import { createEnvSecretResolver } from '@adapters/secret/env'
import { createPostgreSQLDriver } from '@adapters/database/postgresql'
import { createS3StorageDriver } from '@adapters/storage/s3'
import { createBackupExecutor } from '@core/executor'
import { createLogger } from '@core/logger'
import type { SecretResolver, DatabaseDriver, StorageDriver } from '@core/interfaces'
import type { ResolvedConfig, BackupGroup } from '@core/types'

const logger = createLogger()

type Command = 'run' | 'validate' | 'version' | 'help'

interface CliOptions {
  command: Command
  config?: string
  output: 'text' | 'json'
  dryRun?: boolean
}

export async function runCli(args: string[]): Promise<void> {
  const options = parseCliArgs(args)

  switch (options.command) {
    case 'run':
      await runCommand(options)
      break
    case 'validate':
      await validateCommand(options)
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

function parseCliArgs(args: string[]): CliOptions {
  const { values, positionals } = parseArgs({
    args,
    options: {
      config: { type: 'string', short: 'c' },
      output: { type: 'string', short: 'o', default: 'text' },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
      'dry-run': { type: 'boolean', default: false },
    },
    allowPositionals: true,
  })

  const command = (positionals[0] as Command) || 'help'

  if (values.version) {
    return { command: 'version', output: 'text' as const }
  }

  return {
    command,
    config: values.config ?? undefined,
    output: values.output as 'text' | 'json',
    dryRun: (values['dry-run'] as boolean) ?? false,
  }
}

async function runCommand(options: CliOptions): Promise<void> {
  if (!options.config) {
    console.error('Error: --config is required')
    console.error('Usage: backup run --config <file>')
    process.exit(1)
  }

  const configPath = resolve(options.config)
  logger.info('Loading config', { path: configPath })

  try {
    const scanner = createConfigScanner()
    const groups = await scanner.scan(configPath)

    if (groups.length === 0) {
      logger.error('No BackupGroup found in config')
      process.exit(1)
    }

    const secretResolver = createEnvSecretResolver()
    const resolvedConfigs = await Promise.all(
      groups.map((group) => resolveConfig(group, secretResolver))
    )

    for (const config of resolvedConfigs) {
      const executor = createBackupExecutor({
        secretResolver,
        databaseDriverFactory: { create: createDatabaseDriver },
        storageDriverFactory: { create: createStorageDriver },
      })

      const result = await executor.executeTo(config, undefined, options.dryRun)

      if (options.output === 'json') {
        console.log(JSON.stringify(result, null, 2))
      }
    }

  } catch (err) {
    logger.error('Backup failed', { error: err instanceof Error ? err.message : String(err) })
    process.exit(1)
  }
}

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
      console.log('Config is valid')
    } else {
      console.error('Config is invalid:')
      for (const error of result.errors) {
        console.error(`  ${error.path}: ${error.message}`)
      }
      process.exit(1)
    }
  } catch (err) {
    logger.error('Validation failed', { error: err instanceof Error ? err.message : String(err) })
    process.exit(1)
  }
}

function versionCommand(): void {
  console.log('backup v0.1.0')
  console.log('Multi-mode database backup tool')
}

function helpCommand(): void {
  console.log(`
backup - Multi-mode database backup tool

Usage:
  backup <command> [options]

Commands:
  run          Execute backup
  validate     Validate config file
  version      Show version
  help         Show this help

Options:
  -c, --config <file>   Config file path (required for run/validate)
  -o, --output <format> Output format: text (default) or json
  --dry-run          Validate dump without uploading

Examples:
  backup run --config backup.yaml
  backup run --config backup.yaml --dry-run
  backup validate --config backup.yaml
  backup run --config backup.yaml --output json

For more information, see:
  https://github.com/taicode-labs/database-backup
`)
}

async function resolveConfig(
  group: BackupGroup,
  secretResolver: SecretResolver
): Promise<ResolvedConfig> {
  const { source, destination } = group.spec

  const password = await secretResolver.resolve(source.connection.passwordSecretRef)

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

function createDatabaseDriver(config: ResolvedConfig): DatabaseDriver {
  if (config.group.spec.source.type === 'postgresql') {
    return createPostgreSQLDriver(config.connection)
  }
  throw new Error(`Unsupported database type: ${config.group.spec.source.type}`)
}

function createStorageDriver(config: ResolvedConfig): StorageDriver {
  if (config.group.spec.destination.type === 's3' && config.s3) {
    return createS3StorageDriver(config.s3)
  }
  throw new Error(`Unsupported storage type: ${config.group.spec.destination.type}`)
}

const isMain = import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  runCli(process.argv.slice(2)).catch((err) => {
    logger.error('Fatal error', { error: err instanceof Error ? err.message : String(err) })
    process.exit(1)
  })
}
