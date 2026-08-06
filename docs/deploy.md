# PtIDLE 后端部署指南 (Deploy Guide)

**项目**：PtIDLE - 战棋挂机游戏
**版本**：v1.0
**日期**：2026-06-22
**适用**：PtIDLE Backend v1.0.0+

---

## 一、概述

PtIDLE 后端使用 Docker 镜像分发，托管在 GitHub Container Registry (GHCR)。本指南涵盖：

- 拉取预构建镜像
- 必需的环境变量
- 启动顺序（重要：先迁移再启动）
- 两种部署方式：`docker run`（单机/简单）vs `docker-compose`（推荐/多服务）
- 健康检查
- 镜像 tag 策略

> **不包含**：CD 编排平台（k8s/ECS/Terraform）—— 项目尚未选定编排平台，留待后续 T-FOLLOW-5 决定。

---

## 二、镜像 (Image)

### 2.1 镜像位置

```
ghcr.io/yunxihb/ptidle-backend
```

### 2.2 可用 tag

| Tag | 触发条件 | 用途 |
|---|---|---|
| `latest` | tag push vX.Y.Z (stable) | 生产部署默认 |
| `X.Y.Z` | tag push vX.Y.Z (stable) | 锁定稳定版本 |
| `X.Y` | tag push vX.Y.Z (stable) | 自动跟 minor 升级 |
| `X.Y.Z-rcN` | tag push vX.Y.Z-rcN | 预发布测试 |
| `sha-abc1234` | 每次构建 | 精确回滚到某次提交 |
| `dev`, `custom` | workflow_dispatch input | 手动测试/调试 |

> 镜像多架构同时支持 `linux/amd64` + `linux/arm64`（Apple Silicon、ARM 服务器直接拉）。

### 2.3 拉取镜像

```bash
# 拉取最新稳定版
docker pull ghcr.io/yunxihb/ptidle-backend:latest

# 拉取指定版本
docker pull ghcr.io/yunxihb/ptidle-backend:1.0.0

# 拉取精确 commit（回滚用）
docker pull ghcr.io/yunxihb/ptidle-backend:abc1234
```

> GitHub Container Registry 对 public 镜像免登录，private 镜像需要 `docker login ghcr.io`。

---

## 三、必需环境变量

容器启动**至少**需要以下环境变量（其余走 `.env` 默认值或可选）：

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `DB_HOST` | ✅ | `localhost` | PostgreSQL 主机名/IP |
| `DB_PORT` | ✅ | `5432` | PostgreSQL 端口 |
| `DB_NAME` | ✅ | `ptidle` | 数据库名 |
| `DB_USER` | ✅ | `postgres` | 数据库用户 |
| `DB_PASSWORD` | ✅ | — | 数据库密码（**绝不**用默认占位符） |
| `REDIS_HOST` | ✅ | `localhost` | Redis 主机名/IP |
| `REDIS_PORT` | ✅ | `6379` | Redis 端口 |
| `JWT_SECRET` | ✅ | — | JWT 签名密钥（**至少 32 字符随机串**） |
| `JWT_EXPIRES_IN` | ❌ | `7d` | Token 过期时间 |
| `PORT` | ❌ | `3000` | HTTP+WS 监听端口 |
| `NODE_ENV` | ❌ | `production` | 运行环境 |

> **安全警告**：
> - `JWT_SECRET` 必须是强随机串。生成方式：`openssl rand -base64 48`
> - `DB_PASSWORD` 不要用 `your_password` 这类占位符（来自 `docker-compose.yml` 仅供本地 dev）
> - 生产环境推荐用 secret 管理（Docker secrets / k8s Secret / Vault 等），不要明文写进 compose

---

## 四、启动顺序（重要）

PtIDLE 后端镜像**不**自动跑 migrations。**必须**在容器启动前先应用数据库迁移，否则服务会因 schema 缺失无法正常工作。

### 启动顺序

```
1. 启动 PostgreSQL + Redis（外部服务或独立容器）
2. 应用 migrations（npm run db:migrate 或 ts-node src/scripts/migrate.ts）
3. 启动 backend 容器
```

### Migrations 一次性执行

```bash
# 方式 A: 用 dev 仓库 + Node 工具链（推荐 - 可控）
git clone https://github.com/YunXihb/PtIDLE.git
cd PtIDLE/backend
npm ci
DB_HOST=your-pg-host \
DB_PORT=5432 \
DB_NAME=ptidle \
DB_USER=postgres \
DB_PASSWORD=your-pg-password \
npm run db:migrate
```

```bash
# 方式 B: 在 backend 容器内一次性跑迁移（不推荐，污染 prod 镜像）
docker run --rm -it \
  -e DB_HOST=postgres -e DB_PORT=5432 \
  -e DB_NAME=ptidle -e DB_USER=postgres -e DB_PASSWORD=... \
  -v $(pwd):/app -w /app \
  --entrypoint npm \
  ghcr.io/yunxihb/ptidle-backend:latest \
  run db:migrate
```

> 方式 B 跑通后会污染 prod 镜像（用 dev deps），不推荐。生产环境应使用 init container、CI/CD pipeline job 或手动 kubectl exec 等机制应用 migrations。

### Idempotency

`npm run db:migrate` 是幂等的：
- 跟踪表 `schema_migrations` 记录已应用的 migration 文件
- 重复跑 → 自动 skip 已应用项
- 失败时 `process.exit(1)` → CI/CD 友好

---

## 五、部署方式

### 5.1 单机部署（`docker run`）

适用：单机 VPS、单实例开发、staging 环境。

```bash
docker run -d \
  --name ptidle-backend \
  --restart unless-stopped \
  -p 3000:3000 \
  \
  -e DB_HOST=postgres.example.com \
  -e DB_PORT=5432 \
  -e DB_NAME=ptidle \
  -e DB_USER=ptidle \
  -e DB_PASSWORD='YOUR_SECURE_PASSWORD' \
  \
  -e REDIS_HOST=redis.example.com \
  -e REDIS_PORT=6379 \
  \
  -e JWT_SECRET='YOUR_RANDOM_48_BYTE_BASE64' \
  -e NODE_ENV=production \
  \
  ghcr.io/yunxihb/ptidle-backend:latest
```

**验证**：

```bash
# 查看启动日志
docker logs ptidle-backend

# 健康检查（应返回 200 + JSON）
curl -s http://localhost:3000/health
# 预期: {"status":"ok","timestamp":"...","services":{...}}
```

**更新镜像**：

```bash
docker pull ghcr.io/yunxihb/ptidle-backend:latest
docker stop ptidle-backend
docker rm ptidle-backend
# 重新跑上面的 docker run 命令
```

### 5.2 多服务部署（`docker-compose`）

适用：单机多容器、本地完整栈、统一编排。

创建 `docker-compose.prod.yml`：

```yaml
services:
  postgres:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_DB: ptidle
      POSTGRES_USER: ptidle
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ptidle -d ptidle"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  # 一次性跑 migrations - 跑完自动退出
  migrate:
    image: node:20-alpine
    depends_on:
      postgres:
        condition: service_healthy
    working_dir: /app
    volumes:
      - ./backend:/app
    environment:
      DB_HOST: postgres
      DB_PORT: 5432
      DB_NAME: ptidle
      DB_USER: ptidle
      DB_PASSWORD: ${DB_PASSWORD}
    command: sh -c "npm ci && npx ts-node src/scripts/migrate.ts"
    restart: 'no'  # 跑完不再重启

  backend:
    image: ghcr.io/yunxihb/ptidle-backend:latest
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      migrate:
        condition: service_completed_successfully
    ports:
      - "3000:3000"
    environment:
      DB_HOST: postgres
      DB_PORT: 5432
      DB_NAME: ptidle
      DB_USER: ptidle
      DB_PASSWORD: ${DB_PASSWORD}
      REDIS_HOST: redis
      REDIS_PORT: 6379
      JWT_SECRET: ${JWT_SECRET}
      NODE_ENV: production
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://127.0.0.1:3000/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"]
      interval: 30s
      timeout: 5s
      start_period: 30s
      retries: 3

volumes:
  pgdata:
```

配套 `.env.prod`（**不要 commit**）：

```bash
DB_PASSWORD=your_secure_pg_password_here
JWT_SECRET=$(openssl rand -base64 48)
```

启动：

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

---

### 5.3 单 VPS CI 自动部署（T-FOLLOW-5）

适用：已经有一台 Linux VPS，想用 GitHub Actions 在 push tag v* 时**自动**部署。

#### 一次性 VPS 配置

```bash
# 1. 创建非 root 用户
sudo useradd -m -s /bin/bash ptidle
sudo usermod -aG docker ptidle
# ptidle 重新登录生效

# 2. 建项目目录
sudo mkdir -p /opt/ptidle && sudo chown ptidle:ptidle /opt/ptidle
cd /opt/ptidle

# 3. 从仓库复制 docker-compose.yml + .env.example
curl -fsSL -o docker-compose.yml https://raw.githubusercontent.com/YunXihb/PtIDLE/master/docker-compose.yml
curl -fsSL -o .env.example https://raw.githubusercontent.com/YunXihb/PtIDLE/master/.env.example
cp .env.example .env
vim .env   # 填 DB_PASSWORD + JWT_SECRET

# 4. 首次拉 + 启
docker compose pull
docker compose run --rm migrate
docker compose up -d

# 5. 验证 (内部, 不走 Caddy)
curl http://127.0.0.1:3000/health
# 预期: {"status":"ok",...}

# === T-FOLLOW-6: HTTPS / DNS 配置 ===

# 6. DNS 指向 VPS (一次性, 5 min)
# 在 DNS provider (Cloudflare / Porkbun / Namecheap / Aliyun / Route 53 / 其他)
# 加一条 A 记录:
#   Host: $DOMAIN (e.g. `ptidle` 如果用根域 `example.com`, 填 `@`)
#   Type: A
#   Value: VPS 公网 IP
#   TTL: Auto 或 300
# 等待 DNS 传播 (5-30 min), 验证:
dig +short $DOMAIN
# 预期: 你的 VPS IP

# 7. 更新 .env (加 DOMAIN + ACME_EMAIL)
cd /opt/ptidle
vim .env
# 把 .env.example 里的 CHANGE_ME 占位符都替换:
#   DOMAIN=ptidle.example.com
#   ACME_EMAIL=your-real-email@example.com
#   DB_PASSWORD=<openssl rand -base64 32>
#   JWT_SECRET=<openssl rand -base64 48>

# 8. 重启 caddy (让新 DOMAIN env 生效)
docker compose up -d caddy
docker compose logs caddy | tail -20
# 找: "certificate obtained successfully" 或 "acme: ... error" (后者看 § 错误排查)
```

#### GitHub Secrets 配置

| Secret | 例子 | 用途 |
|---|---|---|
| `VPS_SSH_KEY` | `-----BEGIN OPENSSH PRIVATE KEY-----\n...` | GitHub Actions SSH 私钥 (ed25519) |
| `VPS_HOST` | `203.0.113.42` | VPS IP 或域名 |
| `VPS_USER` | `ptidle` | VPS 上 SSH 用户 (非 root) |

**生成专用 key** (不要复用个人 key):

```bash
# 本地
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/ptidle_deploy
ssh-copy-id -i ~/.ssh/ptidle_deploy.pub ptidle@vps
# 私钥 → GitHub repo settings → Secrets → VPS_SSH_KEY
```

#### 自动部署流程

```
1. Dev: git tag v0.2.0 && git push origin v0.2.0
2. release.yml 触发 → 3-5 min build + push GHCR (4 tags)
3. release.yml success event → 触发 deploy.yml
4. deploy.yml SSH 到 VPS → 跑 scripts/deploy.sh
5. VPS: pull → migrate → restart → 30s health check
6. deploy.yml 报告 success/failure 到 GH Actions UI
```

#### 自动回滚 (T-FOLLOW-7)

T-FOLLOW-7 起, `scripts/deploy.sh` 会在 health check 失败时**自动回滚**:

- **触发条件**: deploy 后 30s 内 `/health` 没返回 200 (migrate 失败 / 拉镜像失败 不触发)
- **回滚目标**: `/opt/ptidle/.last_good` 里记录的上次成功 deploy 的 image digest
- **行为**: 拉旧 image → 用 `BACKEND_IMAGE=$prev_good docker compose up -d` 重启 → 15s 健康检查
  - **回滚成功** → deploy.yml 显示 green (旧版本恢复服务, 玩家无感)
  - **回滚失败** → deploy.yml 显示 red + dump backend logs, 用户 SSH 介入
- **首次 deploy 不会触发回滚** (无 `.last_good`)

**关键假设**: migrations 是 forward-only 且 additive (见 § Q4). 回滚代码到 N-1 时, DB schema 仍是 N 的状态; 旧代码不引用新列, 可正常运行.

#### 查看/手动覆盖 .last_good

```bash
# SSH 到 VPS
ssh ptidle@vps

# 查看当前 .last_good
cat /opt/ptidle/.last_good
# 例: ghcr.io/yunxihb/ptidle-backend@sha256:a1b2c3d4...

# 比对当前 running
docker inspect --format='{{.Image}}' ptidle-backend
# 不一致 = 正在跑非 .last_good (deploy 中或回滚中)

# 强制回滚到指定 image (极端情况, e.g. .last_good 也坏)
echo 'ghcr.io/yunxihb/ptidle-backend:v0.1.0' > /opt/ptidle/.last_good
cd /opt/ptidle
BACKEND_IMAGE=$(cat .last_good) docker compose up -d --force-recreate backend
```

#### 回滚失败排查 (deploy.yml 红色 + 回滚 health check 也 fail)

```bash
# 1. SSH 看完整日志
ssh ptidle@vps "cd /opt/ptidle && docker compose logs --tail=200 backend"

# 2. 检查 .last_good 指向的 image 是否仍可拉
ssh ptidle@vps "docker pull \$(cat /opt/ptidle/.last_good)"
# 失败: image 被 GC / registry 不可达 → 改 .last_good 指向其他 good tag

# 3. 手动指定更早的 tag 回滚 (e.g. 上上个版本)
ssh ptidle@vps "cd /opt/ptidle && \
  BACKEND_IMAGE=ghcr.io/yunxihb/ptidle-backend:v0.0.5 \
  docker compose up -d --force-recreate backend"
```

#### 手动重跑 deploy（不发布新版本）

```bash
# GitHub UI: Actions → Deploy → Run workflow
# 或 gh CLI:
gh workflow run deploy.yml
```

#### 错误排查

```bash
# SSH 到 VPS 看完整日志
ssh ptidle@vps "cd /opt/ptidle && docker compose logs --tail=100 backend"

# 手动回滚到上一个 tag
ssh ptidle@vps "cd /opt/ptidle && docker compose pull backend:v0.1.0 && docker compose up -d --force-recreate backend"

# 重跑 migrations
ssh ptidle@vps "cd /opt/ptidle && docker compose run --rm migrate"

# === T-FOLLOW-6: HTTPS 相关 ===

# 验证 HTTPS endpoint (应 200)
ssh ptidle@vps "curl -vI https://$DOMAIN/health"
# 预期: HTTP/2 200, server: Caddy, 含 alt-svc / strict-transport-security header

# 验证 HTTP → HTTPS 重定向 (应 301)
ssh ptidle@vps "curl -vI http://$DOMAIN/health"
# 预期: 301 → https://$DOMAIN/health

# cert 申请失败 (Caddy log)
ssh ptidle@vps "cd /opt/ptidle && docker compose logs caddy | grep -iE 'acme|certificate|error'"
# 常见错:
#   - "no such host"     → DNS A 记录没指 / 没传播, 等或检查 DNS dashboard
#   - "acme: 403"        → 80 端口被防火墙挡
#   - "acme: rate limit" → 短时间重复申请, 等几小时

# 80 端口被防火墙挡 (Hetzner / DO / Aliyun)
# Hetzner: cloud console firewall 加 80 + 443
# DO:      ufw allow 80/tcp && ufw allow 443/tcp
# Aliyun:  安全组规则添加入方向 80 + 443
```

**注意**: GHCR package 默认是 **private**。首次 deploy 前需到 `https://github.com/YunXihb/PtIDLE/packages` 把 package 设为 public（或在 docker-compose.yml 中改用 auth token 私有拉取）。

---

## 六、健康检查

容器内置 HEALTHCHECK（基于 Docker HEALTHCHECK 协议）：

| 配置 | 值 |
|---|---|
| 命令 | `node -e "require('http').get('http://127.0.0.1:$PORT/health', ...)"` |
| 间隔 | 30s |
| 超时 | 5s |
| 启动宽限 | 30s（首次启动 + DB 连接 + Redis 握手） |
| 重试 | 3 次失败标记 unhealthy |

手动验证：

```bash
docker inspect --format='{{.State.Health.Status}}' ptidle-backend
# healthy / unhealthy / starting

docker inspect --format='{{range .State.Health.Check.Log}}{{.Output}}{{end}}' ptidle-backend
# 显示最近 5 次健康检查输出
```

`/health` 端点响应格式：

```json
{
  "status": "ok",
  "timestamp": "2026-06-22T07:17:43.349Z",
  "services": {
    "database": "unknown",
    "redis": "unknown"
  }
}
```

> 200 表示 HTTP server 启动正常 + 路由注册成功。services 字段当前仅占位（未做 active probe），未来 T-FOLLOW-5 可加深度健康检查（DB/Redis 实时 ping）。

---

## 七、构建自定义镜像（高级）

如果需要本地 build（修改代码、添加依赖）：

```bash
# 从仓库根
git clone https://github.com/YunXihb/PtIDLE.git
cd PtIDLE

# 本地 build
docker build -t ptidle-backend:dev -f backend/Dockerfile backend/

# 验证
docker run --rm -p 3000:3000 \
  -e DB_HOST=host.docker.internal -e DB_PORT=5432 \
  -e REDIS_HOST=host.docker.internal -e REDIS_PORT=6379 \
  -e JWT_SECRET=test \
  ptidle-backend:dev
```

> `host.docker.internal` 在 Docker Desktop（Mac/Win）和 Linux 20.10+ 有效。Linux 旧版本需加 `--add-host=host.docker.internal:host-gateway`。

### 触发 release workflow

```bash
# 推送 semver tag → 自动 build + push + 打 latest
git tag v1.0.0
git push origin v1.0.0

# 或 GitHub UI: Actions → Release → Run workflow → 输入 version (e.g. v1.0.1-rc1)
```

---

## 八、备份与恢复

PtIDLE 提供 daily 自动备份（PG 全量 dump）+ 保留策略 + 恢复流程，防止数据丢失（误操作 / migration 失败 / 硬件故障）。

### 8.1 频率与保留

- **频率**：daily（GH Actions cron `17 3 * * *`，03:17 UTC，避开整点）
- **保留**：最近 14 天 daily 备份 + 最近 8 周 weekly 备份（周一），约 22 个备份
- **格式**：`pg_dump --format=custom --compress=9`（内置压缩，支持选择性恢复单表）

### 8.2 备份存储

- 默认 `BACKUP_STORAGE=local`：存 VPS `/opt/ptidle/backups/`，文件名 `ptidle-YYYY-MM-DD.dump`
- storage 抽象成接口（`scripts/backup.sh` 内 `upload_backup`/`list_backups`/`delete_backup` 函数 dispatch），后续加 B2/S3 只需实现分支（见 `docs/superpowers/specs/2026-08-06-tfollow8-backup-design.md`）
- **注意**：`local` 仅本地存储，VPS 挂了备份也没；异地备份见 § 8.7

### 8.3 首次部署（更新 VPS 配置）

backup service 是 T-FOLLOW-8 新增。deploy 流程只更新 backend image，不改 compose/scripts，所以 VPS 需一次性手动更新配置：

```bash
# SSH 到 VPS
ssh user@vps
cd /opt/ptidle

# 1. 更新 docker-compose.yml (加 backup service) + scripts/backup.sh + scripts/restore.sh
git pull          # 若 /opt/ptidle 是 git checkout; 否则手动 scp 这 3 个文件

# 2. .env 加 BACKUP_* 配置
cat >> .env <<'EOF'
BACKUP_STORAGE=local
RETENTION_DAILY=14
RETENTION_WEEKLY=8
EOF

# 3. 创建备份目录
mkdir -p backups

# 4. 验证 backup service 可用 (跑一次手动备份)
docker compose run --rm backup
```

### 8.4 手动触发备份

- **GH Actions**：仓库 Actions 页 → Backup workflow → Run workflow（`workflow_dispatch`）
- **VPS 直接**：`cd /opt/ptidle && docker compose run --rm backup`

### 8.5 恢复流程

> ⚠️ 恢复会**覆盖**现有数据。先确认必要，建议先备份当前状态。

```bash
cd /opt/ptidle

# 列出可用备份
ls backups/ptidle-*.dump

# 恢复指定日期 (必须设 CONFIRM_RESTORE=yes 防误跑)
docker compose run --rm -e CONFIRM_RESTORE=yes backup /rs.sh 2026-08-06

# 或恢复最新
docker compose run --rm -e CONFIRM_RESTORE=yes backup /rs.sh latest
```

恢复后 `schema_migrations` 被备份时状态覆盖；若备份后有新 migration，需重跑 `docker compose run --rm migrate`。

### 8.6 排查

| 问题 | 排查 |
|---|---|
| GH Actions Backup red | 看 "Run backup via SSH" step 日志；`appleboy` 输出 `backup.sh` stdout，最后一个 `==>` 标记指示失败步骤 |
| `磁盘可用空间 < 1GB` | VPS 磁盘满，清理 `/opt/ptidle/backups/` 旧备份或扩容 |
| `pg_dump` 失败 | 检查 postgres service 健康（`docker compose ps`）；`DB_PASSWORD` 是否正确 |
| 备份未生成 | 确认 VPS `docker-compose.yml` 含 backup service（§ 8.3 首次部署） |

### 8.7 未来：异地备份（B2/S3）

当前 `BACKUP_STORAGE=local` 仅本地。未来加异地备份：
1. 开 Backblaze B2 / AWS S3 bucket + 凭据
2. 在 `scripts/backup.sh` 的 `upload_backup`/`list_backups`/`delete_backup` 实现 `b2`/`s3` 分支（用 rclone 或 aws-cli）
3. VPS 装 rclone/aws-cli + 配置凭据
4. `.env` 改 `BACKUP_STORAGE=b2`（或 s3）

---

## 九、常见问题

### Q1: 容器启动后立刻退出？

检查：
- DB/Redis 端口是否可达（容器内 `localhost` ≠ host 的 `localhost`，用 `host.docker.internal`）
- `DB_PASSWORD` / `JWT_SECRET` 是否设置（必填无默认）
- 查看 `docker logs ptidle-backend` 找具体错误

### Q2: /health 返回 200 但游戏功能不正常？

- 检查 migrations：`PGPASSWORD=... psql -h ... -c "SELECT count(*) FROM schema_migrations"`
- 重新跑：`docker run --rm -e DB_HOST=... node:20-alpine sh -c "npm ci && npx ts-node src/scripts/migrate.ts"`
- 检查 backend 日志里 `[migrations]` warning（应不出现）

### Q3: 镜像体积太大（215MB）？

- 已用 multi-stage build + `--omit=dev` 优化
- alpine base 镜像约 50MB
- node_modules + compiled JS 约 150MB
- 进一步优化需换 `distroless` 或 `gcr.io/distroless/nodejs20`（T-FOLLOW-5 决定）

### Q4: 如何回滚到旧版本？

**单 VPS 部署**: 自动回滚已由 T-FOLLOW-7 处理 (见 § 5.3 「自动回滚」). 手动覆盖见 § 5.3 「查看/手动覆盖 .last_good」.

**单机部署 (`docker run`)**: 手动回滚:
```bash
# 拉旧版（commit SHA 来自 git log）
docker pull ghcr.io/yunxihb/ptidle-backend:abc1234

# 重新跑 docker run, IMAGE 换 tag
docker run ... ghcr.io/yunxihb/ptidle-backend:abc1234
```

Migrations 是向前兼容的（不删除列），所以降级代码不需要回滚 schema。如果遇到 schema 不兼容，需要在 dev 环境先 `db:migrate` 试验新版本，再部署。

---

## 十、相关链接

- 仓库：https://github.com/YunXihb/PtIDLE
- 镜像：https://github.com/YunXihb/PtIDLE/pkgs/container/ptidle-backend
- 启动流程源码：`backend/src/scripts/migrate.ts` / `backend/src/index.ts`
- CI workflow：`.github/workflows/ci.yml`（测试）
- Release workflow：`.github/workflows/release.yml`（镜像发布）
- 后端 README：`backend/README.md`
- 启动顺序 docs：`backend/README.md` § 启动顺序

---

*文档版本：v1.0*
*创建日期：2026-06-22*
*最后更新：2026-06-25*
