# T-FOLLOW-5 编排平台 + 部署设计文档

**任务**：T-FOLLOW-5 - 选编排平台 + 写 deploy workflow
**日期**：2026-06-22
**状态**：🟡 设计待用户审阅
**前置任务**：T-FOLLOW-4 (Docker image + GHCR + deploy docs)

---

## 一、目标

在 T-FOLLOW-4 (GHCR 镜像 + release workflow) 之上，加 **deploy workflow** 让 push tag v* 自动部署到一台单 VPS。

### 1.1 范围

- 选编排平台：**单 VPS + Docker Compose**（推荐方案 A）
- 写 `.github/workflows/deploy.yml`（监听 release.yml success）
- 写 `scripts/deploy.sh`（SSH 内执行的部署脚本）
- 写 `docker-compose.yml` 模板（postgres + redis + backend + migrate）
- 文档化：VPS 一次性配置步骤 + secrets 配置

### 1.2 范围外（明确不做）

- ❌ 多实例 HA / load balancer（单 VPS 单实例）
- ❌ 自动回滚（按方案 A 选择 — 失败时手动 SSH 修）
- ❌ 备份（用户选择不加 — MVP 阶段数据可重建）
- ❌ HTTPS / TLS / domain（前端 T057+ 之后再说）
- ❌ 监控 / alerting（UptimeRobot 等外部监控留后续）
- ❌ Multi-region / multi-cloud
- ❌ secrets vault 集成（直接用 GitHub secrets）
- ❌ 镜像签名 / 扫描（cosign / trivy，留 T-FOLLOW-5 后续）

---

### 1.3 关键修正（Self-review 发现）

| 问题 | 修正 |
|---|---|
| `migrate.ts` 是 TS 脚本需要 `ts-node`（dev dep），生产 image 跑不了 | 改写为 `src/scripts/migrate.js`（纯 JS，用 prod deps `pg` 直接跑），编译进 dist/ |
| 当前 image 不含 migrations 文件 | Dockerfile 加 `COPY src/migrations /app/migrations` |
| docker-compose 用独立 `node:20-alpine` + bind mount 太复杂 | `migrate` service 改用**同一 backend image**，command 改成 `node dist/scripts/migrate.js` |
| 避免 deploy 频繁 `npm ci` (~1 min 浪费) | image 已含 prod deps, 一次 build 多次 deploy |
| VPS 不需要维护 `backend-migrations` 目录 | 一并消除 |
| docker-compose healthcheck test 行写错 | 用 `CMD-SHELL` + 单引号更安全 |

修正后: docker-compose 仍是 4 services (postgres / redis / backend / migrate)，但 image 复用 + 无 bind mount。

---

## 二、架构

### 2.1 部署拓扑

```
┌─────────────────────┐
│   GitHub origin     │
│  (master / v* tag)  │
└──────────┬──────────┘
           │ push tag v*
           ▼
┌─────────────────────────────────────────┐
│  GitHub Actions                         │
│  ┌─────────────────┐  ┌──────────────┐ │
│  │ release.yml ✅  │→ │ deploy.yml 🆕 │ │
│  │ (build + GHCR)  │  │  (SSH + pull) │ │
│  └─────────────────┘  └──────────────┘ │
└──────────┬──────────────────────────────┘
           │ trigger: workflow_run (release success)
           ▼
┌─────────────────────┐
│   VPS (单台)         │
│  ┌──────────────┐   │
│  │ docker-compose│   │  /opt/ptidle/
│  │ ├─ postgres   │   │  ├─ docker-compose.yml
│  │ ├─ redis      │   │  ├─ .env (NOT committed)
│  │ ├─ backend    │   │  └─ scripts/deploy.sh
│  │ └─ migrate    │   │
│  └──────────────┘   │
└─────────────────────┘
```

**关键决策**:
- **trigger = `workflow_run`**: deploy.yml 监听 release.yml 成功事件，**不**独立触发
  - 避免：未发布就部署（image 还没 push 到 GHCR 就 ssh pull）
  - 避免：CI 跑通 + tag 推了 + deploy 也跑，三件事必须按顺序
- **源码不在 VPS 上**: VPS 只跑 compose + 拉 GHCR 镜像，**不** `git clone`
  - 安全：VPS 被入侵不会泄露代码
  - 简单：VPS 不需要 Node 工具链
- **数据持久化**: postgres + redis 走 Docker volume `pgdata` + `redisdata`

### 2.2 文件改动清单

| 文件 | 改动 |
|---|---|
| `backend/Dockerfile` | **改** —— 加 `COPY src/migrations /app/migrations` (migrations baked 进 image) |
| `backend/src/scripts/migrate.ts` | **改** —— 重写为 `migrate.js` (纯 JS, 用 prod deps `pg`, 不需 ts-node) |
| `backend/src/scripts/migrate.js` | **新建** —— 同上, 替换 .ts |
| `backend/src/scripts/migrate.test.ts` | **改** —— 同步重写, 或保留为 TS (单测用 ts-jest 跑) |
| `docker-compose.yml` | **新建** (repo 根) —— VPS 模板, 4 services |
| `.github/workflows/deploy.yml` | **新建** —— workflow_run trigger + SSH action (~40 行) |
| `scripts/deploy.sh` | **新建** —— VPS 上跑的部署脚本 (~30 行, 含 health check) |
| `docs/deploy.md` | **改** —— 加「5.3 单 VPS CI 自动部署」章节, 引用 deploy.yml + docker-compose.yml |
| `memory-bank/architecture.md` | **改** —— v1.45 → v1.46, 加 T-FOLLOW-5 完整章节 |
| `memory-bank/progress.md` | **改** —— T-FOLLOW-5 移入「已完成」+ 新增 T-FOLLOW-6 |
| `memory-bank/history.md` | **改** —— 追加 2026-06-22 T-FOLLOW-5 日志 |

**VPS 上的文件（手动放，不在 git 里）**:
- `/opt/ptidle/docker-compose.yml` (从仓库 `docker-compose.yml` 模板复制)
- `/opt/ptidle/.env` (DB_PASSWORD + JWT_SECRET，**绝不** commit)

### 2.3 对外接口（仅 1 个 workflow + 1 个脚本）

```yaml
# .github/workflows/deploy.yml
on:
  workflow_run:
    workflows: ["Release"]
    types: [completed]
  workflow_dispatch:  # 手动重跑 deploy

jobs:
  deploy:
    if: ${{ github.event.workflow_run.conclusion == 'success' || github.event_name == 'workflow_dispatch' }}
    # ... SSH action 调用 scripts/deploy.sh
```

```bash
# scripts/deploy.sh (在 VPS 上跑)
cd /opt/ptidle
docker compose pull                  # 拉 backend:latest
docker compose run --rm migrate      # 跑 migrations (T-FOLLOW-1 幂等)
docker compose up -d backend         # 重启 backend
# health check × 30s
```

---

## 三、组件

### 3.1 GitHub Secrets (新增 3 个)

| Secret | 例子 | 用途 |
|---|---|---|
| `VPS_SSH_KEY` | `-----BEGIN OPENSSH PRIVATE KEY-----\n...` | GitHub Actions SSH 私钥 (ed25519) |
| `VPS_HOST` | `203.0.113.42` 或 `vps.example.com` | VPS 地址 |
| `VPS_USER` | `ptidle` | VPS 上 SSH 用户名 (非 root) |

**配置流程** (一次性，VPS 端):
```bash
# VPS 端
sudo useradd -m -s /bin/bash ptidle
sudo mkdir -p /opt/ptidle && sudo chown ptidle:ptidle /opt/ptidle
# 把 GitHub Actions 公钥加到 ptidle 的 authorized_keys
```

**配置流程** (一次性，GitHub 端):
```bash
# 本地生成专用 key 对 (不复用个人 key)
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/ptidle_deploy
# 公钥 → VPS
ssh-copy-id -i ~/.ssh/ptidle_deploy.pub ptidle@vps
# 私钥 → GitHub repo settings → Secrets → VPS_SSH_KEY
```

### 3.2 VPS 一次性配置 (手动，1 次)

```bash
# 1. 装 Docker + Compose
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker ptidle
# ptidle 重新登录生效

# 2. 建项目目录
cd /opt/ptidle

# 3. 写 docker-compose.yml (见 3.3) + .env (见 3.4)
# 4. 拉 + 启
docker compose pull
docker compose up -d postgres redis migrate backend
# migrate 跑一次
docker compose run --rm migrate
# 5. 验证
curl http://127.0.0.1:3000/health
# 预期: {"status":"ok",...}
```

### 3.3 `docker-compose.yml` (VPS 上 / 仓库模板)

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
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  # one-shot: 每次 deploy 显式 run, 平时不启
  # 用 backend 同一 image, command 跑 prod-friendly 迁移脚本
  migrate:
    image: ghcr.io/yunxihb/ptidle-backend:latest
    profiles: ["migrate"]
    environment:
      DB_HOST: postgres
      DB_PORT: 5432
      DB_NAME: ptidle
      DB_USER: ptidle
      DB_PASSWORD: ${DB_PASSWORD}
    command: ["node", "dist/scripts/migrate.js"]
    restart: 'no'

  backend:
    image: ghcr.io/yunxihb/ptidle-backend:latest
    restart: unless-stopped
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
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
      test: ["CMD-SHELL", "node -e \"require('http').get('http://127.0.0.1:3000/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))\""]
      interval: 30s
      timeout: 5s
      start_period: 30s
      retries: 3

volumes:
  pgdata:
  redisdata:
```

**关键点**:
- `migrate` 用 `profiles: ["migrate"]` 隔离，平时不启
- `migrate` 跟 `backend` 用**同一 image** —— migrations SQL 文件已 baked 进 image (`/app/migrations/`), 用 prod-friendly `migrate.js` 跑
- `backend` 用 `condition: service_healthy` 等 PG/Redis ready
- 镜像 `:latest` 始终指最新 release
- **没有 source code volume**: 后端 image 已是自包含, 不挂载源码 (避免污染 prod)
- healthcheck 用 `CMD-SHELL` + 双引号包裹 (YAML 安全)

### 3.4 `.env` on VPS (NOT committed)

```bash
DB_PASSWORD=<强随机密码>
JWT_SECRET=<openssl rand -base64 48>
```

### 3.5 `.github/workflows/deploy.yml` (新文件)

```yaml
name: Deploy
on:
  workflow_run:
    workflows: ["Release"]
    types: [completed]
  workflow_dispatch:

jobs:
  deploy:
    name: Deploy to VPS
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - name: Run deploy script on VPS
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          script_path: scripts/deploy.sh
          envs: GITHUB_SHA,DEPLOY_TS

      - name: Setup envs
        run: |
          echo "DEPLOY_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> $GITHUB_ENV
          echo "GITHUB_SHA=${GITHUB_SHA::7}" >> $GITHUB_ENV
```

### 3.6 `scripts/deploy.sh`

```bash
#!/bin/bash
# VPS 上跑的部署脚本: pull + migrate + restart + health check
# 触发: GitHub Actions deploy.yml 通过 SSH 调
set -euo pipefail

cd /opt/ptidle

echo "==> [1/4] Pull latest images"
docker compose pull backend

echo "==> [2/4] Run migrations (uses backend image)"
docker compose run --rm migrate

echo "==> [3/4] Restart backend"
docker compose up -d backend

echo "==> [4/4] Wait for /health (max 30s)"
for i in $(seq 1 30); do
  STATUS=$(docker compose exec -T backend node -e "require('http').get('http://127.0.0.1:3000/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))" 2>/dev/null && echo OK || echo FAIL)
  if [ "$STATUS" = "OK" ]; then
    echo "✅ Health check passed at attempt $i"
    exit 0
  fi
  sleep 1
done

echo "❌ Health check failed after 30s"
echo "--- backend logs (last 50 lines) ---"
docker compose logs --tail=50 backend
exit 1
```

---

## 四、数据流 (一个 v* tag push 的完整路径)

```
1. Dev: git tag v0.1.0 && git push origin v0.1.0
2. release.yml 触发 (T-FOLLOW-4) → 3:19 build + push GHCR (4 tags)
3. release.yml 成功 event → 触发 deploy.yml (workflow_run)
4. deploy.yml 走 SSH 到 VPS (用 secrets.VPS_SSH_KEY)
5. VPS 跑 scripts/deploy.sh:
   a. docker compose pull backend (拉 latest)
   b. docker compose run --rm migrate (应用 pending migrations)
   c. docker compose up -d backend (重启 backend)
   d. health check: /health × 30s
6. deploy.yml 报告 success/failure 到 GH Actions UI
```

---

## 五、错误处理

| 失败点 | 后果 | 处理 |
|---|---|---|
| SSH 失败 (VPS 宕 / key 错) | GH Actions fail | 红色, 需手动修 VPS 或 secret |
| `docker compose pull` 失败 (网络/认证) | GH Actions fail | 红色, 旧 image 仍运行 |
| `migrate` 失败 (schema 错) | GH Actions fail | 红色, 旧 image 仍运行 |
| `up -d backend` 失败 (image 错) | GH Actions fail | 红色, 旧 image 仍运行 |
| Health check 30s 内不通过 | GH Actions fail | 红色, 旧 image 仍运行 + 输出 backend logs |
| **任何失败 →** | **手动 SSH 排查** | 按 A 选择, 无 auto-rollback |

**关键保证**: `docker compose up -d backend` 只重启 backend 容器, postgres/redis 数据**不受影响**。手动排查:
```bash
ssh ptidle@vps "cd /opt/ptidle && docker compose logs --tail=100 backend"
```

**手动回滚 (如有需要)**:
```bash
ssh ptidle@vps "cd /opt/ptidle && docker compose pull backend:v0.0.9 && docker compose up -d backend"
```

---

## 六、测试策略

| 测试 | 方法 |
|---|---|
| Workflow YAML 语法 | `python3 -c "import yaml; yaml.safe_load(...)"` 本地验证 |
| `deploy.sh` 语法 | `bash -n scripts/deploy.sh` 本地验证 |
| `docker-compose.yml` 语法 | `docker compose config` 在 VPS 第一次配置时跑 |
| **真实部署** | 用户 push v* tag 触发完整链路 (v0.1.0 已发布, 可作首次 deploy 验证) |
| Health check 端到端 | deploy.sh 包含, 自动验证 |
| **回滚测试** | 故意 deploy 错 image (e.g. 临时 push broken build), 验证 deploy 失败但旧 image 仍跑 |

### 6.1 验收清单 (Definition of Done)

- [ ] `backend/src/scripts/migrate.ts` → `migrate.js` 重写, 用 prod deps `pg` 跑
- [ ] `backend/src/scripts/migrate.test.ts` 同步重写/保留 (单测用 ts-jest)
- [ ] `backend/Dockerfile` 加 `COPY src/migrations /app/migrations`
- [ ] `.github/workflows/deploy.yml` 写好, YAML valid
- [ ] `scripts/deploy.sh` 写好, `bash -n` 通过
- [ ] `docker-compose.yml` 模板写好 (放在 repo 根)
- [ ] `docs/deploy.md` 加「5.3 单 VPS CI 自动部署」章节
- [ ] memory-bank 三件套更新 (architecture v1.46, progress, history)
- [ ] **真实验证**: 用户第一次在 VPS 上跑一次性配置 + push v* tag → 看到 deploy success
- [ ] 全量 42/701 jest 仍全绿 (deploy 是新增 workflow, 单测可能因 migrate 重写略有变化)
- [ ] 不引入新依赖 (deploy.yml 用 appleboy/ssh-action, 是 GH Actions 标准 action)

---

## 七、未来工作 (T-FOLLOW-6+)

| 任务 | 描述 |
|---|---|
| T-FOLLOW-6 | HTTPS / TLS (Caddy / nginx + Let's Encrypt) + domain 配置 |
| T-FOLLOW-7 | 自动回滚 (记录 .last-good tag + health check fail 时 restore) |
| T-FOLLOW-8 | 备份策略 (daily pg_dump → Backblaze B2 / S3) |
| T-FOLLOW-9 | 监控 (UptimeRobot free tier + GH Actions scheduled health check) |
| T-FOLLOW-10 | 镜像签名 (cosign) + 扫描 (trivy) — 安全加固 |
| T-FOLLOW-11 | Distroless 镜像 (gcr.io/distroless/nodejs20) — 体积优化 |
| T-FOLLOW-12 | HA / multi-instance (load balancer + 2 VPS) — 仅在用户量到时考虑 |

---

## 八、关联文档

- 前置：[T-FOLLOW-4 设计](commit 5582977)
- 部署总览：`docs/deploy.md` (T-FOLLOW-4 已建, 本任务补充「5.3 单 VPS CI 自动部署」)
- 架构文档：`memory-bank/architecture.md` v1.45 (T-FOLLOW-4 收尾)
- 项目规约：根 `CLAUDE.md` 工作流 + 文档位置

---

*文档版本：v1.0*
*创建日期：2026-06-22*
*最后更新：2026-06-22*
