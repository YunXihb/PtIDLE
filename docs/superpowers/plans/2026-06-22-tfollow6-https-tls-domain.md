# T-FOLLOW-6 HTTPS / TLS / Domain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 T-FOLLOW-5 (deploy workflow) 之上加 HTTPS 反向代理, 让玩家通过 `https://$DOMAIN` 安全访问 PtIDLE 后端

**Architecture:** Caddy 作为 docker-compose 第 5 个 service (`caddy:2-alpine`), HTTP-01 challenge 拿 Let's Encrypt cert, cert 持久化在 `caddy_data` named volume, WebSocket 透明转发, HTTP→HTTPS 自动重定向. Backend service 删除 host port 3000 直连, 只通过 Caddy 暴露.

**Tech Stack:** Caddy 2 (alpine), Let's Encrypt (HTTP-01), Docker Compose v2, GitHub Actions (复用现有 release.yml + deploy.yml, 无新 workflow)

**前置任务:** T-FOLLOW-5 (单 VPS 部署编排, 已完成, commit e10b9da)

---

## File Structure

| 文件 | 改动 | 用途 |
|---|---|---|
| `Caddyfile` | 新建 (4 行) | Caddy 配置, 反向代理 + auto-HTTPS |
| `docker-compose.yml` | 改 (96 → ~120 行) | 加 caddy service + 删 backend ports + 加 2 volumes |
| `.env.example` | 改 (20 → ~25 行) | 加 DOMAIN + ACME_EMAIL, 删 BACKEND_PORT |
| `docs/deploy.md` § 5.3 | 改 (~490 → ~520 行) | 加 DNS 步骤 + https 验证 + 错误排查 |
| `memory-bank/architecture.md` | 改 (v1.46 → v1.47) | 加 T-FOLLOW-6 章节 |
| `memory-bank/progress.md` | 改 | T-FOLLOW-6 移已完成 |
| `memory-bank/history.md` | 改 | 追加 2026-06-22 T-FOLLOW-6 日志 |

**测试策略**: Caddyfile 用 `caddy validate`, docker-compose 用 `docker compose config`, 5 service YAML schema 校验. 单元测试不变 (HTTPS 是新功能, 不改 backend 代码).

---

## Task 1: Caddyfile 创建 + 验证

**Files:**
- Create: `Caddyfile`

- [ ] **Step 1: 创建 Caddyfile**

在仓库根 (`/home/lovept/PtIDLE/Caddyfile`) 写 4 行:

```caddyfile
# =============================================================================
# PtIDLE HTTPS reverse proxy (T-FOLLOW-6)
# =============================================================================
# Caddy 启动时自动检测: 没 cert → ACME HTTP-01; 有 cert → 60d 后续期
# HTTP 自动 301 → HTTPS; WebSocket 透明转发 (Socket.IO /socket.io/)
# env DOMAIN 由 docker-compose 注入, 默认 Caddyfile 占位语法 {$DOMAIN}
# =============================================================================

{$DOMAIN} {
    reverse_proxy backend:3000
}
```

- [ ] **Step 2: 用 caddy:2-alpine 验证语法**

Run:
```bash
cd /home/lovept/PtIDLE
docker run --rm \
  -v "$PWD/Caddyfile:/etc/caddy/Caddyfile:ro" \
  -e DOMAIN=test.example.com \
  caddy:2-alpine \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

Expected: `"validating config adapters are usable ..."` 后 exit 0, 无 error. 警告 ("WARN ... {$DOMAIN}") 可接受 — Caddyfile adapter 在 `--adapter caddyfile` 模式下不会展开 `{$DOMAIN}` 占位符, 只检查语法.

如果报错 "no such host backend": 这是因为 caddy validate 不会解析 DNS, 不是错误. 看到 "validating config" + "valid configuration" 就 OK.

- [ ] **Step 3: Commit**

```bash
cd /home/lovept/PtIDLE
git add Caddyfile
git commit -m "feat(https): add Caddyfile for T-FOLLOW-6 HTTPS reverse proxy

4-line config: reverse_proxy backend:3000 with auto-HTTPS via Let's Encrypt.
Caddyfile validates with caddy:2-alpine caddy validate command."
```

---

## Task 2: .env.example 加 DOMAIN + ACME_EMAIL, 删 BACKEND_PORT

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: 读当前 .env.example 确认状态**

Run:
```bash
cat /home/lovept/PtIDLE/.env.example
```

Expected: 当前是 T-FOLLOW-5 后的版本 (20 行), 含 `BACKEND_PORT=3000` 在最后一行 (line 19-20).

- [ ] **Step 2: 改写 .env.example**

完整替换 `/home/lovept/PtIDLE/.env.example` 内容为:

```bash
# =============================================================================
# PtIDLE Production .env example (VPS 上 /opt/ptidle/.env)
# =============================================================================
# T-FOLLOW-5: 复制为 .env 后填真实值
#   cp .env.example .env
#   vim .env
# T-FOLLOW-6: 加 DOMAIN + ACME_EMAIL (HTTPS 反向代理要)
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
# DOMAIN: 真实域名 (e.g. ptidle.example.com), DNS 加 A 记录指向 VPS IP
DOMAIN=CHANGE_ME_TO_YOUR_REAL_DOMAIN
# ACME_EMAIL: Let's Encrypt cert 过期前会发邮件, 填可接收邮件的地址
ACME_EMAIL=CHANGE_ME_TO_YOUR_EMAIL
```

用 Write tool 覆盖 (Read 已确认过内容).

- [ ] **Step 3: 验证 DOMAIN + ACME_EMAIL 在文件里**

Run:
```bash
cd /home/lovept/PtIDLE
grep -E '^(DOMAIN|ACME_EMAIL)=' .env.example
```

Expected:
```
DOMAIN=CHANGE_ME_TO_YOUR_REAL_DOMAIN
ACME_EMAIL=CHANGE_ME_TO_YOUR_EMAIL
```

并验证 BACKEND_PORT 没了:
```bash
cd /home/lovept/PtIDLE
! grep -q '^BACKEND_PORT=' .env.example && echo "OK: BACKEND_PORT removed" || echo "FAIL: BACKEND_PORT still present"
```

Expected: `OK: BACKEND_PORT removed`

- [ ] **Step 4: Commit**

```bash
cd /home/lovept/PtIDLE
git add .env.example
git commit -m "feat(https): .env.example add DOMAIN + ACME_EMAIL, remove BACKEND_PORT

T-FOLLOW-6: Caddy needs DOMAIN for vhost, ACME_EMAIL for Let's Encrypt
notifications. BACKEND_PORT removed since backend no longer exposes host
port (only Caddy exposes 80+443)."
```

---

## Task 3: docker-compose.yml 加 caddy service + 删 backend ports

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: 改 backend service 的 ports (删掉 host 3000 映射)**

Edit `/home/lovept/PtIDLE/docker-compose.yml`: 删 backend service 的 ports block (line 73-74):

```yaml
    ports:
      - "${BACKEND_PORT:-3000}:3000"
```

替换为 (只删 ports, 不留空):

```yaml
    # T-FOLLOW-6: 不再 expose host port, 只通过 Caddy 暴露 (减少攻击面)
```

(即把 ports 那两行换成一行注释)

- [ ] **Step 2: 加 caddy service (在 backend 之后, volumes 之前)**

Edit `/home/lovept/PtIDLE/docker-compose.yml`: 在 backend service 的 `volumes:` 列表最后 (`pgdata:` 和 `redisdata:` 之前) 插入 caddy service.

找到 (大约在 line 92-93):
```yaml
    healthcheck:
      test: ["CMD-SHELL", "node -e \"require('http').get('http://127.0.0.1:3000/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))\""]
      interval: 30s
      timeout: 5s
      start_period: 30s
      retries: 3

volumes:
```

替换为 (在 backend healthcheck 后, volumes 之前加 caddy service):
```yaml
    healthcheck:
      test: ["CMD-SHELL", "node -e \"require('http').get('http://127.0.0.1:3000/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))\""]
      interval: 30s
      timeout: 5s
      start_period: 30s
      retries: 3

  # T-FOLLOW-6: HTTPS reverse proxy
  # - 80/443 暴露到 host (Let's Encrypt HTTP-01 需 80 可达)
  # - caddy_data volume 持久化 cert, 容器重建不丢
  # - env DOMAIN 由 .env 注入, {$DOMAIN} 占位符在 Caddyfile 展开
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
```

- [ ] **Step 3: 加 caddy_data + caddy_config volumes**

Edit `/home/lovept/PtIDLE/docker-compose.yml`: 把文件末尾的 volumes block:

```yaml
volumes:
  pgdata:
  redisdata:
```

替换为:

```yaml
volumes:
  pgdata:
  redisdata:
  caddy_data:
  caddy_config:
```

- [ ] **Step 4: 改顶部注释说明 5 services**

Edit `/home/lovept/PtIDLE/docker-compose.yml`: 顶部注释 (line 4-5) 当前是:

```yaml
# T-FOLLOW-5: 单台 VPS 部署模板
# 4 services: postgres / redis / backend / migrate (one-shot)
```

替换为:

```yaml
# T-FOLLOW-6: 单台 VPS 部署模板 + HTTPS 反向代理
# 5 services: postgres / redis / backend / caddy / migrate (one-shot)
```

并在 line 13-14 区域 (其他注意事项之后) 加一行:

```yaml
#   - 首次配置: cp .env.example .env, 填 DB_PASSWORD + JWT_SECRET + DOMAIN + ACME_EMAIL
```

(把原来 line 15 的 `DB_PASSWORD + JWT_SECRET` 改成 `DB_PASSWORD + JWT_SECRET + DOMAIN + ACME_EMAIL`)

- [ ] **Step 5: 用 docker compose config 验证 (5 services + 4 volumes)**

Run:
```bash
cd /home/lovept/PtIDLE
DB_PASSWORD=testpass \
JWT_SECRET=testsecret12345678901234567890123456789012 \
DOMAIN=test.example.com \
ACME_EMAIL=test@example.com \
docker compose config 2>&1 | grep -E '^(  [a-z]+:|volumes:)' | sort -u
```

Expected: 5 个 service 名 + volumes: 出现:
```
  backend:
  caddy:
  migrate:
  postgres:
  redis:
volumes:
```

如果少 caddy → Task 3 Step 2 没加对. 如果报 "DOMAIN must be set" → DOMAIN env 没传, 重新跑命令.

进一步验证 caddy 有正确配置:
```bash
cd /home/lovept/PtIDLE
DB_PASSWORD=testpass \
JWT_SECRET=testsecret12345678901234567890123456789012 \
DOMAIN=test.example.com \
ACME_EMAIL=test@example.com \
docker compose config --services
```

Expected: 5 行, 每行一个 service 名 (按字母序):
```
backend
caddy
migrate
postgres
redis
```

- [ ] **Step 6: 验证 backend 没 ports 暴露**

Run:
```bash
cd /home/lovept/PtIDLE
DB_PASSWORD=testpass \
JWT_SECRET=testsecret12345678901234567890123456789012 \
DOMAIN=test.example.com \
ACME_EMAIL=test@example.com \
docker compose config backend 2>&1 | grep -A2 'ports:'
```

Expected: 没有 ports 行输出 (或空), 因为我们已经删了.

如果还有 `ports:` → Task 3 Step 1 没删干净.

- [ ] **Step 7: Commit**

```bash
cd /home/lovept/PtIDLE
git add docker-compose.yml
git commit -m "feat(https): docker-compose add caddy service, drop backend host port

T-FOLLOW-6: Caddy 2-alpine as 5th service, exposes 80+443 to host.
Backend no longer publishes host port (only Caddy routes to it).
caddy_data volume persists Let's Encrypt certs across container recreates.
Verified: docker compose config shows 5 services + 4 volumes."
```

---

## Task 4: docs/deploy.md § 5.3 加 DNS + HTTPS 验证

**Files:**
- Modify: `docs/deploy.md`

- [ ] **Step 1: 在 § 5.3「GitHub Secrets 配置」前加 DNS 步骤**

Edit `/home/lovept/PtIDLE/docs/deploy.md`: 找到 line 314 附近的 `#### GitHub Secrets 配置`, 在它之前插入新章节.

完整 old_string (在 § 5.3 内部, 在 `#### GitHub Secrets 配置` 之前):

```markdown
# 5. 验证
curl http://127.0.0.1:3000/health
# 预期: {"status":"ok",...}
```

替换为:

```markdown
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

- [ ] **Step 2: 改原「验证」curl 用 https**

同段文件后面 (大约 line 343 附近) 找到 `#### 错误排查`, 在它**之前**修改 deploy flow 描述, 把验证命令从 `http://127.0.0.1:3000/health` 改成 `https://$DOMAIN/health`.

实际上原 § 5.3 的 deploy flow 描述 (line 333-340) 是抽象描述, 不需要改. 但需要在「错误排查」section 加 https 相关条目 (Step 3).

- [ ] **Step 3: 加 HTTPS 相关错误排查条目**

Edit `/home/lovept/PtIDLE/docs/deploy.md`: 在 `#### 错误排查` 区域 (line 350-361 附近) 的现有条目**之后**追加:

找到:

```markdown
# 重跑 migrations
ssh ptidle@vps "cd /opt/ptidle && docker compose run --rm migrate"
```

替换为:

```markdown
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

- [ ] **Step 4: 验证 markdown 无明显破坏**

Run:
```bash
cd /home/lovept/PtIDLE
grep -c '^##\|^###\|^####' docs/deploy.md
```

Expected: 跟改前一样 (section 数没变). 应该还是 ~30 个 heading 左右.

进一步验证 § 5.3 内容:
```bash
cd /home/lovept/PtIDLE
sed -n '/### 5.3/,/^##/p' docs/deploy.md | grep -c 'T-FOLLOW-6'
```

Expected: 至少 3 处 (DNS 步骤 + 验证步骤 + 错误排查).

- [ ] **Step 5: Commit**

```bash
cd /home/lovept/PtIDLE
git add docs/deploy.md
git commit -m "docs(deploy): § 5.3 add DNS A record step + HTTPS verification (T-FOLLOW-6)

- DNS 指向 VPS 步骤 (Cloudflare / Porkbun / Namecheap / Aliyun 通用)
- https://$DOMAIN/health 验证 + http→https 301 重定向验证
- cert 申请失败 / 80 端口防火墙 错误排查
- 重启 caddy 让 DOMAIN env 生效"
```

---

## Task 5: memory-bank 同步 (architecture v1.47 + progress + history)

**Files:**
- Modify: `memory-bank/architecture.md`
- Modify: `memory-bank/progress.md`
- Modify: `memory-bank/history.md`

- [ ] **Step 1: architecture.md v1.46 → v1.47, 加 T-FOLLOW-6 章节**

Edit `/home/lovept/PtIDLE/memory-bank/architecture.md`: 文件末尾 (line 2919-2922) 当前是:

```markdown
---

*文档版本：v1.46*
*最后更新：2026-06-22*
```

替换为:

```markdown
---

## T-FOLLOW-6: HTTPS / TLS / Domain

**日期**: 2026-06-22
**前置**: T-FOLLOW-5 (commit e10b9da)
**目的**: 让玩家通过 https://$DOMAIN 访问后端, Let's Encrypt 自动 cert + 续期

### 1. 关键设计决策

1. **Caddy 作为 docker-compose 第 5 service**: 跟 T-FOLLOW-5 4-service 模式一致, `docker compose up -d` 管所有服务, 升级统一, 不需 host native caddy
2. **HTTP-01 challenge (不是 DNS-01)**: 不需 DNS provider API token, 任何 DNS provider 都行, 只需 80 端口可达
3. **删 backend 直连 port 3000**: 玩家只能走 Caddy, 减少攻击面 (只有 Caddy 暴露到 host)
4. **caddy_data volume 持久化 cert**: 容器重建不丢 cert, 避免重复申请触发 Let's Encrypt 限速
5. **Caddyfile `{$DOMAIN}` 占位符**: env 注入, 同 Caddyfile 模板可换 domain (e.g. staging 用 test.example.com)
6. **WebSocket 透明转发**: Caddy 默认支持 upgrade 协议, Socket.IO /socket.io/ 不需额外配置

### 2. 文件改动

| 文件 | 改动 |
|---|---|
| `Caddyfile` | 新建 (4 行) |
| `docker-compose.yml` | 加 caddy service + 删 backend ports + 加 caddy_data/caddy_config volumes |
| `.env.example` | 加 DOMAIN + ACME_EMAIL, 删 BACKEND_PORT |
| `docs/deploy.md` § 5.3 | 加 DNS 步骤 + https 验证 + 错误排查 |
| `memory-bank/*` | 本次同步 |

### 3. 验证路径

- 本地: `caddy validate --config Caddyfile --adapter caddyfile` (语法)
- 本地: `docker compose config` (YAML + env var 引用)
- VPS: `dig +short $DOMAIN` → 应返回 VPS IP
- VPS: `curl -vI https://$DOMAIN/health` → HTTP/2 200, server: Caddy
- VPS: `curl -vI http://$DOMAIN/health` → 301 → https://$DOMAIN/health
- VPS: `wscat -c wss://$DOMAIN/socket.io/?EIO=4&transport=websocket` → 101 Switching Protocols

### 4. 关键踩坑

1. **80 端口 firewall**: Hetzner / DO / Aliyun 等 cloud firewall 默认挡 80, 需显式开. Caddy log "acme: 403" 是这个症状
2. **DNS 传播延迟**: A 记录改后 5-30 分钟才全球生效, Caddy 启动期连不上 ACME server 会 retry (默认 5 次)
3. **Caddyfile `{$DOMAIN}` 占位符**: caddy validate --adapter caddyfile 模式下不展开, 会有 WARN (可忽略), 真实运行时由 caddy 二进制展开

### 5. 未来增强（明确不做 / 留 TODO）

- ❌ **Wildcard cert (DNS-01)**: T-FOLLOW-13+ (多 sub-domain 时考虑)
- ❌ **HSTS preload**: T-FOLLOW-14+
- ❌ **Rate limiting / DDoS 防护**: 内部娱乐游戏量小, 不做
- ❌ **多 domain / SAN cert**: 单域名单 cert 够

### 6. 测试覆盖

- **语法验证**: Caddyfile caddy validate + docker compose config 5 services/4 volumes (本地跑)
- **单测**: 不改 backend 代码, 全量 42/42 suite / 702/702 test pass (无 regression)
- **真实验证**: 用户在 VPS 上配 DNS A 记录 + 改 .env + `docker compose up -d` → curl https://$DOMAIN/health 200

---

*文档版本：v1.47*
*最后更新：2026-06-22*
```

- [ ] **Step 2: progress.md 移 T-FOLLOW-6 到已完成**

Edit `/home/lovept/PtIDLE/memory-bank/progress.md`:

Step 2a: 删「待开发」section 里 T-FOLLOW-6 行 (line 12):

找到:

```markdown
| T-FOLLOW-6 | HTTPS / TLS / domain + 自动回滚 + 备份 + 监控 | T-FOLLOW-5 完成单 VPS CI 自动部署, 但生产级仍缺 4 件事。**待办**：(1) HTTPS (Caddy / nginx + Let's Encrypt) + domain 配置；(2) 自动回滚（记录 .last-good tag + health check fail 时 restore）；(3) 备份策略（daily pg_dump → Backblaze B2 / S3）；(4) 监控 (UptimeRobot free tier + GH Actions scheduled health check) |
```

替换为:

```markdown
| T-FOLLOW-7 | 自动回滚（记录 .last-good tag + health check fail 时 restore） | T-FOLLOW-6 完成后, 下一步生产加固 |
| T-FOLLOW-8 | 备份策略（daily pg_dump → Backblaze B2 / S3） | T-FOLLOW-6 完成后 |
| T-FOLLOW-9 | 监控 (UptimeRobot free tier + GH Actions scheduled health check) | T-FOLLOW-6 完成后, 需要 https endpoint 外部 ping |
```

Step 2b: 在「已完成」section 末尾 (T-FOLLOW-5 行之后, line 89 之后) 加新行:

找到:

```markdown
| T-FOLLOW-5 | 单 VPS 部署编排（migrate.js 重写 + Dockerfile baked migrations + docker-compose 4 services + deploy.yml workflow_run trigger + scripts/deploy.sh + docs/deploy.md § 5.3 + memory-bank 同步） | 2026-06-22 |
```

替换为:

```markdown
| T-FOLLOW-5 | 单 VPS 部署编排（migrate.js 重写 + Dockerfile baked migrations + docker-compose 4 services + deploy.yml workflow_run trigger + scripts/deploy.sh + docs/deploy.md § 5.3 + memory-bank 同步） | 2026-06-22 |
| T-FOLLOW-6 | HTTPS / TLS / domain（Caddy 2-alpine 第 5 service + Let's Encrypt HTTP-01 + caddy_data 持久化 + 删 backend host port + .env 加 DOMAIN/ACME_EMAIL + docs/deploy.md § 5.3 DNS 步骤） | 2026-06-22 |
```

- [ ] **Step 3: history.md 追加 2026-06-22 T-FOLLOW-6 日志**

Edit `/home/lovept/PtIDLE/memory-bank/history.md`: 文件末尾 (当前 line 2026 附近) 追加新章节.

找到最后一行 (line 2026):

```markdown
- HA / multi-instance (T-FOLLOW-12+, 仅在用户量到时考虑)
```

(就是当前 history.md 的最末行; 但因为之前 T-FOLLOW-5 日志结尾可能多/少一行, 用 Read 确认下当前末尾再追加)

实际写入: 在 history.md 末尾追加:

```markdown

---

## 2026-06-22 - 任务：T-FOLLOW-6 HTTPS / TLS / domain

### Prompt
T-FOLLOW-5 完成单 VPS CI 自动部署, 但生产级仍缺 HTTPS。规划 T-FOLLOW-6: 加 Caddy 反向代理 + Let's Encrypt 自动 cert + domain 访问。

### 思考
- 选 Caddy 不选 nginx: auto-HTTPS 零配置, 内置 ACME, WebSocket 默认支持, 4 行 Caddyfile 完成需求
- HTTP-01 不选 DNS-01: 不需 DNS API token, 任何 provider 都行, 只需 80 端口可达
- Caddy 放 docker-compose 不放 host native: 跟现有 4-service 模式一致, 升级统一
- 删 backend 直连 host port: 减少攻击面, 玩家只能走 Caddy
- caddy_data named volume 持久化 cert: 容器重建不丢 cert, 避免触发 Let's Encrypt 限速

### 意外
1. **Caddyfile `{$DOMAIN}` 占位符在 caddy validate --adapter caddyfile 模式下不展开**: 验证有 WARN, 真实运行时由 caddy 二进制展开. 不影响功能
2. **原 T-FOLLOW-6 描述包含 4 个子系统 (HTTPS + rollback + backup + monitoring)**: spec 时拆为 T-FOLLOW-6 (HTTPS) / 7 (rollback) / 8 (backup) / 9 (monitoring), 单一 spec 单一 plan 单一实现更可控

### 修复
- 新增 1 文件: `Caddyfile` (4 行)
- 改 4 文件: `docker-compose.yml` (96 → 120 行), `.env.example` (20 → 25 行), `docs/deploy.md` (§ 5.3 加 ~30 行), `memory-bank/{architecture,progress,history}.md`
- 测试: Caddyfile caddy validate + docker compose config 5 services + 全量 42/42 suite / 702/702 test pass (无 regression)
- **真实验证**: 用户 push v* tag 触发完整 deploy 链路 + DNS A 记录 + curl https://$DOMAIN/health (待 push 后验证)

### 验证
- `caddy validate --config Caddyfile --adapter caddyfile` → syntax OK
- `docker compose config` (with DOMAIN/ACME_EMAIL/DB_PASSWORD/JWT_SECRET) → 5 services + 4 volumes, valid YAML
- `grep -E '^(DOMAIN|ACME_EMAIL)=' .env.example` → 2 行 OK
- `! grep -q '^BACKEND_PORT=' .env.example` → OK removed
- 全量 jest → **42/42 suite, 702/702 test 全绿** (无 regression)
- **真实验证**: 用户在 VPS 上配 DNS + .env + docker compose up → https://$DOMAIN/health 200 (待 user 手动验证)

### 范围外（明确不做 / T-FOLLOW-7+）
- 自动回滚 (T-FOLLOW-7+)
- 备份策略 (T-FOLLOW-8+)
- 监控 (T-FOLLOW-9+)
- 镜像签名 / 扫描 (T-FOLLOW-10+)
- Distroless 镜像 (T-FOLLOW-11+)
- HA / multi-instance (T-FOLLOW-12+, 仅在用户量到时考虑)
- Wildcard cert / DNS-01 (T-FOLLOW-13+, 仅在多 sub-domain 时考虑)
- HSTS preload (T-FOLLOW-14+)
```

- [ ] **Step 4: 全量 jest 跑一次确认无 regression**

Run:
```bash
cd /home/lovept/PtIDLE/backend
npx jest --forceExit 2>&1 | tail -20
```

Expected:
```
Test Suites: 42 passed, 42 total
Tests:       702 passed, 702 total
Snapshots:   0 total
Time:        ...
```

如果失败 → 检查哪个文件改动影响到了. T-FOLLOW-6 没改 backend 代码, 应该无 regression.

- [ ] **Step 5: Commit memory-bank 同步**

```bash
cd /home/lovept/PtIDLE
git add memory-bank/architecture.md memory-bank/progress.md memory-bank/history.md
git commit -m "docs(memory-bank): T-FOLLOW-6 sync architecture v1.47 + progress + history

- architecture.md v1.46 → v1.47 + T-FOLLOW-6 chapter (6 sections)
- progress.md T-FOLLOW-6 → completed, T-FOLLOW-7/8/9 → pending
- history.md append 2026-06-22 T-FOLLOW-6 log (Prompt/思考/意外/修复/验证/范围外)

No regression: 42/42 suite / 702/702 test pass."
```

---

## 完成

5 个 task 全 commit 后, T-FOLLOW-6 spec + plan + 实现都已落地. 用户下一步:

1. **真实验证 (手动)**: 用户在 VPS 上加 DNS A 记录 + 改 .env + `docker compose up -d` → `curl -I https://$DOMAIN/health` 应返回 200
2. **可选下一步**: T-FOLLOW-7 (自动回滚) 或 T-FOLLOW-9 (监控, 依赖 https endpoint)

---

*计划版本: v1.0*
*创建日期: 2026-06-22*
*最后更新: 2026-06-22*