# Database Backup 构建与部署指南

> Version: 0.3.0
> Status: Draft
> Last Updated: 2026-04-18

---

## 1. 构建目标

**主要构建产物：SEA 单二进制文件**

```
SEA = Node.js 运行时 + 编译后的 JS 代码 + 资源文件
     ↓
db-backup (单个可执行文件)
```

---

## 2. 构建流程

### 2.1 构建流程图

```
┌─────────────────────────────────────────────────────────────┐
│  source/  (TypeScript 源码)                                  │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 1: TypeScript 编译                                     │
│  $ tsc -p tsconfig.json                                     │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  dist/  (JavaScript + 类型声明)                              │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 2: 生成 SEA 配置                                       │
│  $ node scripts/generate-sea-config.mjs                      │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  sea/  (sea.sh + blob 文件)                                  │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 3: 构建 SEA 二进制                                      │
│  $ node --experimental-sea-config sea/sea.sh                 │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  out/                                                     │
│  └── db-backup (Linux x64 二进制)                            │
│  └── db-backup.exe (Windows)                                │
│  └── db-backup-macos (macOS)                                │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 构建命令

```bash
# 开发构建（快速）
pnpm build:dev

# 生产构建（SEA）
pnpm build

# 构建并验证
pnpm build:check

# 清理构建产物
pnpm clean
```

---

## 3. 项目结构

### 3.1 目录结构

```
database-backup/
├── source/                    # TypeScript 源码
│   ├── cli/                   # CLI 命令
│   │   ├── index.ts
│   │   └── commands/
│   │       ├── run.ts
│   │       ├── history.ts
│   │       └── init.ts
│   ├── core/                  # CI 核心
│   │   ├── scanner.ts
│   │   ├── loader.ts
│   │   ├── executor.ts
│   │   └── types.ts
│   ├── adapters/              # 适配器
│   │   ├── database/
│   │   ├── storage/
│   │   └── secret/
│   └── k8s/                   # K8s Operator
│
├── dist/                      # 编译产物（不提交）
│
├── sea/                       # SEA 配置（不提交）
│   ├── sea.sh                 # SEA shell script
│   └── *.blob                 # Snapshot blob
│
├── scripts/                   # 构建脚本
│   ├── generate-sea-config.mjs
│   └── build-sea.mjs
│
├── out/                       # SEA 输出（不提交）
│   └── db-backup
│
├── package.json
├── tsconfig.json
└── tsconfig-sea.json         # SEA 专用 TS 配置
```

### 3.2 不提交到 Git 的文件

```
.gitignore:
  dist/
  sea/
  out/
  node_modules/
  *.log
```

---

## 4. 配置详情

### 4.1 package.json

```json
{
  "name": "@taicode/db-backup",
  "version": "0.1.0",
  "description": "Multi-mode database backup tool with CI-first architecture",
  "type": "module",
  "exports": {
    ".": "./dist/index.js",
    "./cli": "./dist/cli/index.js"
  },
  "bin": {
    "db-backup": "./out/db-backup"
  },
  "files": [
    "out/"
  ],
  "scripts": {
    "typecheck": "tsc --noEmit",
    "build:dev": "tsc -p tsconfig.json",
    "build": "pnpm build:dev && pnpm build:sea",
    "build:sea": "node scripts/build-sea.mjs",
    "build:check": "pnpm build && ./out/db-backup --version",
    "clean": "rm -rf dist sea out",
    "test": "vitest"
  },
  "engines": {
    "node": ">=22.0.0"
  }
}
```

### 4.2 tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./source",
    "declaration": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["source/**/*"],
  "exclude": ["node_modules", "dist", "sea", "out"]
}
```

### 4.3 SEA 构建脚本 (scripts/build-sea.mjs)

```javascript
import { writeFileSync, mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'

const OUT_DIR = './out'
const SEA_DIR = './sea'

// Step 1: Ensure output directory exists
mkdirSync(OUT_DIR, { recursive: true })

// Step 2: Generate sea.sh
const seaShContent = `#! /usr/bin/env node
// 👆 Above shebang is required for SEA to work

import { appendFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// This is the bootstrap script that runs before the snapshot
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

// Add snapshot blob as a data URL
const snapshotBlob = path.join(__dirname, 'snapshot.blob')
appendFileSync(snapshotBlob, '')

// The main entry point
import './dist/cli/index.js'
`

writeFileSync(`${SEA_DIR}/sea.sh`, seaShContent)

// Step 3: Build SEA
execSync(`node --experimental-sea-config ${SEA_DIR}/sea.sh`, {
  stdio: 'inherit'
})

console.log('✅ SEA binary built at out/db-backup')
```

---

## 5. CLI 使用

### 5.1 全局安装（通过 SEA）

```bash
# 下载 SEA 二进制
curl -L https://github.com/taicode-labs/db-backup/releases/latest/download/db-backup -o db-backup
chmod +x db-backup

# 全局安装
sudo mv db-backup /usr/local/bin/

# 使用
db-backup --version
db-backup run --config backup.yaml
```

### 5.2 直接运行

```bash
# Linux/macOS
./out/db-backup run --config backup.yaml

# Windows
./out/db-backup.exe run --config backup.yaml
```

### 5.3 Docker 中的使用

```dockerfile
# 方式 1: 使用 SEA 二进制（极简镜像）
FROM scratch
COPY out/db-backup /usr/local/bin/db-backup
ENTRYPOINT ["/usr/local/bin/db-backup"]

# 方式 2: 使用 Node.js 镜像（开发调试）
FROM node:22-alpine
COPY out/db-backup /usr/local/bin/db-backup
ENTRYPOINT ["/usr/local/bin/db-backup"]
```

---

## 6. 发布流程

### 6.1 GitHub Releases

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  build-sea:
    strategy:
      matrix:
        include:
          - os: ubuntu-latest
            target: linux-x64
            artifact: db-backup
          - os: windows-latest
            target: win-x64
            artifact: db-backup.exe
          - os: macos-latest
            target: darwin-x64
            artifact: db-backup-macos

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'

      - run: pnpm install

      - run: pnpm build

      - name: Upload Release Asset
        uses: softprops/action-gh-release@v1
        with:
          files: out/${{ matrix.artifact }}
```

### 6.2 发布命令

```bash
# 1. 更新版本
pnpm version patch  # 或 minor, major

# 2. 推送标签
git push origin v0.1.0

# 3. GitHub Actions 自动构建并发布
```

---

## 7. 实现计划

### Phase 1: CI Core + SEA 构建 ✅ (设计阶段)
- [x] 架构设计
- [ ] TypeScript 源码实现
- [ ] SEA 构建流程
- [ ] CLI 基本命令

### Phase 2: Docker 镜像
- [ ] Dockerfile 构建
- [ ] 多架构支持 (amd64, arm64)
- [ ] 镜像发布到 GHCR

### Phase 3: K8s Operator
- [ ] CRD 定义
- [ ] Controller 实现
- [ ] Helm Chart

---

## 8. 技术选型

| 组件 | 选择 | 理由 |
|------|------|------|
| **运行时** | Node.js 22+ | 原生支持 SEA |
| **语言** | TypeScript | 类型安全，Node 22 原生支持 |
| **构建** | SEA (Single Executable Applications) | 单二进制分发 |
| **CLI** | 自己实现 | 轻量，无需额外依赖 |
| **S3 SDK** | @aws-sdk/client-s3 | AWS 官方 |
| **YAML** | yaml | 支持 YAML 1.2 |
| **测试** | vitest | 快速，类型友好 |
