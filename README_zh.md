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

> 仅支持普通的顶层 YAML 结构。旧的类 Kubernetes 包裹写法已不再支持。

```yaml
# backup.yaml
name: my-database-backup
source:
  type: postgresql
  connection:
    host: localhost
    port: 5432
    username: postgres
    password: ${DB_PASSWORD}   # 也可以直接写明文密码
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

### 配置结构

```yaml
name: 备份任务名称

# 源数据库配置
source:
  type: postgresql             # 目前仅支持 postgresql
  connection:
    host: string
    port: number               # 默认: 5432
    username: string
    password: string           # 明文，或 ${DB_PASSWORD}
  database: string
  tables?: ["public.users"]      # 可选；支持 Schema.TableName；省略或空数组 = 备份所有 table

# 目标存储配置
destination:
  type: s3
  s3:
    endpoint: string
    region: string
    bucket: string
    accessKeyId: string        # 明文，或 ${AWS_ACCESS_KEY_ID}
    secretAccessKey: string    # 明文，或 ${AWS_SECRET_ACCESS_KEY}
    pathPrefix?: string        # 可选路径前缀

# 保留策略（可选）
retention:
  retentionDays: 7
```

现在仅支持普通的顶层 YAML 配置结构。

### 凭证配置方式

直接写普通字符串即可，也支持环境变量占位符：

```yaml
password: your-db-password
# 或
password: ${DB_PASSWORD}

accessKeyId: ${AWS_ACCESS_KEY_ID}
secretAccessKey: ${AWS_SECRET_ACCESS_KEY}
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

#### 方式一：直接使用仓库内的 Chart

```bash
helm install database-backup ./helm/database-backup \
  --set config.content="$(cat backup.yaml)"

# 或使用 values 文件
helm install database-backup ./helm/database-backup -f values.yaml
```

#### 方式二：从 GitHub Release 下载打包好的 Chart

```bash
wget https://github.com/yinxulai/database-backup/releases/download/v<版本号>/database-backup-<版本号>.tgz
helm install database-backup ./database-backup-<版本号>.tgz -f values.yaml
```

#### 方式三：在本地自行打包后安装

```bash
helm package ./helm/database-backup
helm install database-backup ./database-backup-*.tgz -f values.yaml
```

`values.yaml` 示例：

```yaml
image:
  repository: ghcr.io/yinxulai/database-backup
  tag: "latest"

schedule: "0 2 * * *"  # 每天凌晨 2 点

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
      tables: ["*"]  # 空或省略 = 所有表
    destination:
      type: s3
      s3:
        endpoint: https://s3.amazonaws.com
        region: us-east-1
        bucket: my-backups
        accessKeyId: ${AWS_ACCESS_KEY_ID}
        secretAccessKey: ${AWS_SECRET_ACCESS_KEY}

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
