# syntax=docker/dockerfile:1

# ============================================================================
# Stage 1: Dependencies
# Installs the full dependency tree (production + development) with optimal
# layer caching based on the manifest and lockfile only.
# ============================================================================
FROM oven/bun:1-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# ============================================================================
# Stage 2: Builder
# Compiles the three build targets:
#   - React 19 Studio Panel            -> dist/client
#   - Telegram Mini App shell          -> dist/client-tma
#   - NestJS TypeScript backend        -> dist/server
# ============================================================================
FROM deps AS builder
WORKDIR /app
COPY . .
ENV NODE_ENV=development
RUN bun run build

# ============================================================================
# Stage 3: Runner (Production)
# Minimal Alpine image containing only production dependencies and compiled
# artifacts. Runs as the non-root `bun` user with a persistent data directory
# and a native HEALTHCHECK against /api/health.
# ============================================================================
FROM oven/bun:1-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data \
    DB_PATH=/app/data/studio.sqlite

COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

COPY --from=builder /app/dist ./dist

# Versioned migrations + the Prisma CLI (schema engine) so the container can
# apply pending migrations on boot before the server starts.
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

RUN mkdir -p /app/data \
    && chown -R bun:bun /app/data \
    && chown -R bun:bun /app/node_modules

USER bun

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1

# Bun forwards SIGTERM/SIGINT to the process so NestJS shutdown hooks run and
# every active grammY bot in the pool is stopped cleanly. Pending versioned
# migrations are applied before boot (safe to re-run: deploy is idempotent).
CMD ["sh", "-c", "bun node_modules/prisma/build/index.js migrate deploy && bun dist/server/main.js"]
