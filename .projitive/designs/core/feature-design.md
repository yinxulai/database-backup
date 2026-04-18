# Database Backup 功能设计

> Version: 0.3.0
> Status: Review
> Last Updated: 2026-04-18

---

## 1. 产品定位

**一句话定位**：多模态数据库备份工具，底层是 CI，之上支持 K8s / Docker / CLI 等多种部署形态

**目标用户**：
- K8s 集群运维人员 → 使用 K8s Operator 模式
- DevOps 工程师 → 使用 Docker 模式
- 个人开发者 → 使用 CLI 模式

**核心场景**：
- 定时备份 PostgreSQL/MySQL 数据库到 S3
- 支持单表级别备份
- 支持分块备份（大表）
- 支持多组备份（多个库 → 多个目标）
- **一套配置，多种部署形态**

---

## 2. 功能范围

### 2.1 首期功能（V1.0）

| 功能 | 描述 | 优先级 |
|------|------|--------|
| **CI Core** | 核心备份引擎，与部署形态解耦 | P0 |
| **多组备份** | 一个 BackupGroup 包含多个 BackupTask | P0 |
| **多源多目标** | 不同库/表可备份到不同 S3 | P0 |
| PostgreSQL 备份 | 支持全库和单表备份 | P0 |
| S3 上传 | 支持压缩上传到 S3 | P0 |
| CLI 模式 | 命令行工具使用 | P1 |
| Docker 模式 | 容器化部署 | P1 |
| 连接测试 | 备份前验证数据库连接 | P1 |
| 备份历史 | 记录备份结果 | P1 |

### 2.2 后续功能（V1.1+）

| 功能 | 描述 | 优先级 |
|------|------|--------|
| K8s Operator | CRD + Controller 自动化 | P2 |
| 定时调度 | 支持 Cron 表达式定时备份 | P2 |
| 保留策略 | 自动清理过期备份 | P2 |
| MySQL 支持 | 支持 MySQL 数据库 | P2 |
| 多数据库实例 | 一个集群多个数据库实例 | P2 |

---

## 3. 三种部署形态

### 3.1 形态概览

```
┌─────────────────────────────────────────────────────────────┐
│                    Backup CI Core                          │
│                  （纯 CI，核心引擎）                        │
└─────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   CLI Mode      │  │  Docker Mode    │  │ K8s Operator    │
│                 │  │                 │  │                │
│  $ db-backup    │  │  $ docker run   │  │ BackupGroup    │
│    run --task x │  │    db-backup    │  │ CRD + Ctrl     │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

### 3.2 CLI 模式

**适用场景**：
- 单次备份
- 开发测试
- 小型项目（配合系统 Cron）

**使用示例**：
```bash
# 初始化
db-backup init

# 运行备份
db-backup run --config ./backup.yaml
db-backup run --config ./backup.yaml --task users-backup

# 查看历史
db-backup history --config ./backup.yaml

# 测试连接
db-backup test --config ./backup.yaml --task users-backup
```

### 3.3 Docker 模式

**适用场景**：
- 独立服务器
- 虚拟机
- 混合云环境

**使用示例**：
```bash
# 构建镜像
docker build -t db-backup:latest .

# 运行备份
docker run \
  -v $(pwd)/configs:/config \
  -e AWS_ACCESS_KEY_ID \
  -e AWS_SECRET_ACCESS_KEY \
  db-backup:latest run --config /config/backup.yaml

# 定时任务（配合宿主机的 cron）
# /etc/cron.d/db-backup
# 0 2 * * * docker run --rm db-backup:latest run --config /config/backup.yaml
```

### 3.4 K8s Operator 模式

**适用场景**：
- K8s 生产集群
- 需要自动化运维
- 多租户环境

**使用示例**：
```yaml
apiVersion: database-backup.yinxulai/v1
kind: BackupGroup
metadata:
  name: myapp-backups
spec:
  source:
    type: postgresql
    connection:
      host: postgres.svc
      port: 5432
      username: backup
      passwordSecretRef:
        name: myapp-secret
        key: DB_PASSWORD
  defaultDestination:
    type: s3
    s3:
      bucket: my-backups
  tasks:
    - name: users-backup
      source:
        database: app
        tables: [users, profiles]
      schedule:
        cron: "0 2 * * *"
```

---

## 4. 核心概念

### 4.1 BackupGroup vs BackupTask

```
BackupGroup（备份组）
├── 共享同一个数据库实例连接
├── 定义 defaultDestination（可被任务覆盖）
└── 包含多个 BackupTask（逻辑概念）

BackupTask（备份任务）
├── 绑定到具体的库和表
├── 可继承或覆盖组级别的目标
└── 产生独立的 BackupResult
```

### 4.2 SecretAdapter

```
SecretAdapter（密钥适配器）
├── EnvVarAdapter → CLI / Docker 环境变量
├── K8sSecretAdapter → K8s Secret
└── VaultAdapter → HashiCorp Vault
```

---

## 5. 执行流程

### 5.1 统一执行流程

```
BackupGroup 配置
     │
     ▼
Scanner.scan() → BackupGroup[]
     │
     ▼
Loader.resolve(SecretAdapter) → ResolvedConfig[]
     │  ├── 选择 SecretAdapter（根据部署形态）
     │  ├── 解析所有 SecretRef
     │  └── 合并继承关系
     │
     ▼
Executor.execute() → BackupResult[]
     │
     ├──▶ Task 1: → BackupResult
     ├──▶ Task 2: → BackupResult
     └──▶ Task N: → BackupResult
```

### 5.2 任务执行流程

```
任务配置
     │
     ▼
创建 DatabaseAdapter（按 type）
     │
     ▼
连接测试
     │
     ▼
执行 pg_dump / mysqldump
     │
     ▼
Stream → 压缩 → Checksum
     │
     ▼
创建 StorageAdapter（按 destination.type）
     │
     ▼
上传到 S3
     │
     ▼
记录 BackupResult
     │
     ▼
完成
```

---

## 6. 输出示例

### 6.1 CLI 执行输出

```
$ db-backup run --config ./backup.yaml --task users-backup
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Backup: users-backup
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Database: PostgreSQL 15.2 (postgres:5432/app)
  Tables: [users, profiles]
  Target: S3 (my-backups)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[10:06:00] Connecting to PostgreSQL...
[10:06:01] ✓ Connected
[10:06:02] Dumping users (125,000 rows)...
[10:06:08] ✓ Dumped (8.2 MB)
[10:06:09] Dumping profiles (125,000 rows)...
[10:06:14] ✓ Dumped (4.1 MB)
[10:06:15] Compressing (gzip)...
[10:06:17] ✓ Compressed (2.1 MB)
[10:06:18] Uploading to S3...
[10:06:22] ✓ Uploaded (app/users-20260418.sql.gz)
[10:06:23] ✓ SHA256: a1b2c3d4...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✓ Backup completed in 23s
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 6.2 Docker 执行输出

同上，但会在日志中标注容器信息：
```
[10:06:00] [docker:backup-pod] Starting backup...
```

### 6.3 K8s Operator 输出

K8s 模式下，结果会记录在 BackupResult CR 中：
```yaml
apiVersion: database-backup.yinxulai/v1
kind: BackupResult
metadata:
  name: users-backup-20260418-100600
spec:
  taskName: users-backup
  status: completed
  startTime: "2026-04-18T02:06:00Z"
  endTime: "2026-04-18T02:06:23Z"
  duration: 23
  size: 2202015
  checksum: sha256:a1b2c3d4...
  fileKey: app/users-20260418.sql.gz
```

---

## 7. 配置示例

### 7.1 最小配置

```yaml
# backup-minimal.yaml
apiVersion: database-backup.yinxulai/v1
kind: BackupGroup
metadata:
  name: minimal-backup
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
  defaultDestination:
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
  tasks:
    - name: full-backup
      source:
        tables: []
```

### 7.2 多任务配置

```yaml
# backup-group.yaml
apiVersion: database-backup.yinxulai/v1
kind: BackupGroup
metadata:
  name: myapp-backup-group
spec:
  source:
    type: postgresql
    connection:
      host: postgres.svc
      port: 5432
      username: backup
      passwordSecretRef:
        type: k8s
        name: myapp-secret
        key: DB_PASSWORD
      database: app
  defaultDestination:
    type: s3
    s3:
      endpoint: https://s3.amazonaws.com
      region: us-east-1
      bucket: my-backups
  tasks:
    - name: users-backup
      source:
        tables: [users, profiles]
      schedule:
        cron: "0 2 * * *"
    - name: orders-backup
      source:
        tables: [orders, order_items]
      destination:
        type: s3
        s3:
          bucket: archive-backups
      schedule:
        cron: "0 */4 * * *"
```

---

## 8. 设计决策记录

| 日期 | 决策 | 理由 |
|------|------|------|
| 2026-04-18 | CI-First 架构 | 核心与部署形态解耦，多形态复用 |
| 2026-04-18 | 三层架构 | Interface / CI Core / Adapter 分离 |
| 2026-04-18 | SecretAdapter 抽象 | 支持多种密钥来源 |
| 2026-04-18 | 统一配置模型 | CLI / Docker / K8s 共用同一配置 |
