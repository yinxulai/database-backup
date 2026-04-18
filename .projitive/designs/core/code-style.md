---
applyTo: "**"
---

# Code Style Guide - Database Backup

---

## 1. Core Principles

- **Type Safety** - All TypeScript must be strictly typed
- **Error Handling** - All async operations must be wrapped in try/catch
- **Clean Separation** - Database adapters, storage adapters, backup logic must be separate
- **Testability** - All core logic must be mockable

---

## 2. File Naming

| Type | Convention | Example |
|------|------------|---------|
| Source files | `kebab-case.ts` | `backup-executor.ts` |
| Adapter files | `kebab-case.ts` | `postgresql.ts` |
| Test files | `*.test.ts` | `executor.test.ts` |
| Type files | `types.ts` | `database/types.ts` |

---

## 3. Directory Structure

```
source/
├── index.ts                    # Entry point, exports all public APIs
├── config/                      # Configuration
│   └── types.ts                # Config interfaces
├── database/                   # Database abstraction
│   ├── index.ts               # Factory exports
│   ├── types.ts               # Shared types
│   └── adapters/              # Database-specific implementations
│       ├── interface.ts       # Adapter interface
│       └── postgresql.ts     # PostgreSQL implementation
├── backup/                    # Core backup logic
│   ├── executor.ts            # Main backup executor
│   └── index.ts
├── upload/                    # Storage upload
│   ├── index.ts
│   └── adapters/
│       └── s3.ts             # S3 implementation
└── metadata/                 # Backup history tracking
```

---

## 4. Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Classes | PascalCase | `BackupExecutor` |
| Interfaces | PascalCase | `DatabaseAdapter` |
| Functions | camelCase | `createS3Adapter` |
| Variables | camelCase | `backupTask` |
| Constants | SCREAMING_SNAKE_CASE | `MAX_RETRIES` |
| Types | PascalCase | `DatabaseType` |

---

## 5. Import Order

```typescript
// 1. Node.js built-ins
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'

// 2. External packages
import { AwsClient } from 'some-aws-client'

// 3. Internal modules (relative)
import type { DatabaseAdapter } from './adapters/interface.js'
import { PostgreSQLAdapter } from './adapters/postgresql.js'

// 4. Config and types
import type { BackupTask } from '../config/types.js'
```

---

## 6. Error Handling

```typescript
// ✅ Correct - explicit error handling
async function dump(options: DumpOptions): Promise<Readable> {
  try {
    const result = await execAsync(`pg_dump ${args}`)
    return result.stdout
  } catch (err) {
    throw new Error(`Failed to dump database: ${err instanceof Error ? err.message : err}`)
  }
}

// ❌ Wrong - swallowing errors
async function dump() {
  try {
    // ...
  } catch {
    // silent failure
  }
}
```

---

## 7. Async/Await Patterns

```typescript
// ✅ Correct - await all independent operations
async function backup(task: BackupTask): Promise<BackupResult> {
  const [connection, storage] = await Promise.all([
    connect(task.source),
    createStorage(task.destination),
  ])
  // ...
}

// ✅ Correct - sequential when order matters
async function backup(task: BackupTask): Promise<BackupResult> {
  const connection = await connect(task.source)
  const dumpStream = await connection.dump(task.tables)
  await storage.upload(dumpStream)
}
```

---

## 8. Test Patterns

```typescript
describe('BackupExecutor', () => {
  it('should execute backup successfully', async () => {
    const executor = createBackupExecutor()
    const result = await executor.execute('task-1')
    expect(result.status).toBe('completed')
  })

  it('should throw when task not found', async () => {
    const executor = createBackupExecutor()
    await expect(executor.execute('non-existent')).rejects.toThrow('Task not found')
  })
})
```

---

## 9. Documentation

All exported functions must have JSDoc:

```typescript
/**
 * Creates a new backup executor instance.
 * 
 * @param options - Executor configuration options
 * @returns A configured BackupExecutor instance
 */
export function createBackupExecutor(options?: CreateBackupExecutorOptions): BackupExecutor {
  return new BackupExecutor(options)
}
```

---

## 10. Verification Commands

```bash
# Lint
pnpm lint

# Type check
pnpm typecheck

# Run tests
pnpm test

# Build
pnpm build
```
