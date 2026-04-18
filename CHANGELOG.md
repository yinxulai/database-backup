# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2026-04-18

### Added
- Initial release
- PostgreSQL database backup support using `pg_dump`
- S3-compatible storage destination
- YAML configuration with BackupGroup structure
- Multiple backup groups support
- Kubernetes (Helm) deployment support
- Docker image deployment support
- CLI with `run`, `validate`, `restore` commands
- Retention policy support
- Structured JSON logging
- Unit tests with vitest

### Features
- Support for `passwordSecretRef` for credentials (env/k8s secret types)
- Support for `accessKeySecretRef` and `secretKeySecretRef` for S3 credentials
- Configurable backup schedule via Helm values
- Dry-run mode for validation

[0.1.0]: https://github.com/yinxulai/database-backup/releases/tag/v0.1.0
