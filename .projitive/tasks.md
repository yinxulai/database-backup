# Tasks

## Implementation Phase 1: Core Foundation

### TASK-PH1-001 | TODO | 初始化项目结构和依赖
- summary: 创建目录结构，配置 package.json、tsconfig.json，构建脚本
- owner: 
- roadmapRefs: ROADMAP-PH1
- links:
  - .projitive/designs/core/architecture-design.md
  - .projitive/designs/core/build-deploy-design.md

### TASK-PH1-002 | TODO | 实现核心类型定义
- summary: 实现 BackupGroup、BackupSource、BackupDestination、SecretRef、ScheduleConfig 等核心类型
- owner: 
- roadmapRefs: ROADMAP-PH1
- links:
  - source/core/types.ts

### TASK-PH1-003 | TODO | 实现核心接口定义
- summary: 实现 SecretResolver、DatabaseDriver、StorageDriver、BackupExecutor、ConfigScanner、ResultStore 接口
- owner: 
- roadmapRefs: ROADMAP-PH1
- links:
  - source/core/interfaces.ts

### TASK-PH1-004 | TODO | 实现 ConfigScanner 配置扫描器
- summary: 实现 YAML 配置文件的扫描和解析
- owner: 
- roadmapRefs: ROADMAP-PH1
- links:
  - source/core/scanner.ts

### TASK-PH1-005 | TODO | 实现 SecretResolver 密钥解析器
- summary: 实现 EnvSecretResolver，支持 env 和 k8s-secret 两种类型
- owner: 
- roadmapRefs: ROADMAP-PH1
- links:
  - source/adapters/secret/env.ts

### TASK-PH1-006 | TODO | 实现 PostgreSQL DatabaseDriver
- summary: 实现 PostgreSQL 适配器，支持 pg_dump 备份
- owner: 
- roadmapRefs: ROADMAP-PH1
- links:
  - source/adapters/database/postgresql.ts

### TASK-PH1-007 | TODO | 实现 S3 StorageDriver
- summary: 实现 S3 存储适配器，支持上传到 S3
- owner: 
- roadmapRefs: ROADMAP-PH1
- links:
  - source/adapters/storage/s3.ts

### TASK-PH1-008 | TODO | 实现 BackupExecutor 备份执行器
- summary: 实现核心备份执行器，协调扫描、dump、压缩、上传流程
- owner: 
- roadmapRefs: ROADMAP-PH1
- links:
  - source/core/executor.ts

### TASK-PH1-009 | TODO | 实现 CLI 入口
- summary: 实现 CLI 入口，支持 run、init、validate 命令
- owner: 
- roadmapRefs: ROADMAP-PH1
- links:
  - source/cli/run.ts

### TASK-PH1-010 | TODO | 配置 SEA 构建
- summary: 配置 SEA 构建流程，输出单个二进制文件
- owner: 
- roadmapRefs: ROADMAP-PH1
- links:
  - scripts/build-sea.mjs

### TASK-PH1-011 | TODO | 端到端测试
- summary: 编写端到端测试，验证完整备份流程
- owner: 
- roadmapRefs: ROADMAP-PH1
- links:
  - tests/e2e/
