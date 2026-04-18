# syntax=docker/dockerfile:1

ARG VERSION=dev
ARG NODE_VERSION=22-slim

# Build stage
FROM node:${NODE_VERSION} AS builder

WORKDIR /app

# Install dependencies
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

# Copy source and build
COPY . .
RUN pnpm build

# SEA binary build (if available)
RUN pnpm build:sea || true

# Production stage
FROM node:${NODE_VERSION}-slim AS production

LABEL org.opencontainers.image.title="database-backup"
LABEL org.opencontainers.image.description="Multi-mode database backup tool"
LABEL org.opencontainers.image.source="https://github.com/${{ github.repository }}"
LABEL org.opencontainers.image.version="${VERSION}"

WORKDIR /app

# Install dumb-init for proper signal handling
RUN apt-get update && apt-get install -y --no-install-recommends dumb-init && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd --gid 1000 appgroup && \
    useradd --uid 1000 --gid appgroup --shell /bin/false --create-home appuser

# Copy built artifacts
COPY --from=builder /app/output ./output
COPY --from=builder /app/out ./out
COPY --from=builder /app/configs ./configs

# Copy SEA binary if built
COPY --from=builder /app/out/backup-* ./backup 2>/dev/null || true

# Switch to non-root user
USER appuser

# Default command - show help
CMD ["node", "output/cli/run.js", "--help"]

# Alternative: run SEA binary directly
# CMD ["./backup", "--help"]
