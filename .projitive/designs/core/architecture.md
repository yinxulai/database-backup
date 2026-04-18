# Project Architecture

## Mission and Scope

**Purpose**: A database backup tool that dumps PostgreSQL (and future DB types) and uploads to S3-compatible object storage.

**Operational Boundary**: This is a TypeScript library/SDK for programmatic backup execution. It provides:
- `BackupExecutor` - orchestrates the backup pipeline
- `DatabaseAdapter` interface + `PostgreSQLAdapter` - handles database connection and pg_dump
- `S3Adapter` - handles S3-compatible object storage upload

It is **NOT** a scheduled service, CLI tool, or dashboard. The caller (application code, cron job, or CLI wrapper) is responsible for scheduling and persistence of task configuration.

---

## System Boundaries

### Inputs
- `BackupTask` configuration objects (provided at runtime, not stored by this library)
- PostgreSQL connection credentials (via `ConnectionConfig`)
- S3 credentials and endpoint (via `S3Config`)

### Outputs
- SQL dump file uploaded to S3 at `backup/{task.name}/{db}-{database}-{timestamp}.sql`
- `BackupResult` object with status, checksum, fileKey

### External Integrations
| Component | Integration | Boundary |
|-----------|-------------|----------|
| PostgreSQL | `pg_dump` CLI via `child_process` | `PostgreSQLAdapter` |
| S3-compatible storage | AWS SDK v3 (`@aws-sdk/client-s3`) | `S3Adapter` |
| Caller | Import `BackupExecutor` directly | Public API boundary |

### Ownership Boundaries
- **This library owns**: Dump pipeline, adapter interface contracts, memory state
- **Caller owns**: Task persistence, scheduling, credential management, backup history storage

---

## Modules and Responsibilities

### `source/backup/executor.ts` — BackupExecutor
**Responsibility**: Orchestrate the dump → upload pipeline for a given task.

**Public API**:
- `createBackupExecutor(options?)` — factory
- `executor.registerTask(task)` — register a task
- `executor.execute(taskId)` — run a backup
- `executor.getTask(taskId)` — retrieve task config
- `executor.getHistory(taskId)` — get past results
- `executor.setStorage(adapter)` — inject storage adapter

**State**: In-memory `Map<string, BackupTask>` and `Map<string, BackupResult[]>`. Not persisted.

**Key decision**: `createDatabaseAdapter()` is a private factory using `source.type` switch — adding MySQL/MongoDB requires adding a new adapter class and a new case here.

---

### `source/database/adapters/interface.ts` — DatabaseAdapter Contract
**Responsibility**: Define the contract all database adapters must implement.

**Interface**:
```typescript
interface DatabaseAdapter {
  readonly type: DatabaseType
  readonly version: string
  testConnection(): Promise<boolean>
  listTables(): Promise<string[]>
  dump(options: DumpOptions): Promise<Readable>
  close(): Promise<void>
}
```

**Design rationale**: The `Readable` stream return from `dump()` allows backpressure-aware streaming to S3 without buffering entire dump in memory.

---

### `source/database/adapters/postgresql.ts` — PostgreSQLAdapter
**Responsibility**: Implement `DatabaseAdapter` for PostgreSQL using `pg_dump`.

**Key implementation detail**: Uses `node:child_process` + `pg_dump` CLI. The `dump()` method spawns `pg_dump` and returns its stdout as a `Readable` stream.

**Current status**: Stub implementation — returns empty `Readable`. Full implementation needs:
```typescript
const pgDump = spawn('pg_dump', args, { env: { ...process.env, PGPASSWORD: password } })
return pgDump.stdout
```

---

### `source/upload/adapters/s3.ts` — S3Adapter
**Responsibility**: Implement `StorageAdapter` for S3-compatible object storage.

**Interface**:
```typescript
interface StorageAdapter {
  readonly type: string
  readonly config: S3Config
  upload(data: Readable, key: string, options?): Promise<void>
  download(key: string): Promise<Readable>
  delete(key: string): Promise<void>
  list(prefix?: string): Promise<StorageObject[]>
}
```

**Key implementation detail**: `upload()` pipes the `Readable` from `dump()` directly to S3 `Upload` command, supporting streamed multi-part upload without full file buffering.

**Current status**: Stub — logs to console. Full implementation needs `@aws-sdk/client-s3` and `@aws-sdk/lib-storage`.

---

### `source/config/types.ts` — Configuration Types
**Responsibility**: Shared type definitions for task configuration, connection configs, and result types.

**Key types**: `BackupTask`, `BackupSource`, `BackupDestination`, `BackupResult`, `ScheduleConfig`, `RetentionConfig`.

---

## Key Flows

### Backup Execution Flow

```
Caller
  │
  │ createBackupExecutor({ tasks: [...] })
  ▼
BackupExecutor (in-memory task map)
  │
  │ execute("task-1")
  ▼
1. Lookup task-1 from Map
   └── Throw if not found
  │
  ▼
2. createDatabaseAdapter(source)
   └── Switch on source.type → PostgreSQLAdapter(connection)
  │
  ▼
3. createS3Adapter(destination.s3)
   └── new S3Adapter(config)
  │
  ▼
4. dbAdapter.dump({
       tables: source.tables,
       rowsLimit: source.rowsLimit,
       compression: destination.compression,
     })
   └── Returns Readable stream from pg_dump
  │
  ▼
5. Generate fileKey:
     "backup/{task.name}/{type}-{database}-{ISO-timestamp}.sql"
  │
  ▼
6. storage.upload(dumpStream, fileKey)
   └── Streams dump directly to S3
  │
  ▼
7. Record BackupResult (status=completed, fileKey, checksum)
   └── Append to results Map[taskId]
  │
  ▼
8. dbAdapter.close()
  │
  ▼
Return BackupResult to caller
```

### Adapter Extension Flow (Adding MySQL Support)

```
1. Create source/database/adapters/mysql.ts
   └── implements DatabaseAdapter, type='mysql'
2. Add case to BackupExecutor.createDatabaseAdapter():
     case 'mysql': return createMySQLAdapter(source.connection)
3. Export createMySQLAdapter from source/database/index.ts
4. Caller can now use tasks with source.type: 'mysql'
```

---

## Change Triggers

Update this document when:
- Adding or removing a module (new adapter, new storage backend)
- Changing the data flow (e.g., adding intermediate processing)
- Changing integration contracts (e.g., `DumpOptions` fields)
- Adding new `DatabaseType` support (MySQL, MongoDB, Redis)

---

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| Factory pattern for adapters | Decoupled — adding new DB types doesn't require modifying `BackupExecutor` core logic |
| `Readable` stream from `dump()` | Backpressure support — S3 upload streams data without full in-memory buffering |
| In-memory task state | Library pattern — caller controls persistence, scheduling, and deployment model |
| No built-in retry | Keep library simple — caller can implement retry logic around `execute()` |
| No built-in scheduler | Out of scope — use cron, systemd timer, or cloud scheduler outside this library |
