# Database Backup 配置设计

> Version: 0.3.0
> Status: Draft
> Last Updated: 2026-04-18

---

## 1. 配置设计原则

1. **声明式配置** - 用户声明想要的状态，系统负责实现
2. **YAML 优先** - 人类友好，K8s 原生
3. **敏感信息分离** - 密码/密钥通过 SecretRef 引用
4. **一个实例一个 Group** - 简单清晰

---

## 2. 核心概念

### 2.1 BackupGroup

```
BackupGroup = 一个数据库实例的备份配置
```

- 一个 BackupGroup 对应一个数据库实例
- 不同数据库实例 = 不同 BackupGroup
- 多实例管理通过 Helm/Kustomize 实现

---

## 3. 配置格式

### 3.1 YAML 格式

```yaml
apiVersion: backup.yinxulai/v1
kind: BackupGroup
metadata:
  name: myapp-postgres-backup
  labels:
    app: myapp
spec:
  # 来源配置
  source:
    type: postgresql
    connection:
      host: postgres.database.svc
      port: 5432
      username: backup-user
      passwordSecretRef:
        name: myapp-backup-secret
        key: DB_PASSWORD
      ssl: true
    database: app
    schema: public
    tables:
      - users
      - orders
      - products

  # 目标配置
  destination:
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

  # 调度配置（可选）
  schedule:
    enabled: true
    cron: "0 2 * * *"
    timezone: "Asia/Shanghai"

  # 保留策略（可选）
  retention:
    retentionDays: 7
```

---

## 4. 配置字段详解

### 4.1 metadata

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | ✅ | BackupGroup 名称，**必须唯一** |
| `labels` | object | ❌ | 标签 |

### 4.2 source

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | string | ✅ | 数据库类型：`postgresql` / `mysql` 等 |
| `connection` | object | ✅ | 连接配置 |
| `database` | string | ✅ | 数据库名称 |
| `schema` | string | ❌ | Schema（默认 `public`）|
| `tables` | string[] | ❌ | 要备份的表（空 = 全库）|

### 4.3 source.tables 表引用格式

| 格式 | 含义 |
|------|------|
| `users` | `public.users`（使用默认 schema）|
| `app.orders` | `app.orders`（指定 schema）|

### 4.4 destination

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | string | ✅ | 存储类型：`s3`（首期）|
| `s3` | object | ✅（当 type=s3）| S3 配置 |

### 4.5 schedule

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `enabled` | boolean | ❌ | 是否启用（默认 true）|
| `cron` | string | ✅ | Cron 表达式 |
| `timezone` | string | ❌ | 时区（默认 UTC）|

### 4.6 retention

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `retentionDays` | number | ✅ | 保留天数 |

---

## 5. SecretRef

### 5.1 类型

| 类型 | 适用场景 |
|------|----------|
| `env` | CLI / Docker（环境变量）|
| `k8s` | K8s（K8s Secret）|

### 5.2 使用示例

```yaml
# CLI/Docker
passwordSecretRef:
  type: env
  envVar: DB_PASSWORD

# K8s
passwordSecretRef:
  type: k8s
  name: myapp-secret
  key: DB_PASSWORD
```

---

## 6. 路径模板

### 6.1 变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `{{.Database}}` | 数据库名称 | `app` |
| `{{.Schema}}` | Schema 名称 | `public` |
| `{{.Date}}` | 日期（YYYY-MM-DD） | `2026-04-18` |
| `{{.Time}}` | 时间（HH-mm-ss） | `02-00-00` |
| `{{.Type}}` | 数据库类型 | `postgresql` |

### 6.2 示例

```yaml
pathPrefix: "prod/{{.Database}}/{{.Date}}"
# 输出: prod/app/2026-04-18
```

---

## 7. 多实例管理

### 7.1 Helm 部署

```bash
# postgres-primary
helm install postgres-primary ./backup \
  --set backup.name=postgres-primary \
  --set backup.source.host=postgres-primary.svc \
  --set backup.destination.s3.bucket=primary-backups

# postgres-analytics
helm install postgres-analytics ./backup \
  --set backup.name=postgres-analytics \
  --set backup.source.host=postgres-analytics.svc \
  --set backup.destination.s3.bucket=analytics-backups
```

### 7.2 Kustomize 覆盖

```yaml
# base/backupgroup.yaml
apiVersion: backup.yinxulai/v1
kind: BackupGroup
metadata:
  name: backup
spec:
  # ... 基础配置

# overlays/prod/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
bases:
  - ../../base
patches:
  - path: postgres-primary-patch.yaml
  - path: postgres-analytics-patch.yaml
```

---

## 8. 配置示例

### 8.1 最小配置

```yaml
apiVersion: backup.yinxulai/v1
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
    tables: []
  destination:
    type: s3
    s3:
      endpoint: https://s3.amazonaws.com
      region: us-east-1
      bucket: my-backups
```

### 8.2 生产配置

```yaml
apiVersion: backup.yinxulai/v1
kind: BackupGroup
metadata:
  name: prod-users-backup
spec:
  source:
    type: postgresql
    connection:
      host: postgres.prod.svc
      port: 5432
      username: backup
      passwordSecretRef:
        type: k8s
        name: prod-backup-secret
        key: DB_PASSWORD
      ssl: true
    database: users
    schema: public
    tables:
      - users
      - profiles
      - user_sessions
  destination:
    type: s3
    s3:
      endpoint: https://s3.amazonaws.com
      region: us-east-1
      bucket: prod-backups
      accessKeySecretRef:
        type: k8s
        name: prod-backup-secret
        key: AWS_ACCESS_KEY_ID
      secretKeySecretRef:
        type: k8s
        name: prod-backup-secret
        key: AWS_SECRET_ACCESS_KEY
      pathPrefix: "users/{{.Date}}"
  schedule:
    enabled: true
    cron: "0 2 * * *"
    timezone: "Asia/Shanghai"
  retention:
    retentionDays: 30
```

---

## 9. 设计决策记录

| 日期 | 决策 | 理由 |
|------|------|------|
| 2026-04-18 | 一个实例一个 Group | 简单清晰，故障隔离 |
| 2026-04-18 | schema 支持 | PostgreSQL 多 schema 场景 |
| 2026-04-18 | env/k8s Secret | 首期足够，Vault 后续 |
