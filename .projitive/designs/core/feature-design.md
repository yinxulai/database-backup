# Database Backup 功能设计

> Version: 0.2.0
> Status: Review
> Last Updated: 2026-04-18

---

## 1. 产品定位

**一句话定位**：K8s 原生的数据库备份工具，通过简单的 YAML 配置实现定时备份

**目标用户**：
- K8s 集群运维人员
- DevOps 工程师
- 需要数据库备份的开发团队

**核心场景**：
- 定时备份 PostgreSQL/MySQL 数据库到 S3
- 支持单表级别备份
- 支持分块备份（大表）
- **支持多组备份（多个库 → 多个目标）**
- 备份历史管理和自动清理

---

## 2. 功能范围

### 2.1 首期功能（V1.0）

| 功能 | 描述 | 优先级 |
|------|------|--------|
| **多组备份（BackupGroup）** | 一个配置包含多个备份任务 | P0 |
| **多源多目标** | 不同库/表可备份到不同 S3 | P0 |
| 任务配置 | 通过 YAML/JSON 定义备份任务 | P0 |
| PostgreSQL 备份 | 支持全库和单表备份 | P0 |
| S3 上传 | 支持压缩上传到 S3 | P0 |
| 连接测试 | 备份前验证数据库连接 | P1 |
| 备份历史 | 记录备份结果（成功/失败/大小） | P1 |

### 2.2 后续功能（V1.1+）

| 功能 | 描述 | 优先级 |
|------|------|--------|
| 定时调度 | 支持 Cron 表达式定时备份 | P2 |
| 保留策略 | 自动清理过期备份 | P2 |
| MySQL 支持 | 支持 MySQL 数据库 | P2 |
| 多数据库实例 | 一个集群多个数据库实例 | P2 |

---

## 3. 核心概念

### 3.1 BackupGroup vs BackupTask

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

### 3.2 多组备份场景

**场景 1：一个集群有多个数据库实例**
```yaml
BackupGroup: postgres-primary
  └── tasks: [app-backup, users-backup]

BackupGroup: postgres-analytics
  └── tasks: [metrics-backup]
```

**场景 2：同一个实例，不同库不同目标**
```yaml
BackupGroup: single-postgres
  source:
    connection: postgres.svc:5432
  tasks:
    - name: app-to-s3-primary
      source:
        database: app
        tables: [users, orders]
      destination:
        s3: primary-bucket

    - name: orders-to-archive
      source:
        database: app
        tables: [order_history]
      destination:
        s3: archive-bucket
```

---

## 4. 用户交互流程

### 4.1 CLI 使用流程

```bash
# 1. 创建备份组配置
db-backup create-group --file backup-group.yaml

# 2. 查看备份组
db-backup list-groups

# 3. 执行整个组
db-backup run-group myapp-backup-group

# 4. 执行单个任务
db-backup run --name users-backup --group myapp-backup-group

# 5. 查看备份历史
db-backup history --group myapp-backup-group
```

### 4.2 K8s 使用流程

```yaml
apiVersion: backup.taicode/v1
kind: BackupGroup
metadata:
  name: myapp-backup-group
spec:
  source:
    type: postgresql
    connection:
      host: postgres.database.svc
      port: 5432
      username: backup
      passwordSecretRef:
        name: myapp-backup-secret
        key: DB_PASSWORD
  defaultDestination:
    type: s3
    s3:
      endpoint: https://s3.amazonaws.com
      region: us-east-1
      bucket: my-backups
      accessKeySecretRef:
        name: myapp-backup-secret
        key: AWS_ACCESS_KEY_ID
      secretKeySecretRef:
        name: myapp-backup-secret
        key: AWS_SECRET_ACCESS_KEY
  tasks:
    - name: users-backup
      source:
        database: app
        tables: [users, profiles]
    - name: orders-backup
      source:
        database: app
        tables: [orders, order_items]
      destination:  # 覆盖 defaultDestination
        type: s3
        s3:
          bucket: archive-backups
```

---

## 5. 执行流程

### 5.1 组级别执行流程

```
BackupGroup 配置加载
     │
     ▼
遍历 spec.tasks[]
     │
     ├──▶ Task 1: app.users → primary-bucket
     │     ├── 合并配置（组级别 + 任务级别）
     │     ├── 连接到 PostgreSQL
     │     ├── pg_dump app.users
     │     ├── 压缩 + 上传
     │     └── 记录 BackupResult
     │
     ├──▶ Task 2: app.orders → archive-bucket
     │     ├── 合并配置（destination 被覆盖）
     │     ├── 连接到 PostgreSQL（复用连接）
     │     ├── pg_dump app.orders
     │     ├── 压缩 + 上传到 archive-bucket
     │     └── 记录 BackupResult
     │
     └──▶ Task N: ...
```

### 5.2 错误处理

| 场景 | 处理策略 |
|------|----------|
| 单个任务失败 | 记录错误，继续执行其他任务 |
| 连接失败 | 重试 3 次，间隔 5s |
| S3 上传失败 | 重试 3 次，间隔 10s |
| 组内所有任务失败 | BackupGroup 状态 = Failed |

---

## 6. 输出示例

### 6.1 组执行输出

```
$ db-backup run-group myapp-backup-group
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Backup Group: myapp-backup-group
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[10:01:00] Starting backup group: myapp-backup-group
[10:01:01] Connected to PostgreSQL (postgres:5432)
[10:01:02] Found 3 tasks to execute

▶ Task 1/3: users-backup
  Database: app.users, app.profiles
  Target: S3 (primary-bucket)
  Status: 🟢 Running

[10:01:03] Dumping app.users (125,000 rows)...
[10:01:08] ✓ Dumped app.users (8.2 MB)
[10:01:09] Dumping app.profiles (125,000 rows)...
[10:01:14] ✓ Dumped app.profiles (4.1 MB)
[10:01:15] Compressing (gzip)...
[10:01:17] ✓ Compressed (2.1 MB)
[10:01:18] Uploading to S3...
[10:01:22] ✓ Uploaded (app/users-20260418.sql.gz)
  Status: 🟢 Completed in 20s

▶ Task 2/3: orders-backup
  Database: app.orders
  Target: S3 (archive-bucket)
  Status: 🟢 Running

[10:01:23] Dumping app.orders (1,500,000 rows)...
[10:01:45] ✓ Dumped app.orders (95.2 MB)
[10:01:46] Compressing (gzip)...
[10:01:50] ✓ Compressed (12.3 MB)
[10:01:51] Uploading to S3 (archive-bucket)...
[10:01:58] ✓ Uploaded (app/orders-20260418.sql.gz)
  Status: 🟢 Completed in 35s

▶ Task 3/3: sensitive-backup
  Database: app.user_credentials
  Target: S3 (sensitive-bucket)
  Status: 🟢 Running

[10:01:59] Dumping app.user_credentials...
[10:02:01] ✓ Dumped (0.5 MB)
[10:02:02] ✓ Uploaded
  Status: 🟢 Completed in 3s

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✓ Backup group completed
  Total: 3 tasks, 3 succeeded, 0 failed
  Duration: 62s
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 7. 设计决策记录

| 日期 | 决策 | 理由 |
|------|------|------|
| 2026-04-18 | BackupGroup 多任务架构 | 支持多库多目标场景 |
| 2026-04-18 | 任务级 destination 覆盖 | 灵活满足不同目标需求 |
| 2026-04-18 | 组内共享数据库连接 | 减少连接开销 |
