# Database Backup 核心架构设计

> Version: 0.1.0
> Status: Draft
> Last Updated: 2026-04-18

---

## 1. 产品定位

**目标**：替代过时的数据库备份工具，提供现代化的 K8s 原生数据库备份解决方案

**核心价值**：
- 🚀 K8s 原生部署（CRD + Operator）
- 🔄 支持多数据库类型
- 📦 支持多种存储后端（S3 为首期）
- ⏰ 支持定时任务和手动触发
- 🔒 数据安全传输

---

## 2. 核心功能

### 2.1 任务配置

任务配置包含以下核心属性：

```typescript
interface BackupTask {
  /** 任务名称 */
  name: string
  /** 任务描述 */
  description?: string
  /** 来源配置 */
  source: BackupSource
  /** 目标配置 */
  destination: BackupDestination
  /** 调度配置 */
  schedule?: ScheduleConfig
  /** 保留策略 */
  retention?: RetentionConfig
}

interface BackupSource {
  /** 数据库类型 */
  type: DatabaseType
  /** 连接配置 */
  connection: ConnectionConfig
  /** 要备份的表（为空则备份全库）*/
  tables?: string[]
  /** 每表行数限制（用于大表分块备份）*/
  rowsLimit?: number
}

type DatabaseType = 'postgresql' | 'mysql' | 'mongodb' | 'redis'

interface ConnectionConfig {
  host: string
  port: number
  username: string
  password: string
  database: string
  ssl?: boolean
}

interface BackupDestination {
  /** 存储类型 */
  type: 's3' | 'minio' | 'local'
  /** S3 配置（首期只支持 S3）*/
  s3?: S3Config
}

interface S3Config {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  pathPrefix?: string
}
```

### 2.2 数据库类型支持

| 数据库类型 | 支持状态 | 备份方式 |
|------------|----------|----------|
| PostgreSQL | ✅ 首期 | pg_dump |
| MySQL | 🟡 后续 | mysqldump |
| MongoDB | 🟡 后续 | mongodump |
| Redis | 🟡 后续 | SAVE/BGSAVE |

### 2.3 存储目标

**首期支持（S3 Protocol）**：

```typescript
interface S3BackupStorage {
  type: 's3'
  config: S3Config
  /** 文件压缩格式 */
  compression: 'gzip' | 'none'
  /** 分块大小（MB）*/
  chunkSize?: number
}
```

---

## 3. 系统架构

### 3.1 目录结构

```
source/
├── index.ts                    # 入口
├── config/                     # 配置管理
│   ├── loader.ts              # 配置加载器
│   └── validator.ts           # 配置校验
├── database/                  # 数据库抽象
│   ├── index.ts              # 数据库工厂
│   ├── types.ts              # 类型定义
│   └── adapters/              # 数据库适配器
│       ├── postgresql.ts     # PostgreSQL 适配器
│       ├── mysql.ts          # MySQL 适配器
│       └── interface.ts      # 适配器接口
├── backup/                     # 备份逻辑
│   ├── index.ts              # 备份引擎
│   ├── executor.ts           # 执行器
│   └── copier.ts             # 数据复制器
├── upload/                    # 上传模块
│   ├── index.ts              # 上传工厂
│   └── adapters/             # 存储适配器
│       └── s3.ts             # S3 适配器
└── metadata/                  # 元数据管理
    ├── task.ts               # 任务记录
    └── history.ts            # 备份历史
```

### 3.2 核心接口

```typescript
// 数据库适配器接口
interface DatabaseAdapter {
  readonly type: DatabaseType
  readonly version: string

  // 连接测试
  testConnection(): Promise<boolean>

  // 获取表列表
  listTables(): Promise<string[]>

  // 执行备份
  dump(options: DumpOptions): Promise<Readable>
}

// 备份执行器
interface BackupExecutor {
  execute(task: BackupTask): Promise<BackupResult>
  cancel(taskId: string): Promise<void>
}

// S3 上传适配器
interface StorageAdapter {
  readonly type: string

  upload(data: Readable, key: string): Promise<void>
  download(key: string): Promise<Readable>
  delete(key: string): Promise<void>
  list(prefix?: string): Promise<StorageObject[]>
}
```

### 3.3 执行流程

```
BackupTask 配置
     ↓
配置校验 (validator)
     ↓
创建 DatabaseAdapter (按类型)
     ↓
执行 dump() 获取数据流
     ↓
Stream → 压缩 → 分块
     ↓
上传到 S3 (StorageAdapter)
     ↓
记录元数据 (BackupHistory)
     ↓
返回 BackupResult
```

---

## 4. 调度配置

### 4.1 定时任务

```typescript
interface ScheduleConfig {
  /** Cron 表达式 */
  cron: string
  /** 时区 */
  timezone?: string
  /** 是否启用 */
  enabled?: boolean
}
```

### 4.2 保留策略

```typescript
interface RetentionConfig {
  /** 保留天数 */
  retentionDays: number
  /** 最大备份数量（0 = 无限制）*/
  maxBackups?: number
}
```

---

## 5. 实现计划

### Phase 1: 核心功能 🚧
- [ ] 配置系统（loader + validator）
- [ ] PostgreSQL 适配器
- [ ] S3 上传适配器
- [ ] 备份执行器
- [ ] 基础元数据管理

### Phase 2: 扩展支持
- [ ] MySQL 适配器
- [ ] 调度任务支持
- [ ] 保留策略实现

### Phase 3: 生产化
- [ ] K8s CRD 设计
- [ ] Operator 实现
- [ ] Web UI 管理界面

---

## 6. 测试计划

| 模块 | 测试类型 | 覆盖目标 |
|------|----------|----------|
| config | 单元测试 | loader, validator |
| database/postgresql | 集成测试 | dump, restore |
| upload/s3 | 集成测试 | upload, download |
| backup | 单元测试 | executor, flow |
