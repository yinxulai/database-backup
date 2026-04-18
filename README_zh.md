# @yinxulai/database-backup

**[English](README.md)** · [![中文](https://img.shields.io/badge/中文-red)]()

多模式数据库备份工具，采用 CI-first 架构。支持 PostgreSQL 数据库备份到 S3 兼容存储。

## 特性

- **多任务备份**：在单个 YAML 配置中定义多个备份任务
- **PostgreSQL 支持**：使用 `pg_dump` 进行可靠的数据库导出
- **S3 兼容存储**：支持上传到任何 S3 兼容存储（AWS S3、MinIO 等）
- **多种部署方式**：Docker、Kubernetes (Helm) 或直接使用二进制文件
- **YAML 配置**：简洁、声明式的备份定义

## 安装

```bash
# 使用 npm
npm install @yinxulai/database-backup

# 使用 pnpm
pnpm add @yinxulai/database-backup

# 使用 yarn
yarn add @yinxulai/database-backup
```

## 快速开始

### 1. 创建配置文件

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
      password: ${DB_PASSWORD}  # 环境变量引用
    database: myapp
    tables: ["*"]  # 空或省略 = 所有表
  destination:
    type: s3
    s3:
      endpoint: https://s3.amazonaws.com
      region: us-east-1
      bucket: my-backups
      accessKeyId: ${AWS_ACCESS_KEY_ID}
      secretAccessKey: ${AWS_SECRET_ACCESS_KEY}
```

### 2. 执行备份

```bash
# 使用 CLI
backup run --config backup.yaml

# 设置环境变量
export DB_PASSWORD=your-password
export AWS_ACCESS_KEY_ID=your-key
export AWS_SECRET_ACCESS_KEY=your-secret
backup run --config backup.yaml
```

## 配置说明

### BackupGroup 结构

```yaml
apiVersion: database-backup.yinxulai/v1
kind: BackupGroup
metadata:
  name: 备份组名称
spec:
  # 源数据库配置
  source:
    type: postgresql           # 目前仅支持 postgresql
    connection:
      host: string
      port: number             # 默认: 5432
      username: string
      password: string | ${环境变量}
    database: string

  # 默认目标存储（可在任务级别覆盖）
  destination:
    type: s3
    s3:
      endpoint: string
      region: string
      bucket: string
      accessKeyId: string | ${环境变量}
      secretAccessKey: string | ${环境变量}
      pathPrefix?: string      # 可选路径前缀

  # 备份任务列表
      destination:             # 可选：覆盖默认目标
        type: s3
        s3:
          # ... 目标存储配置
```

### 环境变量引用

使用 `${环境变量名}` 语法引用环境变量：

```yaml
password: ${DB_PASSWORD}
accessKeyId: ${AWS_ACCESS_KEY_ID}
```

## CLI 用法

```bash
# 运行备份
backup run --config <配置文件路径>

# 显示帮助
backup --help
backup run --help
```

## 代码调用

```typescript
import { createBackupExecutor, createYamlConfigScanner } from '@yinxulai/database-backup'

const scanner = createYamlConfigScanner()
const executor = createBackupExecutor()

// 加载并执行
const configs = await scanner.scanFromFile('./backup.yaml')
for (const config of configs) {
  const result = await executor.execute(config)
  console.log(`备份完成: ${result.key}`)
}
```

## 部署

### Docker

```bash
# 拉取镜像
docker pull ghcr.io/yinxulai/database-backup:latest

# 运行
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
# 添加 Helm 仓库
helm repo add database-backup https://yinxulai.github.io/database-backup

# 安装
helm install database-backup database-backup/database-backup \
  --set config.content="$(cat backup.yaml)"

# 或使用 values 文件
helm install database-backup database-backup/database-backup -f values.yaml
```

`values.yaml` 示例：

```yaml
image:
  repository: ghcr.io/yinxulai/database-backup
  tag: "latest"

schedule: "0 2 * * *"  # 每天凌晨 2 点

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
    tables: ["*"]  # 空或省略 = 所有表
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

### 二进制文件

从 [GitHub Releases](https://github.com/yinxulai/database-backup/releases) 下载：

```bash
# Linux
wget https://github.com/yinxulai/database-backup/releases/latest/download/backup-linux-x64
chmod +x backup-linux-x64
./backup-linux-x64 run --config backup.yaml
```

## 开发

```bash
# 安装依赖
pnpm install

# 类型检查
pnpm typecheck

# 运行测试
pnpm test

# 构建
pnpm build
```

## License

MIT
