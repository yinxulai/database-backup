# @yinxulai/database-backup

A multi-mode database backup tool with CI-first architecture. Supports PostgreSQL databases with S3-compatible storage.

## Features

- **Multi-task backup**: Define multiple backup tasks in a single YAML configuration
- **PostgreSQL support**: Uses `pg_dump` for reliable database dumps
- **S3-compatible storage**: Upload backups to any S3-compatible storage (AWS S3, MinIO, etc.)
- **Multiple deployment options**: Docker, Kubernetes (Helm), or direct binary
- **YAML configuration**: Simple, declarative backup definitions

## Installation

```bash
# Using npm
npm install @yinxulai/database-backup

# Using pnpm
pnpm add @yinxulai/database-backup

# Using yarn
yarn add @yinxulai/database-backup
```

## Quick Start

### 1. Create a configuration file

```yaml
# backup.yaml
apiVersion: database-backup.yinxulai/v1
kind: BackupGroup
metadata:
  name: my-database-backup
spec:
  source:
    type: postgresql
    connection:
      host: localhost
      port: 5432
      username: postgres
      password: ${DB_PASSWORD}  # Environment variable reference
    database: myapp
  destination:
    type: s3
    s3:
      endpoint: https://s3.amazonaws.com
      region: us-east-1
      bucket: my-backups
      accessKeyId: ${AWS_ACCESS_KEY_ID}
      secretAccessKey: ${AWS_SECRET_ACCESS_KEY}
  tasks:
    - name: full-backup
      tables: ["*"]  # All tables
```

### 2. Run backup

```bash
# Using CLI
backup run --config backup.yaml

# Environment variables
export DB_PASSWORD=your-password
export AWS_ACCESS_KEY_ID=your-key
export AWS_SECRET_ACCESS_KEY=your-secret
backup run --config backup.yaml
```

## Configuration

### BackupGroup Structure

```yaml
apiVersion: database-backup.yinxulai/v1
kind: BackupGroup
metadata:
  name: backup-group-name
spec:
  # Source database configuration
  source:
    type: postgresql           # Only postgresql supported now
    connection:
      host: string
      port: number             # Default: 5432
      username: string
      password: string | ${ENV_VAR}
    database: string

  # Default destination (can be overridden per task)
  destination:
    type: s3
    s3:
      endpoint: string
      region: string
      bucket: string
      accessKeyId: string | ${ENV_VAR}
      secretAccessKey: string | ${ENV_VAR}
      pathPrefix?: string      # Optional path prefix

  # Backup tasks
  tasks:
    - name: task-name
      tables: ["table1", "table2"]  # Tables to backup
      destination:             # Optional: override default destination
        type: s3
        s3:
          # ... destination config
```

### Environment Variable Reference

Use `${ENV_VAR_NAME}` syntax to reference environment variables:

```yaml
password: ${DB_PASSWORD}
accessKeyId: ${AWS_ACCESS_KEY_ID}
```

## CLI Usage

```bash
# Run backup
backup run --config <path-to-config>

# Show help
backup --help
backup run --help
```

## Programmatic Usage

```typescript
import { createBackupExecutor, createYamlConfigScanner } from '@yinxulai/database-backup'

const scanner = createYamlConfigScanner()
const executor = createBackupExecutor()

// Load and execute
const configs = await scanner.scanFromFile('./backup.yaml')
for (const config of configs) {
  const result = await executor.execute(config)
  console.log(`Backup completed: ${result.key}`)
}
```

## Deployment

### Docker

```bash
# Pull image
docker pull ghcr.io/yinxulai/database-backup:latest

# Run with environment variables
docker run --rm \
  -e DB_PASSWORD=your-password \
  -e AWS_ACCESS_KEY_ID=your-key \
  -e AWS_SECRET_ACCESS_KEY=your-secret \
  -v /path/to/backup.yaml:/config/backup.yaml \
  ghcr.io/yinxulai/database-backup:latest \
  run --config /config/backup.yaml
```

### Kubernetes (Helm)

```bash
# Add Helm repo
helm repo add database-backup https://yinxulai.github.io/database-backup

# Install
helm install database-backup database-backup/database-backup \
  --set config.content="$(cat backup.yaml)"

# Or use values file
helm install database-backup database-backup/database-backup -f values.yaml
```

Example `values.yaml`:

```yaml
image:
  repository: ghcr.io/yinxulai/database-backup
  tag: "latest"

schedule: "0 2 * * *"  # Daily at 2 AM

config:
  content: |
    apiVersion: database-backup.yinxulai/v1
    kind: BackupGroup
    metadata:
      name: my-backup
    spec:
      source:
        type: postgresql
        connection:
          host: postgres.database.svc.cluster.local
          port: 5432
          username: postgres
          passwordSecretRef:
            type: k8s
            secretName: postgres-secret
            secretKey: password
        database: myapp
      destination:
        type: s3
        s3:
          endpoint: https://s3.amazonaws.com
          region: us-east-1
          bucket: my-backups
          accessKeySecretRef:
            type: k8s
            secretName: aws-secret
            secretKey: access-key-id
          secretKeySecretRef:
            type: k8s
            secretName: aws-secret
            secretKey: secret-access-key
      tasks:
        - name: full-backup
          tables: ["*"]

env:
  - name: AWS_ACCESS_KEY_ID
    valueFrom:
      secretKeyRef:
        name: aws-secret
        key: access-key-id
  - name: AWS_SECRET_ACCESS_KEY
    valueFrom:
      secretKeyRef:
        name: aws-secret
        key: secret-access-key
```

### Binary

Download from [GitHub Releases](https://github.com/yinxulai/database-backup/releases):

```bash
# Linux
wget https://github.com/yinxulai/database-backup/releases/latest/download/backup-linux-x64
chmod +x backup-linux-x64
./backup-linux-x64 run --config backup.yaml
```

## Development

```bash
# Install dependencies
pnpm install

# Type check
pnpm typecheck

# Run tests
pnpm test

# Build
pnpm build
```

## License

MIT
