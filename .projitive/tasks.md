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

## Feature: Observability

### TASK-PH2-001 | TODO | 实现结构化 JSON 日志
- summary: 实现 JSON 结构化日志输出，支持日志级别（debug/info/warn/error）、requestId、timestamp、duration 等字段
- priority: high
- owner: 
- roadmapRefs: ROADMAP-PH2
- labels:
  - observability
  - logging
- links:
  - source/core/logger.ts

### TASK-PH2-002 | TODO | 实现 Prometheus Metrics 上报
- summary: 实现 Prometheus 指标上报，支持备份成功/失败/耗时/大小等指标
- priority: medium
- owner: 
- roadmapRefs: ROADMAP-PH2
- labels:
  - observability
  - metrics
- links:
  - source/core/metrics.ts

### TASK-PH2-003 | TODO | 实现健康检查接口
- summary: 实现 /health 端点，支持 liveness 和 readiness probe
- priority: medium
- owner: 
- roadmapRefs: ROADMAP-PH2
- labels:
  - observability
  - health
- links:
  - source/cli/run.ts

## Feature: Restore

### TASK-PH2-004 | TODO | 实现备份恢复功能
- summary: 实现 pg_restore 备份恢复，支持指定时间点恢复
- priority: high
- owner: 
- roadmapRefs: ROADMAP-PH2
- labels:
  - restore
  - core
- links:
  - source/adapters/database/postgresql.ts
  - source/core/executor.ts

### TASK-PH2-005 | TODO | 实现备份验证
- summary: 实现备份上传前的 dry-run 验证，确保 dump 可读
- priority: medium
- owner: 
- roadmapRefs: ROADMAP-PH2
- labels:
  - backup
  - validation
- links:
  - source/adapters/database/postgresql.ts

## Feature: Retention

### TASK-PH2-006 | TODO | 实现备份保留策略
- summary: 实现基于时间和数量的备份保留策略，自动清理过期备份
- priority: medium
- owner: 
- roadmapRefs: ROADMAP-PH2
- labels:
  - retention
  - storage
- links:
  - source/adapters/storage/s3.ts
