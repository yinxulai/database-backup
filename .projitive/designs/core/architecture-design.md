# Database Backup 核心架构设计

> Version: 0.4.0
> Status: Draft
> Last Updated: 2026-04-18

---

## 1. 产品定位

**一句话定位**：多模态数据库备份工具，底层是 CI，之上支持 K8s / Docker / CLI 等多种部署形态

**核心价值**：
- 🎯 **CI-First** - 核心是纯 CI pipeline，与部署形态解耦
- 🚀 **多形态部署** - CLI / Docker / K8s Operator 一套核心，多种玩法
- 🔄 **支持多数据库** - PostgreSQL（首期）、MySQL、MongoDB、Redis
- 📦 **支持多存储后端** - S3（首期）、GCS、Azure Blob、Local
- ⏰ **支持定时任务** - 系统 Cron（简单可靠）
- 🔒 **敏感信息通过 SecretRef 管理**

---

## 2. 部署形态

### 2.1 三种部署形态

```
┌─────────────────────────────────────────────────────────────┐
│                    Backup CI Core                            │
│                  （纯 CI，核心引擎）                        │
└─────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   CLI Mode      │  │  Docker Mode    │  │ K8s Deployment  │
│                 │  │                 │  │                │
│  backup         │  │  docker run     │  │ Docker in K8s   │
│  run --config   │  │  backup run     │  │ + CronJob       │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

### 2.2 形态对比

| 形态 | 适用场景 | 调度方式 |
|------|----------|----------|
| **CLI** | 单次备份、开发测试 | 手动或系统 Cron |
| **Docker** | 独立服务器、VM、K8s Pod | 宿主/CronJob/Controller |
| **K8s** | K8s 生产集群 | CronJob 或 Controller |

---

## 3. 核心架构

### 3.1 两层架构

```
┌──────────────────────────────────────────────────────────────┐
│                     Interface Layer                          │
│  CLI 入口 (src/cli/run.ts)                                  │
└──────────────────────────────────────────────────────────────┘
                           │
┌───────────────────────────▼──────────────────────────────────┐
│                      Core Layer                              │
│                                                              │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐               │
│  │ Scanner │───▶│ Loader  │───▶│ Executor│───▶ Result     │
│  └─────────┘    └─────────┘    └─────────┘               │
│                                              │              │
│       ┌─────────────────────────────────────┴────────────┐ │
│       │              Adapters                            │ │
│       │  ┌──────────┐  ┌──────────┐  ┌──────────┐       │ │
│       │  │Database  │  │ Storage  │  │  Secret  │       │ │
│       │  │Adapter   │  │ Adapter  │  │  Ref     │       │ │
│       │  └──────────┘  └──────────┘  └──────────┘       │ │
│       └──────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 组件职责

| 组件 | 职责 |
|------|------|
| **Scanner** | 读取 YAML/JSON 配置 |
| **Loader** | 解析 SecretRef（env / k8s-secret）|
| **Executor** | 协调备份流程 |
| **DatabaseAdapter** | 数据库连接和 dump |
| **StorageAdapter** | 上传到存储 |
| **SecretRef** | 密钥引用解析 |

---

## 4. 目录结构

```
backup/
├── source/
│   ├── cli/
│   │   ├── run.ts
│   │   ├── history.ts
│   │   └── index.ts
│   │
│   ├── core/
│   │   ├── scanner.ts
│   │   ├── loader.ts
│   │   ├── executor.ts
│   │   └── types.ts
│   │
│   └── adapters/
│       ├── database/
│       │   ├── interface.ts
│       │   └── postgresql.ts    # 首期
│       │
│       ├── storage/
│       │   ├── interface.ts
│       │   └── s3.ts            # 首期
│       │
│       └── secret/
│           ├── interface.ts
│           ├── env.ts
│           └── k8s-secret.ts
│
├── output/                      # 编译产物 + SEA 二进制
├── scripts/
│   └── build-sea.mjs
├── configs/
│   └── example.yaml
├── package.json
└── tsconfig.json
```

---

## 5. 配置模型

### 5.1 BackupGroup

```typescript
interface BackupGroup {
  apiVersion: 'backup.yinxulai/v1'
  kind: 'BackupGroup'
  metadata: {
    name: string
    labels?: Record<string, string>
  }
  spec: BackupGroupSpec
}

interface BackupGroupSpec {
  // 来源
  source: BackupSource

  // 目标
  destination: BackupDestination

  // 调度（可选，不填 = 手动执行）
  schedule?: ScheduleConfig

  // 保留策略（可选）
  retention?: RetentionConfig
}

interface BackupSource {
  // 数据库类型
  type: DatabaseType

  // 连接配置
  connection: ConnectionConfig

  // 数据库名称
  database: string

  // Schema（默认 public）
  schema?: string

  // 要备份的表（空 = 全库）
  tables?: string[]
}

interface BackupDestination {
  // 存储类型
  type: StorageType

  // S3 配置（首期只支持 S3）
  s3?: S3Config

  // Local 配置（后续）
  local?: LocalConfig
}

type DatabaseType = 'postgresql' | 'mysql' | 'mongodb' | 'redis'
type StorageType = 's3' | 'gcs' | 'azure' | 'local'
```

### 5.2 完整配置示例

```yaml
apiVersion: backup.yinxulai/v1
kind: BackupGroup
metadata:
  name: myapp-postgres-backup
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
      ssl: true
    database: app
    schema: public
    tables:
      - users
      - orders
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
      pathPrefix: "app/{{.Date}}"
  schedule:
    enabled: true
    cron: "0 2 * * *"
    timezone: "Asia/Shanghai"
  retention:
    retentionDays: 7
```

---

## 6. 支持的数据库

| 数据库 | 状态 | 备份方式 |
|--------|------|----------|
| PostgreSQL | ✅ 首期 | pg_dump |
| MySQL | 🟡 后续 | mysqldump |
| MongoDB | 🟡 后续 | mongodump |
| Redis | 🟡 后续 | SAVE/BGSAVE |

---

## 7. 支持的存储

| 存储 | 状态 | 说明 |
|------|------|------|
| S3 | ✅ 首期 | AWS S3 / MinIO |
| GCS | 🟡 后续 | Google Cloud Storage |
| Azure Blob | 🟡 后续 | Azure Blob Storage |
| Local | 🟡 后续 | 本地文件系统 |

---

## 8. Secret 管理

### 8.1 SecretRef

```typescript
interface SecretRef {
  // 类型: env (环境变量) / k8s (K8s Secret)
  type: 'env' | 'k8s'

  // 环境变量名
  envVar?: string

  // K8s Secret 引用
  name?: string      // Secret 名称
  key?: string       // Secret 中的 key
}
```

### 8.2 使用示例

```yaml
# CLI/Docker - 使用环境变量
passwordSecretRef:
  type: env
  envVar: DB_PASSWORD

# K8s - 使用 K8s Secret
passwordSecretRef:
  type: k8s
  name: myapp-secret
  key: DB_PASSWORD
```

---

## 9. 调度

### 9.1 系统 Cron

```bash
# /etc/cron.d/backup
# 每天凌晨 2 点执行
0 2 * * * root docker run --rm \
  -v /path/to/config:/config \
  backup run --config /config/backup.yaml
```

### 9.2 配置

```yaml
schedule:
  enabled: true
  cron: "0 2 * * *"
  timezone: "Asia/Shanghai"
```

---

## 10. 构建

### 10.1 SEA 构建

```bash
# 构建流程
pnpm build          # TypeScript → output/
pnpm build:sea      # SEA 打包

# 输出
output/
├── cli/
├── core/
├── adapters/
└── backup          # SEA 二进制
```

### 10.2 发布

```bash
# GitHub Releases
out/backup          # Linux x64
out/backup.exe      # Windows
```

---

## 11. 实现计划

### Phase 1: 核心功能
- [ ] TypeScript 源码实现
- [ ] PostgreSQL Adapter
- [ ] S3 Storage Adapter
- [ ] CLI 基本命令
- [ ] SEA 构建流程

### Phase 2: 扩展
- [ ] MySQL Adapter
- [ ] 保留策略
- [ ] GCS Storage

### Phase 3: K8s
- [ ] CRD 定义
- [ ] Docker 镜像
- [ ] Helm Chart

---

## 12. 设计决策记录

| 日期 | 决策 | 理由 |
|------|------|------|
| 2026-04-18 | CI-First 架构 | 核心与部署形态解耦 |
| 2026-04-18 | 两层架构 | 简化分层，降低复杂度 |
| 2026-04-18 | SEA 构建为主 | 单二进制分发，用户体验好 |
| 2026-04-18 | 系统 Cron 调度 | 简单可靠，跨平台 |
| 2026-04-18 | 多数据库支持 | 生产环境确实有多个数据库 |
| 2026-04-18 | 多存储支持 | 避免未来破坏性更新 |
| 2026-04-18 | 保留 env/k8s Secret | 首期足够，Vault 后续 |
