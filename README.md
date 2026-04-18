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

#### 方式一：使用本地 Chart 目录

```bash
git clone https://github.com/yinxulai/database-backup.git
cd database-backup

# 编辑 values.yaml 或使用 --set
helm install database-backup ./helm/database-backup -f values.yaml
```

#### 方式二：使用打包的 Chart

```bash
# 下载最新 Chart
wget https://github.com/yinxulai/database-backup/releases/latest/download/database-backup-*.tgz

# 安装
helm install database-backup ./database-backup-*.tgz -f values.yaml
```

#### 方式三：使用 OCI 镜像（需自行打包 Chart）

```bash
# 构建并推送 Chart 到 OCI registry
helm package ./helm/database-backup
helm push database-backup-*.tgz oci://your-registry/database-backup

# 安装
helm install database-backup oci://your-registry/database-backup -f values.yaml
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
      passwordSecretRef:
        type: env
        envVar: DB_PASSWORD
    database: myapp
    tables: ["*"]  # Empty or omitted = all tables
  destination:
    type: s3
    s3:
      endpoint: https://s3.amazonaws.com
      region: us-east-1
      bucket: my-backups
      accessKeySecretRef:
        type: env
        envVar: AWS_ACCESS_KEY_ID
      secretKeySecretRef:
        type: env
        envVar: AWS_SECRET_ACCESS_KEY
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
      passwordSecretRef:
        type: env              # env | k8s
        envVar: string         # for type=env
        # secretName: string   # for type=k8s
        # secretKey: string   # for type=k8s
    database: string
    tables: ["*"]              # Empty = all tables

  # Destination configuration
  destination:
    type: s3
    s3:
      endpoint: string
      region: string
      bucket: string
      accessKeySecretRef:
        type: env | k8s
        envVar?: string
        secretName?: string
        secretKey?: string
      secretKeySecretRef:
        type: env | k8s
        envVar?: string
        secretName?: string
        secretKey?: string
      pathPrefix?: string      # Optional: "{{.Database}}/{{.Date}}"

  # Retention policy (optional)
  retention:
    retentionDays: 7           # Keep backups for N days
```

### Secret Reference Types

For sensitive credentials, use `SecretRef`:

| Type | Usage | Example |
|------|-------|---------|
| `env` | Environment variable | `envVar: "DB_PASSWORD"` |
| `k8s` | Kubernetes Secret | `secretName: "my-secret", secretKey: "password"` |

### Environment Variable Reference (for local development)

Use `${ENV_VAR_NAME}` syntax in backup.yaml for local runs.

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
        tables: ["*"]
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
