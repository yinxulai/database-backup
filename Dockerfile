# syntax=docker/dockerfile:1

ARG VERSION=dev
ARG NODE_VERSION=22-slim

# Build stage
FROM node:${NODE_VERSION} AS builder

WORKDIR /app

# Install dependencies
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

# Copy source
COPY . .

# Production stage
FROM node:${NODE_VERSION}-slim AS production

LABEL org.opencontainers.image.title="database-backup"
LABEL org.opencontainers.image.description="Multi-mode database backup tool"
LABEL org.opencontainers.image.source="https://github.com/${github.repository}"
LABEL org.opencontainers.image.version="${VERSION}"

WORKDIR /app

# Install dependencies and tsx for running TypeScript directly
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod

# Install dumb-init for proper signal handling
RUN apt-get update && apt-get install -y --no-install-recommends dumb-init && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd --gid 1000 appgroup && \
    useradd --uid 1000 --gid appgroup --shell /bin/false --create-home appuser

# Copy source code
COPY --from=builder /app/source ./source
COPY --from=builder /app/configs ./configs

# Switch to non-root user
USER appuser

# Run directly with tsx (no build step needed)
CMD ["pnpm", "backup", "--", "--help"]
