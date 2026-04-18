# syntax=docker/dockerfile:1

ARG VERSION=dev
ARG NODE_VERSION=22

# Build stage
FROM node:${NODE_VERSION}-slim AS builder

WORKDIR /app

# Install dependencies
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

# Copy source
COPY . .

# Production stage
FROM postgres:16-bookworm AS production
ARG VERSION=dev

# Copy Node.js runtime from the builder image
COPY --from=builder /usr/local /usr/local

LABEL org.opencontainers.image.title="database-backup"
LABEL org.opencontainers.image.description="Multi-mode database backup tool"
LABEL org.opencontainers.image.source="https://github.com/yinxulai/database-backup"
LABEL org.opencontainers.image.version="${VERSION}"

WORKDIR /app

# Install runtime dependencies. Keep tsx available because the container runs TypeScript directly.
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

# Install supporting runtime tools. PostgreSQL CLI tools come from the base image.
RUN apt-get update && apt-get install -y --no-install-recommends \
    dumb-init \
    gzip \
  && rm -rf /var/lib/apt/lists/*

# Create non-root user safely even if uid/gid 1000 already exists in the base image
RUN if ! getent group appgroup >/dev/null; then groupadd --system appgroup; fi && \
    if ! id -u appuser >/dev/null 2>&1; then useradd --system --gid appgroup --shell /usr/sbin/nologin --create-home appuser; fi

# Copy source code and TypeScript config needed by tsx path resolution
COPY --from=builder /app/source ./source
COPY --from=builder /app/configs ./configs
COPY --from=builder /app/tsconfig.json ./tsconfig.json
RUN chown -R appuser:appgroup /app

# Switch to non-root user
USER appuser

ENTRYPOINT ["dumb-init", "--", "npx", "tsx", "source/cli/run.ts"]

# Default to help; users can override with commands like: run --config /config/backup.yaml
CMD ["help"]
