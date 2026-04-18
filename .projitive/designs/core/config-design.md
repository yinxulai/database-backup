# Database Backup 配置设计 v2

> Version: 0.2.0
> Status: Draft
> Last Updated: 2026-04-18

---

## 1. 配置设计原则

1. **声明式配置** - 用户声明想要的状态，系统负责实现
2. **YAML 优先** - 人类友好，K8s 原生
3. **敏感信息分离** - 密码/密钥通过 SecretRef 引用
4. **多目标支持** - 一个配置支持多个备份任务组

---

## 2. 核心概念

### 2.1 三层结构

```
BackupGroup（备份组）
├── 定义一组共享相同来源的备份任务
│
├── Source（来源）
│   ├── 单个数据库实例
│   └── 多个表
│
└── Destinations（目标列表）
    ├── 目标 1: S3 + 表 A, B
    └── 目标 2: 另一个 S3 + 表 C
```

### 2.2 使用场景

| 场景 | 配置方式 |
|------|----------|
| 同一个库，备份到不同 S3 | 一个 Source，多个 Destination |
| 不同库，不同 S3 | 多个 BackupTask |
| 同库不同表，不同目标 | 一个 Source，多个 Destination，每个 destination 关联不同表 |

---

## 3. 配置格式 v2

### 3.1 BackupGroup（备份组）

```yaml
# backup-group.yaml
apiVersion: backup.taicode/v1
kind: BackupGroup
metadata:
  name: myapp-backup-group
  labels:
    app: myapp
spec:
  # 全局来源（这个数据库实例下的所有库/表）
  source:
    type: postgresql
    connection:
      host: postgres.database.svc
      port: 5432
      username: backup-user
      passwordSecretRef:
        name: myapp-backup-secret
        key: DB_PASSWORD
      database: ""  # 空 = 不指定具体库，任务内指定

  # 全局目标（所有任务都上传到这里）
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
      pathPrefix: "prod/{{.Database}}/{{.Date}}"

  # 备份任务列表（可以定义多个）
  tasks:
    # 任务 1: 备份 app 库的用户表 到主 S3
    - name: app-users-backup
      description: "备份 app 库的用户表到主 S3"
      source:
        database: app
        tables:
          - users
          - profiles
      destination:
        type: s3
        s3:
          endpoint: https://s3.amazonaws.com
          region: us-east-1
          bucket: my-backups-primary
          accessKeySecretRef:
            name: myapp-backup-secret
            key: AWS_ACCESS_KEY_ID
          secretKeySecretRef:
            name: myapp-backup-secret
            key: AWS_SECRET_ACCESS_KEY
          pathPrefix: "app/users/{{.Date}}"

    # 任务 2: 备份 app 库的订单表 到归档 S3
    - name: app-orders-backup
      description: "备份 app 库的订单表到归档 S3"
      source:
        database: app
        tables:
          - orders
          - order_items
      destination:
        type: s3
        s3:
          endpoint: https://s3.amazonaws.com
          region: us-west-2
          bucket: my-backups-archive
          accessKeySecretRef:
            name: myapp-backup-secret
            key: AWS_ARCHIVE_ACCESS_KEY_ID
          secretKeySecretRef:
            name: myapp-backup-secret
            key: AWS_ARCHIVE_SECRET_ACCESS_KEY
          pathPrefix: "app/orders/{{.Date}}"

    # 任务 3: 备份 analytics 库 到主 S3
    - name: analytics-backup
      description: "备份整个 analytics 库"
      source:
        database: analytics
        tables: []  # 空 = 全库
      destination:
        # 省略 = 使用 defaultDestination
```

---

## 4. 配置结构详解

### 4.1 BackupGroup Spec

```typescript
interface BackupGroupSpec {
  /** 备份组名称 */
  name: string

  /** 描述 */
  description?: string

  /** 全局来源配置 */
  source: GroupSource

  /** 全局默认目标（任务内可覆盖） */
  defaultDestination?: BackupDestination

  /** 备份任务列表 */
  tasks: BackupTaskSpec[]
}

interface GroupSource {
  /** 数据库类型 */
  type: DatabaseType

  /** 连接配置（库级别以下在任务内指定） */
  connection: ConnectionConfig

  /** 默认数据库（任务内可覆盖） */
  database?: string
}
```

### 4.2 BackupTaskSpec（任务级别）

```typescript
interface BackupTaskSpec {
  /** 任务名称（组内唯一） */
  name: string

  /** 描述 */
  description?: string

  /** 来源配置（继承自组，可覆盖） */
  source: TaskSource

  /** 目标配置（覆盖 defaultDestination） */
  destination?: BackupDestination

  /** 压缩格式 */
  compression?: 'gzip' | 'none'

  /** 调度配置 */
  schedule?: ScheduleConfig

  /** 保留策略 */
  retention?: RetentionConfig
}

interface TaskSource {
  /** 数据库名称（覆盖组级别） */
  database?: string

  /** 要备份的表（空 = 全库） */
  tables?: string[]

  /** 每表行数限制 */
  rowsLimit?: number
}
```

---

## 5. 配置继承规则

### 5.1 继承关系图

```
BackupGroup
    │
    ├── source.type ──────────────────────▶ 所有任务继承
    ├── source.connection ────────────────▶ 所有任务继承
    ├── defaultDestination ───────────────▶ 所有任务继承（可覆盖）
    │
    └── tasks[0]
        ├── name ──────────────────────────▶ 任务独有
        ├── source.database ──────────────▶ 可覆盖组级别
        ├── source.tables ────────────────▶ 任务独有
        ├── destination ─────────────────▶ 覆盖 defaultDestination
        ├── compression ─────────────────▶ 可覆盖组级别
        ├── schedule ─────────────────────▶ 任务独有
        └── retention ───────────────────▶ 任务独有
```

### 5.2 继承示例

```yaml
# 组级别定义了 defaultDestination
defaultDestination: &defaultS3
  type: s3
  s3:
    bucket: primary-backups

tasks:
  # 任务 A: 使用 defaultDestination（继承）
  - name: task-a
    source:
      database: db1
      tables: [users]

  # 任务 B: 覆盖为自己的 destination
  - name: task-b
    source:
      database: db2
      tables: [orders]
    destination:  # 覆盖
      type: s3
      s3:
        bucket: archive-backups
```

---

## 6. 多数据库实例支持

### 6.1 场景：一个集群有多个数据库实例

```yaml
# 方式 1: 多个 BackupGroup（推荐，职责分离）
---
apiVersion: backup.taicode/v1
kind: BackupGroup
metadata:
  name: postgres-primary-backups
spec:
  source:
    type: postgresql
    connection:
      host: postgres-primary.svc
      port: 5432
      ...
  tasks:
    - name: primary-app-backup
      ...

---
apiVersion: backup.taicode/v1
kind: BackupGroup
metadata:
  name: postgres-replica-backups
spec:
  source:
    type: postgresql
    connection:
      host: postgres-replica.svc
      port: 5432
      ...
  tasks:
    - name: replica-app-backup
      ...
```

### 6.2 场景：同一个实例，不同库

```yaml
apiVersion: backup.taicode/v1
kind: BackupGroup
metadata:
  name: single-instance-multi-db
spec:
  source:
    type: postgresql
    connection:
      host: postgres.svc
      port: 5432
      username: backup
      passwordSecretRef: ...
  tasks:
    - name: app-db-backup
      source:
        database: app
        tables: [users, orders]
      destination:
        type: s3
        s3:
          endpoint: ...
          bucket: app-backups

    - name: analytics-db-backup
      source:
        database: analytics
        tables: [events, metrics]
      destination:
        type: s3
        s3:
          endpoint: ...
          bucket: analytics-backups
```

---

## 7. 完整配置示例

### 7.1 生产环境多组配置

```yaml
apiVersion: backup.taicode/v1
kind: BackupGroup
metadata:
  name: prod-databases-backup
  labels:
    env: production
spec:
  # 主库实例
  source:
    type: postgresql
    connection:
      host: postgres-master.prod.svc
      port: 5432
      username: backup-user
      passwordSecretRef:
        name: prod-backup-secret
        key: DB_PASSWORD
      ssl: true

  # 默认目标：主 S3
  defaultDestination:
    type: s3
    s3:
      endpoint: https://s3.amazonaws.com
      region: us-east-1
      bucket: prod-backups
      accessKeySecretRef:
        name: prod-backup-secret
        key: AWS_ACCESS_KEY_ID
      secretKeySecretRef:
        name: prod-backup-secret
        key: AWS_SECRET_ACCESS_KEY
      pathPrefix: "{{.Database}}/{{.Date}}"
    compression: gzip

  # 任务列表
  tasks:
    # 用户服务库
    - name: users-db-backup
      description: "用户服务库每日备份"
      source:
        database: users
        tables: []  # 全库
      retention:
        retentionDays: 30
        maxBackups: 30
      schedule:
        cron: "0 2 * * *"
        timezone: "Asia/Shanghai"

    # 订单服务库（高频备份）
    - name: orders-db-backup
      description: "订单服务库，每小时备份"
      source:
        database: orders
        tables: [orders, order_items, payments]
      retention:
        retentionDays: 7
      schedule:
        cron: "0 */1 * * *"  # 每小时
        timezone: "Asia/Shanghai"

    # 敏感表单独备份到归档存储
    - name: sensitive-data-backup
      description: "敏感数据备份到归档 S3"
      source:
        database: users
        tables: [user_credentials, user_identities]
      destination:
        type: s3
        s3:
          endpoint: https://s3.amazonaws.com
          region: us-west-2
          bucket: prod-backups-sensitive
          accessKeySecretRef:
            name: prod-backup-secret
            key: AWS_ARCHIVE_ACCESS_KEY_ID
          secretKeySecretRef:
            name: prod-backup-secret
            key: AWS_ARCHIVE_SECRET_ACCESS_KEY
          pathPrefix: "sensitive/{{.Database}}/{{.Date}}"
        compression: gzip
      retention:
        retentionDays: 90
      schedule:
        cron: "0 3 * * *"
        timezone: "Asia/Shanghai"
```

---

## 8. K8s CRD 设计 v2

### 8.1 BackupGroup CRD

```yaml
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: backupgroups.backup.taicode
spec:
  group: backup.taicode
  names:
    kind: BackupGroup
    listKind: BackupGroupList
    singular: backupgroup
    plural: backupgroups
  scope: Namespaced
  versions:
    - name: v1
      served: true
      storage: true
      schema:
        openAPIV3Schema:
          type: object
          properties:
            spec:
              type: object
              properties:
                name:
                  type: string
                description:
                  type: string
                source:
                  type: object
                defaultDestination:
                  type: object
                tasks:
                  type: array
                  items:
                    type: object
```

### 8.2 资源关系

```
BackupGroup (CR)
  │
  ├── 定义 source (连接信息)
  ├── 定义 defaultDestination
  │
  └── 包含多个 BackupTask (逻辑概念，由 Controller 展开)
       │
       ├── BackupTask 1 ──▶ BackupResult 1
       ├── BackupTask 2 ──▶ BackupResult 2
       └── BackupTask N ──▶ BackupResult N

BackupResult (CR)
  │
  └── 记录单个任务的执行结果
```

---

## 9. 执行流程 v2

```
BackupGroup 加载
     │
     ▼
解析 SecretRef（从 K8s Secret 获取实际值）
     │
     ▼
遍历 tasks[]
     │
     ├──▶ 任务 1:
     │     ├── 合并 source (组级别 + 任务级别)
     │     ├── 合并 destination (defaultDestination + 覆盖)
     │     ├── 创建数据库适配器
     │     ├── 执行 dump
     │     ├── 上传到 S3
     │     └── 创建 BackupResult
     │
     ├──▶ 任务 2:
     │     └── ...
     │
     └──▶ 任务 N:
           └── ...
```

---

## 10. 配置校验规则

### 10.1 必填字段

| 字段 | 说明 |
|------|------|
| `metadata.name` | BackupGroup 名称 |
| `spec.source.type` | 数据库类型 |
| `spec.source.connection` | 连接配置 |
| `spec.tasks` | 任务列表（至少 1 个） |
| `spec.tasks[].name` | 组内任务名称唯一 |
| `spec.tasks[].destination` 或 `spec.defaultDestination` | 至少有一个目标 |

### 10.2 校验约束

```typescript
// 任务名称在组内唯一
const taskNames = new Set(spec.tasks.map(t => t.name))
if (taskNames.size !== spec.tasks.length) {
  throw new Error('Task names must be unique within a group')
}

// 必须有目标
for (const task of spec.tasks) {
  if (!task.destination && !spec.defaultDestination) {
    throw new Error(`Task ${task.name} has no destination`)
  }
}
```

---

## 11. 设计决策记录

| 日期 | 决策 | 理由 |
|------|------|------|
| 2026-04-18 | 从单任务改为 BackupGroup | 支持多数据库、多目标场景 |
| 2026-04-18 | 组级别 defaultDestination | 减少重复配置 |
| 2026-04-18 | 任务级别覆盖机制 | 灵活满足不同目标需求 |
