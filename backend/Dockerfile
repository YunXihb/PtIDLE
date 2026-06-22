# =============================================================================
# PtIDLE Backend Dockerfile
# =============================================================================
# 多阶段 build:
#   - builder: 装全量 deps + 跑 tsc 产 dist/
#   - runtime: 装 prod deps + copy dist/ + USER node + CMD node
#
# 镜像构建:
#   docker build -t ptidle-backend:dev -f backend/Dockerfile backend/
#   docker run -p 3000:3000 ptidle-backend:dev
#
# 生产使用 (GHCR):
#   docker pull ghcr.io/yunxihb/ptidle-backend:latest
#   docker run -p 3000:3000 \
#     -e DB_HOST=postgres -e DB_PORT=5432 \
#     -e REDIS_HOST=redis -e REDIS_PORT=6379 \
#     -e JWT_SECRET=... \
#     ghcr.io/yunxihb/ptidle-backend:latest
#
# 注意: 容器内**不**自动跑 db:migrate, 需在外部/docker-compose migrate service
#       /一次性手动跑. SQL 文件在 /app/migrations/ (env MIGRATIONS_DIR 可覆盖)
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Builder (含 TypeScript compiler)
# -----------------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# 1. 先 copy package.json 单独一层装依赖, 改 package.json 才重装 (Docker layer cache)
COPY package*.json ./
COPY tsconfig.json ./

# ci 精确版本 (production 等同 lockfile)
RUN npm ci --no-audit --no-fund

# 2. copy 源码 + 编译
COPY src/ ./src/
RUN npm run build

# -----------------------------------------------------------------------------
# Stage 2: Runtime (只含 prod deps + compiled JS, 没有 tsc / dev deps)
# -----------------------------------------------------------------------------
FROM node:20-alpine AS runtime

WORKDIR /app

# 镜像 metadata
LABEL org.opencontainers.image.title="ptidle-backend" \
      org.opencontainers.image.description="PtIDLE game backend (Express + Socket.IO + TypeScript)" \
      org.opencontainers.image.source="https://github.com/YunXihb/PtIDLE" \
      org.opencontainers.image.licenses="UNLICENSED"

# 1. 装 prod deps (devDependencies 不需要)
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund && \
    npm cache clean --force

# 2. copy 编译产物 (来自 builder stage)
COPY --from=builder /app/dist ./dist

# 3. copy migrations SQL (T-FOLLOW-5: prod image 跑 migrate 需要)
COPY src/migrations /app/migrations

# 4. copy migrate.js (纯 JS, tsc 不编译 .js, 需手动 copy, T-FOLLOW-5)
COPY src/scripts/migrate.js /app/dist/scripts/migrate.js

# 5. 健康检查 — 调 GET /health, 30s 间隔, 启动 30s 宽限, 失败 3 次标记 unhealthy
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+process.env.PORT+'/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# 6. 端口 + 用户 (不跑 root, 减少攻击面)
EXPOSE 3000
USER node

# 7. 启动命令 (从 package.json "main": "dist/index.js")
CMD ["node", "dist/index.js"]
