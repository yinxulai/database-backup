# @yinxulai/database-backup

[![English](https://img.shields.io/badge-English-blue)]() · **[中文](README_zh.md)**

A multi-mode database backup tool with CI-first architecture. Supports PostgreSQL databases with S3-compatible storage.

## Features

- **Multiple backup groups**: Define multiple backup groups in a single YAML configuration
- **PostgreSQL support**: Uses `pg_dump` for reliable database dumps
- **S3-compatible storage**: Upload backups to any S3-compatible storage (AWS S3, MinIO, etc.)
- **Multiple deployment options**: Docker, Kubernetes (Helm), or direct binary
- **YAML configuration**: Simple, declarative backup definitions

## Installation

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

#### Option 1: Use the local Chart directory

```bash
git clone https://github.com/yinxulai/database-backup.git
cd database-backup

# Edit values.yaml or pass values with --set
helm install database-backup ./helm/database-backup -f values.yaml
```

#### Option 2: Download the packaged Chart from a GitHub Release

```bash
# Download a packaged Chart from the Release page
wget https://github.com/yinxulai/database-backup/releases/download/v<VERSION>/database-backup-<VERSION>.tgz

# Install the packaged Chart
helm install database-backup ./database-backup-<VERSION>.tgz -f values.yaml
```

#### Option 3: Package the Chart locally

```bash
# Package the Chart from this repository
helm package ./helm/database-backup

# Install the packaged Chart
helm install database-backup ./database-backup-*.tgz -f values.yaml
```

#### Option 4: Use an OCI registry

```bash
# Package and push the Chart to your own OCI registry
helm package ./helm/database-backup
helm push database-backup-*.tgz oci://your-registry/database-backup

# Install from the OCI registry
helm install database-backup oci://your-registry/database-backup -f values.yaml
```

## Quick Start

### 1. Create a configuration file

> Use a plain top-level YAML structure. The old Kubernetes-style wrapper is no longer supported.

```yaml
# backup.yaml
name: my-database-backup
source:
  type: postgresql
  connection:
    host: localhost
    port: 5432
    username: postgres
    password: ${DB_PASSWORD}  # or write the plain password directly
  database: myapp
  # schema: public          # Optional; omit to back up all schemas
  # tables: [users, orders] # Optional; omit or use [] to back up all tables
destination:
  type: s3
  s3:
    endpoint: https://s3.amazonaws.com
    region: us-east-1
    bucket: my-backups
    accessKeyId: ${AWS_ACCESS_KEY_ID}
    secretAccessKey: ${AWS_SECRET_ACCESS_KEY}
```

### 2. Run backup

```bash
# Run with CLI
backup run --config backup.yaml

# Environment variables (for local development)
export DB_PASSWORD=your-password
export AWS_ACCESS_KEY_ID=your-key
export AWS_SECRET_ACCESS_KEY=your-secret
backup run --config backup.yaml
```

## Configuration

### Configuration Structure

```yaml
name: backup-job-name

# Source database configuration
source:
  type: postgresql             # Only postgresql supported now
  connection:
    host: string
    port: number               # Default: 5432
    username: string
    password: string           # plain text or ${DB_PASSWORD}
  database: string
  schema?: string
  tables: ["*"]                # Empty = all tables

# Destination configuration
destination:
  type: s3
  s3:
    endpoint: string
    region: string
    bucket: string
    accessKeyId: string        # plain text or ${AWS_ACCESS_KEY_ID}
    secretAccessKey: string    # plain text or ${AWS_SECRET_ACCESS_KEY}
    pathPrefix?: string        # Optional: "{{.Database}}/{{.Date}}"

# Retention policy (optional)
retention:
  retentionDays: 7
```

The plain top-level YAML structure is the only supported config format.

### Environment Variable Reference

Use ${ENV_VAR_NAME} syntax directly in the YAML values when needed.

## CLI Usage

```bash
# Run backup
backup run --config <path-to-config>

# Validate config
backup validate --config <path-to-config>

# Show help
backup --help
backup run --help
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

### Kubernetes (Helm) - Complete Example

#### Step 1: Create Kubernetes Secrets

```bash
# Create PostgreSQL password secret
kubectl create secret generic postgres-secret \
  --from-literal=password=your-db-password

# Create AWS credentials secret
kubectl create secret generic aws-secret \
  --from-literal=access-key-id=your-aws-key \
  --from-literal=secret-access-key=your-aws-secret
```

#### Step 2: Create values.yaml

```yaml
# values.yaml
image:
  repository: ghcr.io/yinxulai/database-backup
  tag: "latest"

schedule: "0 2 * * *"  # Daily at 2 AM UTC

config:
  content: |
    name: my-backup
    source:
      type: postgresql
      connection:
        host: postgres.database.svc.cluster.local
        port: 5432
        username: postgres
        password: ${DB_PASSWORD}
      database: myapp
      tables: ["*"]
    destination:
      type: s3
      s3:
        endpoint: https://s3.amazonaws.com
        region: us-east-1
        bucket: my-backups
        accessKeyId: ${AWS_ACCESS_KEY_ID}
        secretAccessKey: ${AWS_SECRET_ACCESS_KEY}
      retention:
        retentionDays: 7
```

#### Step 3: Install with Helm

```bash
# Install
helm install database-backup ./helm/database-backup -f values.yaml

# Check status
kubectl get cronjob

# Manually trigger a backup
kubectl create job --from=cronjob/database-backup manual-backup-$(date +%s)
```

### Binary

Download from [GitHub Releases](https://github.com/yinxulai/database-backup/releases):

```bash
# Linux
wget https://github.com/yinxulai/database-backup/releases/latest/download/backup-linux-x64
chmod +x backup-linux-x64
./backup-linux-x64 backup run --config backup.yaml
```

## Development

```bash
# Install dependencies
pnpm install

# Type check
pnpm typecheck

# Run tests
pnpm test

# Run CLI (local development)
pnpm dev

# Run CLI (production mode)
pnpm backup
```

## License

MIT
