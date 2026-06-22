# T-FOLLOW-6 HTTPS / TLS / Domain 设计文档

**任务**：T-FOLLOW-6 - 加 HTTPS 反向代理（Caddy）+ 域名访问
**日期**：2026-06-22
**状态**：🟡 设计待用户审阅
**前置任务**：T-FOLLOW-5 (单 VPS 部署编排, 已完成)

---

## 一、目标

在 T-FOLLOW-5 (deploy workflow) 之上加 HTTPS 反向代理，让玩家通过 `https://$DOMAIN` 安全访问 PtIDLE 后端。

### 1.1 范围

- ✅ 选反向代理：**Caddy**（自动 HTTPS，零 cert 运维）
- ✅ 写 `Caddyfile`（4 行配置）
- ✅ 改 `docker-compose.yml` 加 `caddy` 第 5 个 service
- ✅ 改 `.env.example` 加 `DOMAIN` + `ACME_EMAIL`
- ✅ 文档化：DNS A 记录步骤 + HTTPS 验证
- ✅ HTTP → HTTPS 自动重定向（Caddy 内置）
- ✅ WebSocket (Socket.IO /socket.io/) 透明转发

### 1.2 范围外（明确不做）

- ❌ Wildcard cert（DNS-01 challenge）—— 单 domain 够用
- ❌ Rate limiting / DDoS 防护 —— 内部娱乐游戏, 量小
- ❌ 多 domain / SAN cert —— 单域名单 cert 够
- ❌ HSTS preload —— 后续可加
- ❌ 自动回滚（T-FOLLOW-7）
- ❌ 备份（T-FOLLOW-8）
- ❌ 监控（T-FOLLOW-9，等 T-FOLLOW-6 完成才有 https endpoint 外部 ping）

---

## 二、架构

### 2.1 部署拓扑

```
┌─────────────────────┐
│   玩家浏览器         │
│   https://$DOMAIN   │
└──────────┬──────────┘
           │ DNS 解析 A 记录 → VPS IP
           ↓
┌─────────────────────┐
│  VPS firewall       │
│  允许 80 + 443       │
└──────────┬──────────┘
           ↓
┌──────────────────────────────────────────┐
│  Docker Compose                          │
│  ┌──────────────┐                        │
│  │   caddy      │ 80/443 ← Let's Encrypt│
│  │   (新)       │ auto-cert + 90d 续期   │
│  └──────┬───────┘                        │
│         │ 内部 docker network            │
│  ┌──────▼───────┐                        │
│  │   backend    │ :3000                  │
│  │   (已有)     │ Socket.IO /socket.io/  │
│  └──────┬───────┘                        │
│         │                                │
│  ┌──────▼───┐  ┌──────┐                  │
│  │ postgres │  │ redis│                  │
│  │  :5432   │  │ :6379│                  │
│  └──────────┘  └──────┘                  │
└──────────────────────────────────────────┘
```

### 2.2 关键决策

1. **Caddy 在 compose 内（不是 host native）**：跟现有 4-service 模式一致, `docker compose up -d` 管所有服务, 升级统一
2. **HTTP-01 challenge（不是 DNS-01）**：不需 DNS API token, 任何 DNS provider 都行, 只需 80 端口可达
3. **删 backend 直连 port 3000**：玩家只能走 Caddy, 减少攻击面
4. **`caddy_data` volume 持久化 cert**：容器重建不丢 cert, 避免重复申请触发 Let's Encrypt 限速

### 2.3 文件改动清单

| 文件 | 改动 | 行数估算 |
|---|---|---|
| `Caddyfile` | 新建 | 4 行 |
| `docker-compose.yml` | 加 caddy service + 改 backend (删 ports) + 加 2 volumes | +25 / -2 |
| `.env.example` | 加 DOMAIN + ACME_EMAIL | +5 |
| `docs/deploy.md` § 5.3 | DNS A 记录步骤 + https 验证 | +20 |
| `memory-bank/architecture.md` | v1.46 → v1.47, 加 T-FOLLOW-6 章节 | (收尾) |
| `memory-bank/progress.md` | T-FOLLOW-6 移已完成, 加 T-FOLLOW-7 | +1 / -1 |
| `memory-bank/history.md` | 追加 2026-06-22 T-FOLLOW-6 日志 | (收尾) |

### 2.4 对外接口（Caddyfile 4 行）

```caddyfile
# T-FOLLOW-6: HTTPS reverse proxy
{$DOMAIN} {
    reverse_proxy backend:3000
}
```

Caddy 启动时自动检测：
- 没 cert → 走 ACME HTTP-01 申请
- 有 cert → 60 天后自动续期
- HTTP 请求 → 301 重定向到 HTTPS
- WebSocket upgrade → 透明转发 (Socket.IO /socket.io/ 默认支持)

---

## 三、组件

### 3.1 `Caddyfile`（新建, repo 根）

```caddyfile
# =============================================================================
# PtIDLE HTTPS reverse proxy
# =============================================================================
# T-FOLLOW-6: 用 Caddy 自动 HTTPS
# - 启动时自动申请 Let's Encrypt cert
# - 60 天后续期 (留 30 天 buffer)
# - HTTP 自动 301 → HTTPS
# - WebSocket 透明转发 (Socket.IO /socket.io/)
# - env DOMAIN 由 docker-compose 注入
# =============================================================================

{$DOMAIN} {
    reverse_proxy backend:3000
}
```

### 3.2 `docker-compose.yml`（改）

新增 caddy service, 改 backend service:

```yaml
services:
  postgres:
    # ... (不变)
  redis:
    # ... (不变)
  migrate:
    # ... (不变)
  backend:
    image: ghcr.io/yunxihb/ptidle-backend:latest
    restart: unless-stopped
    # ❌ 删除 ports: ["${BACKEND_PORT:-3000}:3000"]
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    environment:
      MIGRATIONS_DIR: /app/migrations
      DB_HOST: postgres
      DB_PORT: 5432
      DB_NAME: ${POSTGRES_DB:-ptidle}
      DB_USER: ${POSTGRES_USER:-ptidle}
      DB_PASSWORD: ${DB_PASSWORD}
      REDIS_HOST: redis
      REDIS_PORT: 6379
      JWT_SECRET: ${JWT_SECRET:?JWT_SECRET must be set}
      NODE_ENV: production
      PORT: 3000
    healthcheck:
      test: ["CMD-SHELL", "node -e \"require('http').get('http://127.0.0.1:3000/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))\""]
      interval: 30s
      timeout: 5s
      start_period: 30s
      retries: 3

  # T-FOLLOW-6: HTTPS reverse proxy
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data      # Let's Encrypt certs 持久化
      - caddy_config:/config  # Caddy 内部状态
    environment:
      DOMAIN: ${DOMAIN:?DOMAIN must be set}
    depends_on:
      backend:
        condition: service_healthy
    # Caddy 自己没 healthcheck — 启动成功 = 在监听 80/443, 失败会 exit

volumes:
  pgdata:
  redisdata:
  caddy_data:
  caddy_config:
```

**关键变化**:
- `backend` 删 `ports: [...]` —— 不再暴露 3000 到 host, 玩家只能走 Caddy
- `caddy` 暴露 80 + 443 到 host
- `caddy_data` volume 持久化 cert (容器重建不丢)
- `caddy` 跟 `backend` 用同一 docker network (compose 默认), 内部用 `backend:3000` 访问

### 3.3 `.env.example`（改）

加 2 个新 vars, 删 `BACKEND_PORT` (不再用):

```bash
# =============================================================================
# PtIDLE Production .env example (VPS 上 /opt/ptidle/.env)
# =============================================================================
# T-FOLLOW-6: 新增 DOMAIN + ACME_EMAIL
# .env **绝不** 进 git, **绝不** 进 image
# =============================================================================

# PostgreSQL
POSTGRES_DB=ptidle
POSTGRES_USER=ptidle
DB_PASSWORD=CHANGE_ME_TO_STRONG_RANDOM_PASSWORD

# JWT (生产用, 至少 32 字符随机)
# 生成: openssl rand -base64 48
JWT_SECRET=CHANGE_ME_TO_OPENSSL_RAND_BASE64_48_OUTPUT

# T-FOLLOW-6: HTTPS / domain
# DOMAIN: 你的真实域名 (e.g. ptidle.example.com), 需先在 DNS 加 A 记录指向 VPS IP
DOMAIN=CHANGE_ME_TO_YOUR_REAL_DOMAIN
# ACME_EMAIL: Let's Encrypt cert 过期前会发邮件, 填可接收邮件的地址
ACME_EMAIL=CHANGE_ME_TO_YOUR_EMAIL
```

### 3.4 `docs/deploy.md` § 5.3（改）

在「GitHub Secrets 配置」前加新步骤:

```markdown
#### DNS 指向 VPS（一次性, 5 min）

在 DNS provider (Cloudflare / Porkbun / Namecheap / Aliyun / Route 53 / 其他) 加一条 **A 记录**:
- Host: `$DOMAIN` (e.g. `ptidle` 如果用根域 `example.com`, 填 `@`)
- Type: A
- Value: VPS 公网 IP
- TTL: Auto 或 300

等待 DNS 传播 (5-30 min), 验证:
```bash
dig +short $DOMAIN
# 预期: 你的 VPS IP
```

#### 更新 .env

```bash
# VPS 上
cd /opt/ptidle
vim .env   # 加 DOMAIN + ACME_EMAIL (强随机, 见 .env.example)
```

#### 修改首次部署步骤（用 https 验证）

把原 § 5.3 的:
```bash
curl http://127.0.0.1:3000/health
```
改为:
```bash
curl -I https://$DOMAIN/health
# 预期: HTTP/2 200, server: Caddy
```

并加 1 步验证 HTTP→HTTPS 重定向:
```bash
curl -I http://$DOMAIN/health
# 预期: 301 → https://$DOMAIN/health
```

#### 错误排查（加 2 条）

```bash
# cert 申请失败 (Caddy log)
ssh ptidle@vps "cd /opt/ptidle && docker compose logs caddy | grep -i 'acme\|certificate'"

# 80 端口 firewall 挡 (Hetzner / DO / etc.)
# Hetzner: 在 cloud console firewall 加 80 + 443
# DO:    ufw allow 80/tcp && ufw allow 443/tcp
# Aliyun: 安全组规则添加入方向 80 + 443
```

---

## 四、数据流

### 4.1 首次配置（一次性, 15 min）

```
[用户: DNS provider]
  ↓ 添加 A 记录: $DOMAIN → VPS_IP
  ↓ 等待 DNS 传播 (5-30 min)
  ↓
[VPS: /opt/ptidle/.env]
  ↓ vim .env → 加 DOMAIN + ACME_EMAIL
  ↓
[VPS: docker compose up -d]
  ↓
  caddy container 启动
  ↓ 读 Caddyfile, 见 {$DOMAIN} → 用 DOMAIN env
  ↓ 解析 DNS (自检: A 记录 → VPS IP 自己)
  ↓ 启动 HTTP listener on :80
  ↓ 触发 ACME HTTP-01 challenge
  ↓ Let's Encrypt 验证 (curl http://$DOMAIN/.well-known/acme-challenge/xxx)
  ↓ 验证通过 → 签发 cert
  ↓ Caddy 切换到 HTTPS (:443), 用新 cert
  ↓
  ✅ https://$DOMAIN/health → 200
```

### 4.2 正常 deploy (push tag v*)

```
git tag v0.2.0 && git push origin v0.2.0
  ↓
[GH Actions: release.yml] (3-5 min)
  ↓
[GH Actions: deploy.yml] (workflow_run trigger)
  ↓ SSH → VPS → scripts/deploy.sh
  ↓
[VPS: deploy.sh]
  ↓ docker compose pull backend
  ↓ docker compose run --rm migrate
  ↓ docker compose up -d --force-recreate backend
  ↓ 30s health check: curl http://backend:3000/health  ← 内部 network, 不走 Caddy
  ↓ ✅ Pass
  ↓
[玩家浏览器: https://$DOMAIN]
  ↓ DNS 解析到 VPS IP
  ↓ TLS 握手 (Let's Encrypt cert)
  ↓ HTTP → Caddy → backend:3000
  ↓
  ✅ 玩家看到新版本
```

**关键**: deploy.sh health check **不变** (内部 network 直 ping `backend:3000`), 跟外部 HTTPS 走 Caddy 是两条独立路径。

### 4.3 Cert 自动续期（零用户操作）

```
[Caddy 容器, 每 12h 检查一次]
  ↓ cert 还有 <30 天?
  ↓ 是 → 重新跑 ACME HTTP-01 challenge
  ↓ Let's Encrypt 签新 cert
  ↓ Caddy 热加载新 cert (no downtime)
  ↓
  ✅ 续期完成
```

---

## 五、错误处理

| 失败点 | 表现 | 处理 |
|---|---|---|
| DNS A 记录没指 | Caddy log: `dial ...: no such host` | DNS dashboard 加 A 记录, `docker compose restart caddy` |
| 80 端口 firewall 挡 | Caddy log: `acme: error: 403` | `ufw allow 80/tcp` 或 provider firewall, 重启 caddy |
| 80 端口被其他服务占 | `docker compose up caddy` 报 port conflict | `ss -tlnp \| grep :80` 找占用, kill 或改 Caddy 端口 |
| ACME email 错 | Let's Encrypt 拒绝签发 | 改 .env ACME_EMAIL, 重启 caddy |
| Caddyfile 错 | Caddy 启动失败, exit 1 | `docker compose logs caddy` 看具体错 |
| Cert 续期失败 | log 警告 | 自动重试 (5 次/天), 60 天后 cert 过期 |
| Caddy container 挂 | `docker compose ps` 显 Exit | `restart: unless-stopped` 自动拉起, 看 logs 找根因 |
| 玩家用 HTTP | Caddy 自动 301 → HTTPS | 内置 |
| WebSocket 断 | 玩家游戏断线 | Caddy 默认 WS timeout 合理, 真断了 reload |

---

## 六、测试策略

| 测试 | 方法 | 通过标准 |
|---|---|---|
| **Caddyfile 语法** | 本地: `docker run --rm -v $PWD/Caddyfile:/etc/caddy/Caddyfile caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile` | exit 0 |
| **docker-compose 语法** | 本地: `DOMAIN=test.example.com DB_PASSWORD=test JWT_SECRET=test docker compose config` | exit 0, 5 services |
| **Caddy 容器能起** | VPS: `docker compose up -d caddy`, `docker compose ps` | 状态 `running` |
| **Caddy 拉 cert** | VPS: `docker compose logs caddy`, 找 "certificate obtained successfully" | log 出现 |
| **HTTPS 端到端** | VPS: `curl -vI https://$DOMAIN/health` | `HTTP/2 200`, `server: Caddy` |
| **HTTP→HTTPS** | VPS: `curl -vI http://$DOMAIN/health` | `301` → `https://$DOMAIN/health` |
| **WebSocket 升级** | `wscat -c wss://$DOMAIN/socket.io/?EIO=4&transport=websocket` | `101 Switching Protocols` |
| **后端 health check 不变** | deploy.sh 内部 ping 仍走 `backend:3000` | ✅ 已有, 702/702 测过 |

### 6.1 验收清单 (Definition of Done)

- [ ] `Caddyfile` 写好, `caddy validate` 通过
- [ ] `docker-compose.yml` 加 caddy service, `docker compose config` 通过
- [ ] `.env.example` 加 DOMAIN + ACME_EMAIL
- [ ] `docs/deploy.md § 5.3` 加 DNS 步骤 + https 验证
- [ ] `memory-bank/architecture.md` v1.46 → v1.47, 加 T-FOLLOW-6 章节
- [ ] `memory-bank/progress.md` T-FOLLOW-6 移入已完成, 加 T-FOLLOW-7
- [ ] `memory-bank/history.md` 追加 2026-06-22 T-FOLLOW-6 日志
- [ ] **真实验证**: 用户在 VPS 上加 DNS A 记录 + 改 .env + `docker compose up -d` → `https://$DOMAIN/health` 200
- [ ] 全量 702/702 test 仍全绿 (HTTPS 是新增, 单元测试不变)
- [ ] 不引入新依赖 (Caddy 是 GH 官方 image: `caddy:2-alpine`)

---

## 七、未来工作 (T-FOLLOW-7+)

| 任务 | 描述 |
|---|---|
| T-FOLLOW-7 | 自动回滚（记录 .last-good tag + health check fail 时 restore） |
| T-FOLLOW-8 | 备份策略（daily pg_dump → B2 / S3） |
| T-FOLLOW-9 | 监控（UptimeRobot free tier + GH Actions scheduled health check） |
| T-FOLLOW-10 | 镜像签名 (cosign) + 扫描 (trivy) — 安全加固 |
| T-FOLLOW-11 | Distroless 镜像（gcr.io/distroless/nodejs20）— 体积优化 |
| T-FOLLOW-12 | HA / multi-instance（load balancer + 2 VPS）— 仅在用户量到时考虑 |
| T-FOLLOW-13 | Wildcard cert（DNS-01 challenge）— 仅在多 sub-domain 时考虑 |
| T-FOLLOW-14 | HSTS preload — 浏览器 hardcode HTTPS only |

---

## 八、关联文档

- 前置：[T-FOLLOW-5 设计](commit e10b9da)
- 部署总览：`docs/deploy.md` (T-FOLLOW-4 已建, T-FOLLOW-5 加 § 5.3, T-FOLLOW-6 增补)
- 架构文档：`memory-bank/architecture.md` v1.46 (T-FOLLOW-5 收尾)
- 项目规约：根 `CLAUDE.md` 工作流 + 文档位置

---

*文档版本：v1.0*
*创建日期：2026-06-22*
*最后更新：2026-06-22*
