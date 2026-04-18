# Database Backup 核心架构设计

> Version: 0.3.0
> Status: Draft
> Last Updated: 2026-04-18

---

## 1. 产品定位

**一句话定位**：多模态数据库备份工具，底层是 CI，之上支持 K8s / Docker / CLI 等多种部署形态

**核心价值**：
- 🎯 **CI-First** - 核心是纯 CI pipeline，与部署形态解耦
- 🚀 **多形态部署** - CLI / Docker / K8s Operator 一套核心，多种玩法
- 🔄 **支持多数据库** - PostgreSQL（首期）、MySQL、MongoDB、Redis
- 📦 **支持多存储后端** - S3（首期）、MinIO、Local
- ⏰ **支持定时和手动触发**
- 🔒 **敏感信息通过 SecretRef 管理**

---

## 2. 部署形态

### 2.1 三种部署形态

```
┌─────────────────────────────────────────────────────────────┐
│                    Backup CI Core                          │
│                  （纯 CI，核心引擎）                        │
└─────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   CLI Mode      │  │  Docker Mode    │  │ K8s Operator   │
│                 │  │                 │  │                │
│  db-backup      │  │  docker run     │  │ BackupGroup    │
│  run --task xxx │  │  --config ...  │  │ CRD + Ctrl     │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

### 2.2 形态对比

| 形态 | 适用场景 | 配置方式 | 调度方式 |
|------|----------|----------|----------|
| **CLI** | 单次备份、开发测试、小型项目 | YAML/JSON 文件 | 手动或系统 Cron |
| **Docker** | 独立服务器、虚拟机、混合云 | YAML 文件 + 环境变量 | 手动或宿主机 Cron |
| **K8s Operator** | K8s 生产集群、自动化运维 | CRD + Secret | Controller 定时 |

### 2.3 场景示例

**CLI 场景：**
```bash
# 手动执行单次备份
db-backup run --config ./backup.yaml --task users-backup

# 查看历史
db-backup history --config ./backup.yaml --task users-backup
```

**Docker 场景：**
```bash
# 运行备份容器
docker run \
  -v ./backup-config:/config \
  -e AWS_ACCESS_KEY_ID=xxx \
  -e AWS_SECRET_ACCESS_KEY=xxx \
  db-backup run --config /config/backup.yaml
```

**K8s Operator 场景：**
```yaml
apiVersion: backup.taicode/v1
kind: BackupGroup
metadata:
  name: myapp-backups
spec:
  # ...
# Operator 自动处理定时和故障恢复
```

---

## 3. 核心架构

### 3.1 分层设计

```
┌──────────────────────────────────────────────────────────────┐
│                     Deployment Layer                        │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐       │
│  │   CLI   │  │ Docker  │  │ K8s CRD │  │  API    │       │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘       │
└───────┼─────────────┼─────────────┼─────────────┼───────────┘
        │             │             │             │
┌───────┴─────────────┴─────────────┴─────────────┴───────────┐
│                    Interface Layer                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ TaskRunner  │  │ Scheduler   │  │ ResultStore │        │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘        │
└─────────┼─────────────────┼─────────────────┼──────────────┘
          │                 │                 │
┌─────────┴─────────────────┴─────────────────┴──────────────┐
│                     CI Core Layer                         │
│                                                              │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐ │
│  │ Scanner │───▶│ Loader  │───▶│ Runner  │───▶│ Uploader│ │
│  └─────────┘    └─────────┘    └─────────┘    └─────────┘ │
│       │              │             │              │        │
│       └──────────────┴─────────────┴──────────────┘        │
│                       │                                    │
│              ┌────────┴────────┐                          │
│              │ BackupExecutor  │                           │
│              └────────┬────────┘                          │
│                       │                                    │
│       ┌───────────────┼───────────────┐                   │
│       ▼               ▼               ▼                   │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐               │
│  │Database │    │Compress │    │Storage  │               │
│  │Adapter  │    │Pipeline │    │Adapter  │               │
│  └─────────┘    └─────────┘    └─────────┘               │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 核心组件

#### CI Core Layer（核心引擎，与部署形态无关）

| 组件 | 职责 | 输入 | 输出 |
|------|------|------|------|
| **Scanner** | 扫描配置文件，解析 BackupGroup | YAML/JSON | BackupGroup[] |
| **Loader** | 加载 SecretRef（环境变量/K8s Secret） | BackupGroup | ResolvedConfig |
| **Runner** | 遍历任务，执行备份 | ResolvedConfig | BackupResult[] |
| **Uploader** | 上传到存储 | Readable stream | UploadResult |

#### Adapter Layer（适配器层，可扩展）

| 适配器 | 实现 |
|--------|------|
| **DatabaseAdapter** | PostgreSQL, MySQL, MongoDB, Redis |
| **StorageAdapter** | S3, MinIO, Local |
| **SecretAdapter** | EnvVar, K8s Secret, Vault |

#### Interface Layer（接口层）

| 接口 | 用途 |
|------|------|
| **TaskRunner** | CLI/Docker 调用的任务执行接口 |
| **Scheduler** | 定时调度接口（K8s CronJob / 系统 Cron） |
| **ResultStore** | 结果存储接口（K8s CRD / 文件 / 数据库） |

---

## 4. 目录结构

```
database-backup/
├── source/
│   ├── index.ts                    # 入口
│   │
│   ├── cli/                        # CLI 接口
│   │   ├── index.ts
│   │   └── commands/
│   │       ├── run.ts
│   │       ├── history.ts
│   │       └── init.ts
│   │
│   ├── core/                       # CI 核心（与部署形态无关）
│   │   ├── scanner.ts             # 配置扫描
│   │   ├── loader.ts              # 配置加载 + Secret 解析
│   │   ├── executor.ts            # 备份执行器
│   │   └── types.ts               # 核心类型
│   │
│   ├── adapters/                   # 适配器层
│   │   ├── database/              # 数据库适配器
│   │   │   ├── interface.ts
│   │   │   ├── postgresql.ts
│   │   │   ├── mysql.ts
│   │   │   └── mongodb.ts
│   │   │
│   │   ├── storage/               # 存储适配器
│   │   │   ├── interface.ts
│   │   │   ├── s3.ts
│   │   │   └── local.ts
│   │   │
│   │   └── secret/                # 密钥适配器
│   │       ├── interface.ts
│   │       ├── env-var.ts
│   │       └── k8s-secret.ts
│   │
│   └── k8s/                       # K8s Operator
│       ├── controller.ts
│       ├── crd/
│       │   ├── backupgroup.ts
│       │   └── backupresult.ts
│       └── reconciler.ts
│
├── docker/                         # Docker 相关
│   └── Dockerfile
│
├── k8s/                            # K8s 部署清单
│   ├── crd.yaml
│   ├── operator.yaml
│   └── examples/
│
└── configs/                        # 配置示例
    ├── backup-group-example.yaml
    └── .env.example
```

---

## 5. 配置模型（统一）

### 5.1 BackupGroup（核心配置）

无论 CLI / Docker / K8s，都是同一个配置模型：

```typescript
interface BackupGroup {
  apiVersion: 'backup.taicode/v1'
  kind: 'BackupGroup'
  metadata: {
    name: string
    labels?: Record<string, string>
  }
  spec: BackupGroupSpec
}

interface BackupGroupSpec {
  // 全局来源
  source: GroupSource

  // 全局默认目标
  defaultDestination?: BackupDestination

  // 任务列表
  tasks: BackupTask[]
}

interface BackupTask {
  name: string
  description?: string

  // 来源（继承或覆盖组级别）
  source?: {
    database?: string
    tables?: string[]
  }

  // 目标（覆盖 defaultDestination）
  destination?: BackupDestination

  // 压缩
  compression?: 'gzip' | 'none'

  // 调度
  schedule?: CronSchedule

  // 保留策略
  retention?: RetentionConfig
}
```

### 5.2 配置解析流程

```
YAML/JSON 文件
     │
     ▼
Scanner.scan() → BackupGroup[]
     │
     ▼
Loader.resolve() → ResolvedConfig[]
     │  ├── 解析 SecretRef
     │  ├── 合并继承关系
     │  └── 校验配置
     │
     ▼
Executor.execute() → BackupResult[]
     │  ├── 创建 DatabaseAdapter
     │  ├── 创建 StorageAdapter
     │  └── 执行备份
     │
     ▼
ResultStore.save() → 持久化结果
```

---

## 6. 多形态执行模式

### 6.1 CLI 模式

```bash
# 初始化
db-backup init

# 运行备份
db-backup run --config ./backup.yaml
db-backup run --config ./backup.yaml --task users-backup  # 单任务

# 查看历史
db-backup history --config ./backup.yaml

# 测试连接
db-backup test --config ./backup.yaml
```

### 6.2 Docker 模式

```bash
# 构建镜像
docker build -t db-backup:latest .

# 运行备份
docker run \
  -v $(pwd)/configs:/config \
  -v $(pwd)/secrets:/secrets \
  -e AWS_ACCESS_KEY_ID \
  -e AWS_SECRET_ACCESS_KEY \
  db-backup:latest run --config /config/backup.yaml

# 定时任务（配合宿主机的 cron）
# 在宿主机的 crontab 中添加：
# 0 2 * * * docker run --rm db-backup:latest run --config /config/backup.yaml
```

### 6.3 K8s Operator 模式

```yaml
# 创建 CR
apiVersion: backup.taicode/v1
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
      # ... 其他 S3 配置
  tasks:
    - name: users-backup
      source:
        database: app
        tables: [users, profiles]
      schedule:
        cron: "0 2 * * *"
```

Operator 会：
- Watch BackupGroup CR
- 创建 CronJob 实现定时
- 创建 Job 执行备份
- 记录 BackupResult CR

---

## 7. Secret 管理

### 7.1 SecretAdapter 接口

```typescript
interface SecretAdapter {
  // 获取密钥值
  get(ref: SecretRef): Promise<string>

  // 检查密钥是否存在
  exists(ref: SecretRef): Promise<boolean>
}
```

### 7.2 密钥适配器实现

| 适配器 | 适用场景 | 密钥来源 |
|--------|----------|----------|
| **EnvVarAdapter** | CLI / Docker | 环境变量 |
| **K8sSecretAdapter** | K8s Operator | K8s Secret |
| **VaultAdapter** | 企业级 | HashiCorp Vault |

### 7.3 SecretRef 定义

```typescript
interface SecretRef {
  // 密钥来源类型
  type: 'env' | 'k8s' | 'vault'

  // K8s Secret 场景
  name?: string      // Secret 名称
  key?: string       // Secret 中的 key

  // Env 场景
  envVar?: string    // 环境变量名

  // Vault 场景
  path?: string      // Vault 路径
  field?: string     // 字段名
}
```

### 7.4 配置示例

```yaml
# K8s 场景 - 使用 K8s Secret
source:
  connection:
    passwordSecretRef:
      type: k8s
      name: myapp-secret
      key: DB_PASSWORD

# Docker/CLI 场景 - 使用环境变量
source:
  connection:
    passwordSecretRef:
      type: env
      envVar: DB_PASSWORD
```

---

## 8. 执行流程

### 8.1 完整执行流程

```
┌─────────────────────────────────────────────────────────────┐
│                     Entry Point                            │
│  CLI: db-backup run / Docker: entrypoint / K8s: Job Pod    │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  Scanner.scan(config)                                       │
│  - 读取 YAML/JSON 配置                                      │
│  - 解析 BackupGroup                                         │
│  - 验证格式                                                 │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  Loader.resolve(groups, secretAdapter)                      │
│  - 根据部署形态选择 SecretAdapter                            │
│  - 解析所有 SecretRef                                        │
│  - 合并继承关系                                              │
│  - 输出 ResolvedConfig                                       │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  Executor.execute(config)                                   │
│                                                              │
│  for each task in config.tasks:                             │
│    │                                                         │
│    ├──▶ 1. 创建 DatabaseAdapter (by source.type)            │
│    │     └── 测试连接                                        │
│    │                                                         │
│    ├──▶ 2. 执行 dump (pg_dump / mysqldump)                  │
│    │     └── 获取 Readable Stream                           │
│    │                                                         │
│    ├──▶ 3. 压缩 Pipeline (gzip / none)                     │
│    │     └── 输出到临时文件或 Pipe                           │
│    │                                                         │
│    ├──▶ 4. 计算 Checksum (SHA256)                          │
│    │                                                         │
│    ├──▶ 5. 创建 StorageAdapter (by destination.type)       │
│    │                                                         │
│    ├──▶ 6. 上传到 S3                                        │
│    │     └── 生成文件路径 key                                 │
│    │                                                         │
│    ├──▶ 7. 清理临时文件                                      │
│    │                                                         │
│    └──▶ 8. 记录 BackupResult                                │
│          └── 状态: completed/failed                         │
│                                                              │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  ResultStore.save(results)                                   │
│  - K8s: 创建 BackupResult CR                                │
│  - CLI/Docker: 保存到本地文件或输出 JSON                     │
└─────────────────────────────────────────────────────────────┘
```

### 8.2 错误处理

| 错误类型 | 处理策略 |
|----------|----------|
| Secret 解析失败 | 立即失败，无法继续 |
| 数据库连接失败 | 重试 3 次，间隔 5s，然后失败 |
| Dump 失败 | 立即失败，记录错误 |
| 上传失败 | 重试 3 次，间隔 10s，然后失败 |
| 单任务失败 | 记录错误，继续执行其他任务 |

---

## 9. K8s CRD 设计

### 9.1 CRD 列表

| CRD | 用途 |
|-----|------|
| **BackupGroup** | 定义备份任务组 |
| **BackupResult** | 记录备份执行结果 |

### 9.2 BackupGroup CRD

```yaml
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: backupgroups.backup.taicode
spec:
  group: backup.taicode
  names:
    kind: BackupGroup
  scope: Namespaced
  versions:
    - name: v1
      served: true
      storage: true
```

### 9.3 BackupResult CRD

```yaml
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: backupresults.backup.taicode
spec:
  group: backup.taicode
  names:
    kind: BackupResult
  scope: Namespaced
```

---

## 10. 实现计划

### Phase 1: CI Core ✅ (当前)
- [x] 配置类型定义
- [x] Scanner 模块
- [x] Loader 模块（框架）
- [x] Executor 模块（框架）
- [ ] PostgreSQL Adapter
- [ ] S3 Storage Adapter
- [ ] EnvVar Secret Adapter

### Phase 2: CLI + Docker
- [ ] CLI 命令实现
- [ ] Docker 镜像构建
- [ ] 本地文件 ResultStore

### Phase 3: K8s Operator
- [ ] CRD 部署
- [ ] Controller 实现
- [ ] CronJob 调度
- [ ] K8s Secret Adapter

### Phase 4: 扩展支持
- [ ] MySQL Adapter
- [ ] 保留策略实现
- [ ] 增量备份支持

---

## 11. 技术选型

### 11.1 核心依赖

```json
{
  "dependencies": {
    "@aws-sdk/client-s3": "^3.0.0",
    "yaml": "^2.0.0",
    "cron-parser": "^4.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0",
    "vitest": "^1.0.0"
  }
}
```

### 11.2 K8s 相关

```yaml
# Operator SDK 版本
operator-sdk: v1.36.0

# 运行时
nodejs: 20-alpine
```

---

## 12. 设计决策记录

| 日期 | 决策 | 理由 |
|------|------|------|
| 2026-04-18 | CI-First 架构 | 核心与部署形态解耦，多形态复用 |
| 2026-04-18 | 三层架构 | Interface / CI Core / Adapter 分离 |
| 2026-04-18 | SecretAdapter 抽象 | 支持多种密钥来源 |
| 2026-04-18 | 统一配置模型 | CLI / Docker / K8s 共用同一配置 |
