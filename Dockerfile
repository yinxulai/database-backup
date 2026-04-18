# syntax=docker/dockerfile:1

ARG VERSION=dev
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-slim AS builder
WORKDIR /app

COPY package.json pnpm-lock.yaml tsconfig.json ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY source ./source
COPY configs ./configs
RUN pnpm build && pnpm prune --prod

FROM postgres:16-bookworm AS production
ARG VERSION=dev

LABEL org.opencontainers.image.title="database-backup"
LABEL org.opencontainers.image.description="Multi-mode database backup tool"
LABEL org.opencontainers.image.source="https://github.com/yinxulai/database-backup"
LABEL org.opencontainers.image.version="${VERSION}"

WORKDIR /app

COPY --from=builder /usr/local /usr/local
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/output ./output
COPY --from=builder /app/configs ./configs

RUN apt-get update && apt-get install -y --no-install-recommends \
    dumb-init \
    gzip \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --create-home --uid 1000 --shell /usr/sbin/nologin appuser \
  && mkdir -p /home/appuser/.cache \
  && chown -R appuser:appuser /app /home/appuser

ENV HOME=/home/appuser \
    XDG_CACHE_HOME=/home/appuser/.cache

USER appuser

ENTRYPOINT ["dumb-init", "--", "node", "output/run.js"]
CMD ["help"]
