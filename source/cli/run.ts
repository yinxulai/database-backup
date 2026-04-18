
import { parseArgs } from 'node:util'
import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { createConfigScanner } from '@core/scanner'
import { createPostgreSQLDriver } from '@adapters/database/postgresql'
import { createS3StorageDriver } from '@adapters/storage/s3'
import { createBackupExecutor } from '@core/executor'
import { createLogger } from '@core/logger'
import type { DatabaseDriver, StorageDriver } from '@core/interfaces'
import type { ResolvedConfig, BackupConfig, RestoreInput } from '@core/types'

const logger = createLogger()

type Command = 'run' | 'validate' | 'restore' | 'version' | 'help'

interface CliOptions {
  command: Command
  config?: string
  output: 'text' | 'json'
  dryRun?: boolean
  backupKey?: string
  database?: string
  tables?: string[]
  clean?: boolean
  create?: boolean
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
    case 'restore':
      await restoreCommand(options)
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
      'backup-key': { type: 'string' },
      database: { type: 'string', short: 'd' },
      tables: { type: 'string' },
      clean: { type: 'boolean', default: false },
      create: { type: 'boolean', default: false },
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
    backupKey: values['backup-key'] as string | undefined,
    database: values.database as string | undefined,
    tables: values.tables ? (values.tables as string).split(',') : undefined,
    clean: values.clean as boolean | undefined,
    create: values.create as boolean | undefined,
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
      logger.error('No backup config found in file')
      process.exit(1)
    }

    const resolvedConfigs = await Promise.all(
      groups.map((group) => resolveConfig(group))
    )

    for (const config of resolvedConfigs) {
      const executor = createBackupExecutor({
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

async function restoreCommand(options: CliOptions): Promise<void> {
  if (!options.config) {
    console.error('Error: --config is required')
    console.error('Usage: backup restore --config <file> --backup-key <key>')
    process.exit(1)
  }

  if (!options.backupKey) {
    console.error('Error: --backup-key is required')
    console.error('Usage: backup restore --config <file> --backup-key <key>')
    process.exit(1)
  }

  const configPath = resolve(options.config)
  logger.info('Loading config', { path: configPath })

  try {
    const scanner = createConfigScanner()
    const groups = await scanner.scan(configPath)

    if (groups.length === 0) {
      logger.error('No backup config found in file')
      process.exit(1)
    }

    const resolvedConfigs = await Promise.all(
      groups.map((group) => resolveConfig(group))
    )

    for (const config of resolvedConfigs) {
      const executor = createBackupExecutor({
        databaseDriverFactory: { create: createDatabaseDriver },
        storageDriverFactory: { create: createStorageDriver },
      })

      const restoreInput: RestoreInput = {
        backupKey: options.backupKey,
        database: options.database,
        tables: options.tables,
        clean: options.clean,
        create: options.create,
      }

      const result = await executor.restore(config, restoreInput)

      if (options.output === 'json') {
        console.log(JSON.stringify(result, null, 2))
      } else {
        if (result.status === 'completed') {
          console.log(`Restore completed: ${result.fileKey}`)
          console.log(`Duration: ${result.duration}s`)
        } else {
          console.error(`Restore failed: ${result.error}`)
          process.exit(1)
        }
      }
    }

  } catch (err) {
    logger.error('Restore failed', { error: err instanceof Error ? err.message : String(err) })
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
  restore      Restore from backup
  version      Show version
  help         Show this help

Options:
  -c, --config <file>   Config file path (required for run/validate/restore)
  -o, --output <format> Output format: text (default) or json
  --dry-run          Validate dump without uploading
  --backup-key <key>  Backup file key to restore (required for restore)
  -d, --database <db> Target database for restore (optional)
  --tables <list>    Comma-separated table list for partial restore (optional)
  --clean            Drop existing objects before restore (optional)
  --create           Create target database if not exists (optional)

Examples:
  backup run --config backup.yaml
  backup run --config backup.yaml --dry-run
  backup validate --config backup.yaml
  backup restore --config backup.yaml --backup-key postgresql-myapp-2026-04-18-10-30-00.sql.gz
  backup restore --config backup.yaml --backup-key postgresql-myapp-2026-04-18-10-30-00.sql.gz --database myapp_restore
  backup restore --config backup.yaml --backup-key postgresql-myapp-2026-04-18-10-30-00.sql.gz --tables users,orders --clean

For more information, see:
  https://github.com/taicode-labs/database-backup
`)
}

async function resolveConfig(
  config: BackupConfig
): Promise<ResolvedConfig> {
  const { source, destination } = config

  const password = resolveCredential(
    source.connection.password,
    'source.connection.password'
  )

  let resolvedS3Config
  if (destination.type === 's3' && destination.s3) {
    const accessKeyId = resolveCredential(
      destination.s3.accessKeyId,
      'destination.s3.accessKeyId'
    )
    const secretAccessKey = resolveCredential(
      destination.s3.secretAccessKey,
      'destination.s3.secretAccessKey'
    )

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
    config,
    connection: {
      host: expandEnvVars(source.connection.host, 'source.connection.host'),
      port: source.connection.port,
      username: expandEnvVars(source.connection.username, 'source.connection.username'),
      password,
      database: expandEnvVars(source.connection.database ?? source.database, 'source.database'),
      ssl: source.connection.ssl ?? false,
    },
    s3: resolvedS3Config
      ? {
          ...resolvedS3Config,
          endpoint: expandEnvVars(resolvedS3Config.endpoint, 'destination.s3.endpoint'),
          region: expandEnvVars(resolvedS3Config.region, 'destination.s3.region'),
          bucket: expandEnvVars(resolvedS3Config.bucket, 'destination.s3.bucket'),
          pathPrefix: resolvedS3Config.pathPrefix
            ? expandEnvVars(resolvedS3Config.pathPrefix, 'destination.s3.pathPrefix')
            : undefined,
        }
      : undefined,
  }
}

function expandEnvVars(value: string, fieldName: string): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, envVar: string) => {
    const resolved = process.env[envVar]
    if (resolved === undefined) {
      throw new Error(`Environment variable ${envVar} is not set for ${fieldName}`)
    }
    return resolved
  })
}

function resolveCredential(
  value: string | undefined,
  fieldName: string
): string {
  if (value !== undefined) {
    return expandEnvVars(value, fieldName)
  }

  throw new Error(`${fieldName} is required`)
}

function createDatabaseDriver(config: ResolvedConfig): DatabaseDriver {
  if (config.config.source.type === 'postgresql') {
    return createPostgreSQLDriver(config.connection)
  }
  throw new Error(`Unsupported database type: ${config.config.source.type}`)
}

function createStorageDriver(config: ResolvedConfig): StorageDriver {
  if (config.config.destination.type === 's3' && config.s3) {
    return createS3StorageDriver(config.s3)
  }
  throw new Error(`Unsupported storage type: ${config.config.destination.type}`)
}

const isMain = import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  runCli(process.argv.slice(2)).catch((err) => {
    logger.error('Fatal error', { error: err instanceof Error ? err.message : String(err) })
    process.exit(1)
  })
}
