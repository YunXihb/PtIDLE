# T-FOLLOW-7 自动回滚 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 T-FOLLOW-5/6 (deploy workflow + HTTPS) 之上加自动回滚安全网 — 新版本 health check 失败时, deploy.sh 自动拉回 `.last_good` 记录的旧 image 并重启, deploy.yml 显示 green (旧版本恢复服务)

**Architecture:** `scripts/deploy.sh` 在原 4 步 (pull/migrate/restart/health check) 之上, 启动时读 `/opt/ptidle/.last_good` (上次成功 deploy 的 image digest) 到 `PREV_GOOD` 变量; health check 30s 失败时进入回滚分支 (拉 PREV_GOOD → restart → 15s health check); 仅 deploy 成功时写新 digest 到 `.last_good`. `docker-compose.yml` 的 backend image 改 `${BACKEND_IMAGE:-...}` 模式, 回滚时通过 env var 覆盖拉指定 digest.

**Tech Stack:** Bash (shell 脚本), Docker Compose v2 (env var override), `/opt/ptidle/.last_good` (单行 text 文件), GitHub Actions (复用现有 deploy.yml, 不改)

**前置任务:** T-FOLLOW-5 (单 VPS 部署, commit e10b9da) + T-FOLLOW-6 (HTTPS, commit 5bfc670)

**Spec:** `docs/superpowers/specs/2026-06-25-tfollow7-auto-rollback-design.md` (commit a000a8b)

---

## File Structure

| 文件 | 改动 | 用途 |
|---|---|---|
| `scripts/deploy.sh` | 改 (38 → ~75 行) | 加 .last_good 读/写 + 回滚分支 (核心) |
| `docker-compose.yml` | 改 (118 → ~120 行) | backend image 改 env var override 模式 |
| `.env.example` | 改 (25 → ~28 行) | 加 BACKEND_IMAGE 默认值 |
| `docs/deploy.md` § 5.3 + § Q4 | 改 (~520 → ~555 行) | 加 auto-rollback 段 + 整合 § Q4 单一权威源 |
| `memory-bank/architecture.md` | 改 (v1.47 → v1.48) | 加 T-FOLLOW-7 章节 |
| `memory-bank/progress.md` | 改 | T-FOLLOW-7 移入已完成 |
| `memory-bank/history.md` | 追加 | 2026-06-25 T-FOLLOW-7 日志 |

**测试策略**: deploy.sh 用 shellcheck + bash -n 静态检查; docker-compose 用 `python3 yaml.safe_load` 验证; .env.example 用 grep 验证; 集成测试在用户 VPS 手动跑 (spec § 6.2 列 5 场景).

---

## Task 1: scripts/deploy.sh 改造 (核心逻辑)

**Files:**
- Modify: `scripts/deploy.sh`

- [ ] **Step 1: 读当前 deploy.sh 确认状态**

Run:
```bash
cd /home/lovept/PtIDLE
wc -l scripts/deploy.sh
head -15 scripts/deploy.sh
```

Expected: `38 scripts/deploy.sh` 行数; 头部注释含 `T-FOLLOW-5: GitHub Actions deploy.yml`.

- [ ] **Step 2: 完整替换 scripts/deploy.sh**

Edit `/home/lovept/PtIDLE/scripts/deploy.sh`, **完整替换**文件全部内容为:

```bash
#!/bin/bash
# =============================================================================
# PtIDLE VPS deploy script (T-FOLLOW-7: +auto-rollback)
# =============================================================================
# T-FOLLOW-5: 基础流程 (4 步: pull / migrate / restart / health check)
# T-FOLLOW-7: 改造 — health check 失败时自动回滚到 .last_good
#
# T-FOLLOW-7 流程 (6 步 + 1 回滚分支):
#   [0/6] 读 .last_good → PREV_GOOD (用作回滚目标)
#   [1/6] pull latest image
#   [2/6] run migrations
#   [3/6] restart backend with :latest
#   [4/6] 30s health check
#   [5/6] pass → 写 .last_good 为新 digest → exit 0
#           fail → 进入回滚分支
#   [ROLLBACK] pull PREV_GOOD → restart → 15s health check → exit 0/1
#
# 输入 (env): DEPLOY_TS, GITHUB_SHA
# 失败: 退出码 1, GH Actions 显示红色
# =============================================================================

set -euo pipefail

cd /opt/ptidle

# T-FOLLOW-7 [0/6]: 启动时读 .last_good (用作回滚目标)
LAST_GOOD_FILE=/opt/ptidle/.last_good
PREV_GOOD=""
if [ -f "$LAST_GOOD_FILE" ]; then
  PREV_GOOD=$(cat "$LAST_GOOD_FILE")
  echo "==> [0/6] Previous good image: $PREV_GOOD"
fi

echo "==> [1/6] Pull latest backend image from GHCR"
docker compose pull backend

echo "==> [2/6] Run database migrations"
docker compose run --rm migrate

echo "==> [3/6] Restart backend (--force-recreate ensures new image is loaded)"
docker compose up -d --force-recreate backend

echo "==> [4/6] Wait for /health (max 30s)"
HEALTH_OK=false
for i in $(seq 1 30); do
  if docker compose exec -T backend node -e "require('http').get('http://127.0.0.1:3000/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))" 2>/dev/null; then
    HEALTH_OK=true
    echo "✅ Health check passed at attempt $i (sha=${GITHUB_SHA:-unknown}, ts=${DEPLOY_TS:-unknown})"
    break
  fi
  sleep 1
done

# T-FOLLOW-7 [5/6]: 成功路径 — 写 .last_good 为新 image digest
# 注意: docker inspect 失败 / 写盘失败 不应让 deploy 变 red
#       (deploy 实际成功, 仅是 .last_good 没持久化, 下次 deploy 无法回滚而已)
if [ "$HEALTH_OK" = true ]; then
  NEW_DIGEST=$(docker inspect --format='{{.Image}}' ptidle-backend 2>/dev/null || echo "")
  if [ -n "$NEW_DIGEST" ]; then
    if echo "$NEW_DIGEST" > "$LAST_GOOD_FILE" 2>/dev/null; then
      echo "==> [5/6] Recorded last-good image: $NEW_DIGEST"
    else
      echo "⚠️  [5/6] Could not write $LAST_GOOD_FILE (deploy succeeded, but next deploy can't auto-rollback)"
    fi
  else
    echo "⚠️  [5/6] Could not inspect new image digest (deploy succeeded, but .last_good not updated)"
  fi
  exit 0
fi

# T-FOLLOW-7 [ROLLBACK]: 失败路径 — 进入回滚分支
echo "❌ Health check failed after 30s"
echo "--- backend logs (last 50 lines) ---"
docker compose logs --tail=50 backend

# 无回滚目标 (首次 deploy)
if [ -z "$PREV_GOOD" ]; then
  echo "❌ No previous good image to roll back to (first deploy)"
  exit 1
fi

# 回滚
echo "==> [ROLLBACK] Rolling back to $PREV_GOOD"
if ! docker pull "$PREV_GOOD" 2>&1; then
  echo "❌ Rollback failed: cannot pull $PREV_GOOD"
  exit 1
fi

# 用 env var override 重启 backend
if ! BACKEND_IMAGE="$PREV_GOOD" docker compose up -d --force-recreate backend 2>&1; then
  echo "❌ Rollback failed: docker compose up exited non-zero"
  exit 1
fi

# 短健康检查 (15s)
echo "==> [ROLLBACK] Health check after rollback (max 15s)"
ROLLBACK_OK=false
for i in $(seq 1 15); do
  if docker compose exec -T backend node -e "require('http').get('http://127.0.0.1:3000/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))" 2>/dev/null; then
    ROLLBACK_OK=true
    echo "✅ Rollback succeeded at attempt $i"
    break
  fi
  sleep 1
done

if [ "$ROLLBACK_OK" = true ]; then
  echo "✅ Auto-rollback to $PREV_GOOD completed"
  exit 0
fi

echo "❌ Rollback also failed"
echo "--- backend logs (last 50 lines) ---"
docker compose logs --tail=50 backend
exit 1
```

- [ ] **Step 3: bash -n 语法检查**

Run:
```bash
cd /home/lovept/PtIDLE
bash -n scripts/deploy.sh && echo "OK: bash syntax valid" || echo "FAIL: syntax error"
```

Expected: `OK: bash syntax valid`

- [ ] **Step 4: shellcheck 静态分析 (如已安装)**

Run:
```bash
cd /home/lovept/PtIDLE
if command -v shellcheck >/dev/null 2>&1; then
  shellcheck scripts/deploy.sh && echo "OK: shellcheck clean" || echo "FAIL: shellcheck warnings"
else
  echo "SKIP: shellcheck not installed (not blocking, recommend installing for CI later)"
fi
```

Expected: `OK: shellcheck clean` 或 `SKIP: shellcheck not installed` (后者不阻塞).

如果 shellcheck 报 SC2086 (未引号变量) 或其他 warning, 修代码让其过. 常见: `$PREV_GOOD` 在 echo 里已引号, BACKEND_IMAGE 在 env var override 时已引号, 都 OK.

- [ ] **Step 5: 验证关键元素都在文件里**

Run:
```bash
cd /home/lovept/PtIDLE
grep -c 'T-FOLLOW-7' scripts/deploy.sh
grep -q 'LAST_GOOD_FILE=/opt/ptidle/.last_good' scripts/deploy.sh && echo "OK: LAST_GOOD_FILE defined" || echo "FAIL"
grep -q 'PREV_GOOD' scripts/deploy.sh && echo "OK: PREV_GOOD used" || echo "FAIL"
grep -q '\[0/6\]' scripts/deploy.sh && echo "OK: step [0/6]" || echo "FAIL"
grep -q '\[5/6\]' scripts/deploy.sh && echo "OK: step [5/6]" || echo "FAIL"
grep -q '\[ROLLBACK\]' scripts/deploy.sh && echo "OK: rollback branch" || echo "FAIL"
grep -q 'BACKEND_IMAGE=' scripts/deploy.sh && echo "OK: BACKEND_IMAGE override" || echo "FAIL"
```

Expected: 全部 `OK:` 输出. 第一个 grep 应返回 `9` (9 处 T-FOLLOW-7 引用).

- [ ] **Step 6: Commit**

```bash
cd /home/lovept/PtIDLE
git add scripts/deploy.sh
git commit -m "feat(rollback): deploy.sh 加 .last_good 读/写 + 回滚分支 (T-FOLLOW-7)

T-FOLLOW-7 流程 (6 步 + 1 回滚分支):
  [0/6] 读 /opt/ptidle/.last_good → PREV_GOOD
  [1-4/6] 原 4 步 (pull / migrate / restart / health check)
  [5/6] success → 写新 digest 到 .last_good
  [ROLLBACK] health fail → 拉 PREV_GOOD + restart + 15s health check

特性:
- 触发: 仅 health check 30s 失败 (migrate/pull 失败不触发)
- .last_good 写失败/inspect 失败: 仅 warning, deploy 仍 exit 0
- 首次 deploy (无 .last_good) → fail loud exit 1
- 回滚失败 → exit 1 + dump logs, 用户 SSH 介入 (无自动重试)"
```

---

## Task 2: docker-compose.yml backend image 改 env var override

**Files:**
- Modify: `docker-compose.yml` (line 66, backend service 的 image 字段)

- [ ] **Step 1: 读当前 docker-compose.yml 确认 backend image 行**

Run:
```bash
cd /home/lovept/PtIDLE
grep -n 'image: ghcr.io/yunxihb/ptidle-backend' docker-compose.yml
```

Expected: 看到两行匹配 (line 49 migrate service + line 66 backend service). 重点关注 line 66:

```yaml
  backend:
    image: ghcr.io/yunxihb/ptidle-backend:latest
```

- [ ] **Step 2: 改 backend service 的 image 为 env var override**

Edit `/home/lovept/PtIDLE/docker-compose.yml`, line 66:

把:
```yaml
  backend:
    image: ghcr.io/yunxihb/ptidle-backend:latest
```

改为:
```yaml
  backend:
    # T-FOLLOW-7: env var override 模式
    # 正常 deploy: BACKEND_IMAGE 默认 :latest, docker compose pull 会拉新
    # 回滚时:     BACKEND_IMAGE=$prev_good 传进去, 用指定 digest
    image: ${BACKEND_IMAGE:-ghcr.io/yunxihb/ptidle-backend:latest}
```

**注意**: 只改 `image:` 那一行, 加 3 行注释. 不要动 migrate service 的 image 字段 (line 49), 它保持原样 (拉 same image 但不覆盖).

- [ ] **Step 3: 验证改对了**

Run:
```bash
cd /home/lovept/PtIDLE
grep -n 'BACKEND_IMAGE' docker-compose.yml
```

Expected: 输出 line 65 (注释) + line 68 (`image: ${BACKEND_IMAGE:-...}`):
```
65:    # T-FOLLOW-7: env var override 模式
66:    # 正常 deploy: BACKEND_IMAGE 默认 :latest, docker compose pull 会拉新
67:    # 回滚时:     BACKEND_IMAGE=$prev_good 传进去, 用指定 digest
68:    image: ${BACKEND_IMAGE:-ghcr.io/yunxihb/ptidle-backend:latest}
```

- [ ] **Step 4: YAML 语法验证**

Run:
```bash
cd /home/lovept/PtIDLE
python3 -c "import yaml; yaml.safe_load(open('docker-compose.yml')); print('OK: YAML valid')"
```

Expected: `OK: YAML valid`

- [ ] **Step 5: 用 docker compose config 验证 env var 展开 (用 dummy 值)**

Run:
```bash
cd /home/lovept/PtIDLE
DB_PASSWORD=testpass \
JWT_SECRET=testsecret12345678901234567890123456789012 \
DOMAIN=test.example.com \
docker compose config --services 2>&1
```

Expected: 输出 5 个 service 名 (postgres / redis / backend / caddy / migrate), backend 仍能识别.

- [ ] **Step 6: Commit**

```bash
cd /home/lovept/PtIDLE
git add docker-compose.yml
git commit -m "feat(rollback): docker-compose backend image 改 env var override (T-FOLLOW-7)

image 字段从硬编码 :latest 改为 \${BACKEND_IMAGE:-...} 模式:
- 默认 :latest (常规 deploy 行为不变, docker compose pull 拉新)
- 回滚时 deploy.sh 临时设 BACKEND_IMAGE=\$PREV_GOOD, 用指定 digest

migrate service 的 image 不动 (仍拉 :latest 用于一次性迁移)"
```

---

## Task 3: .env.example 加 BACKEND_IMAGE 默认值

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: 读当前 .env.example 确认状态**

Run:
```bash
cd /home/lovept/PtIDLE
cat .env.example
wc -l .env.example
```

Expected: 25 行 (T-FOLLOW-6 收尾版本), 末尾是 ACME_EMAIL 那段.

- [ ] **Step 2: 追加 BACKEND_IMAGE 到文件末尾**

用 Read tool 读 `/home/lovept/PtIDLE/.env.example` 全文 (Step 1 已有).

然后用 Edit tool, old_string 用文件**最末 2 行**:

```bash
# ACME_EMAIL: Let's Encrypt cert 过期前会发邮件, 填可接收邮件的地址
ACME_EMAIL=CHANGE_ME_TO_YOUR_EMAIL
```

new_string 替换为:

```bash
# ACME_EMAIL: Let's Encrypt cert 过期前会发邮件, 填可接收邮件的地址
ACME_EMAIL=CHANGE_ME_TO_YOUR_EMAIL

# T-FOLLOW-7: Backend image override
# 默认 :latest (常规 deploy 走这个)
# 回滚时由 scripts/deploy.sh 临时覆盖 (不写进 .env, 仅 shell 变量)
BACKEND_IMAGE=ghcr.io/yunxihb/ptidle-backend:latest
```

(即: 保留原 ACME_EMAIL 末尾 2 行不动, 在其后追加 1 空行 + 1 注释 + 1 注释 + 1 配置行 = 4 行)

- [ ] **Step 3: 验证 BACKEND_IMAGE 在文件里**

Run:
```bash
cd /home/lovept/PtIDLE
grep -E '^BACKEND_IMAGE=' .env.example
wc -l .env.example
```

Expected:
```
BACKEND_IMAGE=ghcr.io/yunxihb/ptidle-backend:latest
28 .env.example
```

(行数从 25 → 28, 加 1 空行 + 1 注释 + 1 注释 + 1 配置行 = 4 行, 但 wc -l 计 28 是因为末尾换行. 实际 25 + 3 新行 + 1 末尾 = 28, 取决于原文件末尾是否有换行. 接受 28-29 都算 OK.)

- [ ] **Step 4: Commit**

```bash
cd /home/lovept/PtIDLE
git add .env.example
git commit -m "feat(rollback): .env.example 加 BACKEND_IMAGE 默认值 (T-FOLLOW-7)

用户**永远不需要手动改这个值**. .env 里的值仅作「正常 deploy 时的
默认值」. deploy.sh 回滚时临时设 shell 变量覆盖 (不写进 .env).

docker-compose.yml 用 \${BACKEND_IMAGE:-...} 模式读取此默认值."
```

---

## Task 4: docs/deploy.md § 5.3 加 auto-rollback 段 + § Q4 整合

**Files:**
- Modify: `docs/deploy.md` (§ 5.3 加 3 段新内容, § Q4 改写整合)

- [ ] **Step 1: 读当前 docs/deploy.md § 5.3 + § Q4 确认状态**

Run:
```bash
cd /home/lovept/PtIDLE
grep -n '^####\|^### ' docs/deploy.md
```

Expected: § 5.3 在 line 282 附近, 现有 `#### 一次性 VPS 配置` / `#### GitHub Secrets 配置` / `#### 自动部署流程` / `#### 手动重跑 deploy` / `#### 错误排查` 等段. § Q4 在 line 511 附近.

- [ ] **Step 2: 在 § 5.3 「自动部署流程」后加 3 个新段**

Edit `/home/lovept/PtIDLE/docs/deploy.md`, 在 `#### 手动重跑 deploy（不发布新版本）` 段**之前**插入 3 个新段 (即在 line `#### 手动重跑 deploy` 之前).

**先找到定位字符串** (用 Edit 工具, old_string 必须唯一):

```markdown
#### 手动重跑 deploy（不发布新版本）
```

**新插入内容** (插入到此行之前):

````markdown
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

````

- [ ] **Step 3: 改写 § Q4 「如何回滚到旧版本?」整合到 § 5.3**

Edit `/home/lovept/PtIDLE/docs/deploy.md`, § Q4 (line ~511):

把原:
```markdown
### Q4: 如何回滚到旧版本？

```bash
# 拉旧版（commit SHA 来自 git log）
docker pull ghcr.io/yunxihb/ptidle-backend:abc1234

# 重新跑 docker run, IMAGE 换 tag
docker run ... ghcr.io/yunxihb/ptidle-backend:abc1234
```

Migrations 是向前兼容的（不删除列），所以降级代码不需要回滚 schema。如果遇到 schema 不兼容，需要在 dev 环境先 `db:migrate` 试验新版本，再部署。
```

改为:
```markdown
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
```

**关键**: 顶部加 1 行说明「单 VPS 走 T-FOLLOW-7 自动回滚」, 保留原 `docker run` 手动回滚命令 (用于单机部署场景, 不走 deploy.sh).

- [ ] **Step 4: 验证关键段都在文件里**

Run:
```bash
cd /home/lovept/PtIDLE
grep -n 'T-FOLLOW-7' docs/deploy.md
grep -n '#### 自动回滚' docs/deploy.md
grep -n '#### 查看/手动覆盖' docs/deploy.md
grep -n '#### 回滚失败排查' docs/deploy.md
```

Expected: `T-FOLLOW-7` 至少出现 3-4 次 (header + body), 3 个新 `####` 段都在.

- [ ] **Step 5: Commit**

```bash
cd /home/lovept/PtIDLE
git add docs/deploy.md
git commit -m "docs(deploy): § 5.3 加 auto-rollback 段 + § Q4 整合 (T-FOLLOW-7)

§ 5.3 新增 3 段:
- 自动回滚 (T-FOLLOW-7): 触发 / 目标 / 行为
- 查看/手动覆盖 .last_good: cat / 比对 / 强制回滚
- 回滚失败排查: SSH 看 logs / 验 image 可拉 / 手动指定更早 tag

§ Q4 改写: 顶部加 1 行指向 § 5.3 (单 VPS 走自动回滚), 保留原 docker
run 手动回滚命令 (用于单机部署场景, 不走 deploy.sh). 单一权威源."
```

---

## Task 5: memory-bank 同步 (architecture + progress + history)

**Files:**
- Modify: `memory-bank/architecture.md` (v1.47 → v1.48, 加 T-FOLLOW-7 章节)
- Modify: `memory-bank/progress.md` (T-FOLLOW-7 移入已完成)
- Modify: `memory-bank/history.md` (追加 2026-06-25 T-FOLLOW-7 日志)

- [ ] **Step 1: 读 architecture.md 顶部确认当前 version**

Run:
```bash
cd /home/lovept/PtIDLE
head -10 memory-bank/architecture.md
grep -n '^# PtIDLE Architecture' memory-bank/architecture.md
```

Expected: 顶部有 `# PtIDLE Architecture (v1.47)` 类似 header (T-FOLLOW-6 收尾版本).

- [ ] **Step 2: 改 architecture.md version + 加 T-FOLLOW-7 章节**

Edit `/home/lovept/PtIDLE/memory-bank/architecture.md`:

1. 顶部 version header (line ~1-3 区域) 改 `v1.47` → `v1.48` (用 grep 找具体位置: `grep -n 'v1\.47' memory-bank/architecture.md`)
2. 在文件末尾 (在最后 `*文档版本：v1.47*` 那行**之前**) 加 T-FOLLOW-7 章节. Edit old_string 用:

```markdown
### 6. 测试覆盖

- **语法验证**: Caddyfile caddy validate + docker compose config 5 services/4 volumes (本地跑)
- **单测**: 不改 backend 代码, 全量 42/42 suite / 702/702 test pass (无 regression)
- **真实验证**: 用户在 VPS 上配 DNS A 记录 + 改 .env + `docker compose up -d` → curl https://$DOMAIN/health 200

---

*文档版本：v1.47*
*最后更新：2026-06-22*
```

new_string 替换为 (在 v1.47 footer 前加 T-FOLLOW-7 章节):

```markdown
### 6. 测试覆盖

- **语法验证**: Caddyfile caddy validate + docker compose config 5 services/4 volumes (本地跑)
- **单测**: 不改 backend 代码, 全量 42/42 suite / 702/702 test pass (无 regression)
- **真实验证**: 用户在 VPS 上配 DNS A 记录 + 改 .env + `docker compose up -d` → curl https://$DOMAIN/health 200

## T-FOLLOW-7 自动回滚 (2026-06-25)

### 目标
deploy.sh 加自动回滚 — health check 失败时自动切回上一个 known-good image.

### 关键组件
1. **`scripts/deploy.sh`** — 6 步 + 1 回滚分支
   - `[0/6]` 读 `/opt/ptidle/.last_good` → `PREV_GOOD`
   - `[1-4/6]` 原 4 步 (pull / migrate / restart / health check 30s)
   - `[5/6]` success → `docker inspect` 拿新 digest → 写入 `.last_good`
   - `[ROLLBACK]` health fail → 拉 PREV_GOOD + restart + 15s health check
2. **`/opt/ptidle/.last_good`** — VPS 上单行 text 文件, 存上次成功 deploy 的 image ref (digest)
3. **`docker-compose.yml` backend image** — 改 `${BACKEND_IMAGE:-...}` 模式, 回滚时通过 env var 覆盖

### 触发条件
- **仅 health check 30s 失败** → 进入回滚分支
- **migrate 失败 / 拉镜像失败** → 不回滚, exit 1, 用户判断

### 更新时机
- **仅 deploy 成功后**写 `.last_good`
- 避免「连续 deploy 都坏」时 `.last_good` 被覆盖成坏状态

### 关键假设
- **Migrations forward-only 且 additive** (T-FOLLOW-6 Q4 已明确)
- 回滚代码到 N-1 时, DB schema 仍是 N 的状态; 旧代码不引用新列, 可正常运行
- 违反此假设的 migration → 自动回滚救不回来, 用户需手动介入

### 数据流
- 首次 deploy: 无 `.last_good` → 失败 → exit 1 loud (无回滚目标)
- Happy path: deploy 成功 → `.last_good` 覆盖为新 digest → exit 0
- 回滚成功: 拉 PREV_GOOD → restart → 15s health pass → exit 0 (deploy.yml green)
- 回滚失败: 拉失败 / compose 失败 / health fail → exit 1 + dump logs (deploy.yml red, 用户 SSH 介入)

### 不做 (YAGNI)
- ❌ 深 health check (DB/Redis ping / 5xx 率) — T-FOLLOW-9 监控
- ❌ 蓝绿/金丝雀 — 单 VPS 不需要
- ❌ 自动重试 / 循环检测 — 回滚失败 → 用户介入
- ❌ multi-image `.last_good` (保留 N 个 good tag) — 单 deploy 失败概率极低
- ❌ 改 GH Actions deploy.yml — deploy.sh 行为已变, yml 不动

---

*文档版本：v1.48*
*最后更新：2026-06-25*
```

(即: 在 `*文档版本：v1.47*` 前插入 T-FOLLOW-7 整段, 同时 footer version 改 v1.48 + 日期改 2026-06-25)

```markdown
## T-FOLLOW-7 自动回滚 (2026-06-25)

### 目标
deploy.sh 加自动回滚 — health check 失败时自动切回上一个 known-good image.

### 关键组件
1. **`scripts/deploy.sh`** — 6 步 + 1 回滚分支
   - `[0/6]` 读 `/opt/ptidle/.last_good` → `PREV_GOOD`
   - `[1-4/6]` 原 4 步 (pull / migrate / restart / health check 30s)
   - `[5/6]` success → `docker inspect` 拿新 digest → 写入 `.last_good`
   - `[ROLLBACK]` health fail → 拉 PREV_GOOD + restart + 15s health check
2. **`/opt/ptidle/.last_good`** — VPS 上单行 text 文件, 存上次成功 deploy 的 image ref (digest)
3. **`docker-compose.yml` backend image** — 改 `${BACKEND_IMAGE:-...}` 模式, 回滚时通过 env var 覆盖

### 触发条件
- **仅 health check 30s 失败** → 进入回滚分支
- **migrate 失败 / 拉镜像失败** → 不回滚, exit 1, 用户判断

### 更新时机
- **仅 deploy 成功后**写 `.last_good`
- 避免「连续 deploy 都坏」时 `.last_good` 被覆盖成坏状态

### 关键假设
- **Migrations forward-only 且 additive** (T-FOLLOW-6 Q4 已明确)
- 回滚代码到 N-1 时, DB schema 仍是 N 的状态; 旧代码不引用新列, 可正常运行
- 违反此假设的 migration → 自动回滚救不回来, 用户需手动介入

### 数据流
- 首次 deploy: 无 `.last_good` → 失败 → exit 1 loud (无回滚目标)
- Happy path: deploy 成功 → `.last_good` 覆盖为新 digest → exit 0
- 回滚成功: 拉 PREV_GOOD → restart → 15s health pass → exit 0 (deploy.yml green)
- 回滚失败: 拉失败 / compose 失败 / health fail → exit 1 + dump logs (deploy.yml red, 用户 SSH 介入)

### 不做 (YAGNI)
- ❌ 深 health check (DB/Redis ping / 5xx 率) — T-FOLLOW-9 监控
- ❌ 蓝绿/金丝雀 — 单 VPS 不需要
- ❌ 自动重试 / 循环检测 — 回滚失败 → 用户介入
- ❌ multi-image `.last_good` (保留 N 个 good tag) — 单 deploy 失败概率极低
- ❌ 改 GH Actions deploy.yml — deploy.sh 行为已变, yml 不动
```

- [ ] **Step 3: 改 progress.md — T-FOLLOW-7 移入已完成**

Edit `/home/lovept/PtIDLE/memory-bank/progress.md`:

找到 T-FOLLOW-7 那一行 (大概率在「## 待开发」section), 把状态从 `待开发` 改为 `✅ 已完成 (2026-06-25)`, 移到「## 已完成」section 末尾.

如果 progress.md 是表格形式 (e.g. `| T-FOLLOW-7 | ... | 待开发 |`), 改为 `✅ 已完成 (2026-06-25)`.

具体格式由 engineer 读 progress.md 后决定.

- [ ] **Step 4: 追加 history.md 日志**

Edit `/home/lovept/PtIDLE/memory-bank/history.md`, 在文件末尾追加:

```markdown
## 2026-06-25 - 任务：T-FOLLOW-7 自动回滚

### Prompt
在 T-FOLLOW-5/6 (deploy workflow + HTTPS) 之上加自动回滚安全网 — 新版本 health check 失败时 deploy.sh 自动拉回 .last_good 记录的旧 image 并重启.

### 思考
关键决策: 触发条件 (仅 health check 失败, 不动 migrate/pull) + 回滚目标 (.last_good 文件) + 更新时机 (仅成功后) 三者由用户确认简单方案. 零新依赖, 纯 shell + 1 文件 + 1 env var. 回滚失败不循环检测, loud exit + 用户介入. Migrations forward-only 假设沿用 T-FOLLOW-6 Q4.

### 意外
- .last_good 写失败 / docker inspect 失败: 不应让 deploy 变 red (deploy 实际成功), 改为仅 warning, deploy 仍 exit 0. 步号改为 [0/6] 到 [5/6] + [ROLLBACK] 共 6+1 步.

```

(注意末尾留 1 空行分隔)

- [ ] **Step 5: 验证 memory-bank 改对了**

Run:
```bash
cd /home/lovept/PtIDLE
head -5 memory-bank/architecture.md | grep -q 'v1.48' && echo "OK: architecture v1.48" || echo "FAIL: architecture version not updated"
grep -q 'T-FOLLOW-7 自动回滚' memory-bank/architecture.md && echo "OK: T-FOLLOW-7 section in architecture" || echo "FAIL"
grep -q 'T-FOLLOW-7' memory-bank/progress.md && echo "OK: T-FOLLOW-7 in progress" || echo "FAIL"
tail -20 memory-bank/history.md | grep -q 'T-FOLLOW-7 自动回滚' && echo "OK: T-FOLLOW-7 log appended" || echo "FAIL"
```

Expected: 4 个 `OK:` 输出.

- [ ] **Step 6: Commit**

```bash
cd /home/lovept/PtIDLE
git add memory-bank/architecture.md memory-bank/progress.md memory-bank/history.md
git commit -m "docs(memory-bank): T-FOLLOW-7 自动回滚 同步 (architecture v1.48 + progress + history)

architecture.md: v1.47 → v1.48, 加 T-FOLLOW-7 章节 (目标 / 组件 / 触发 /
更新时机 / 假设 / 数据流 / 不做项)

progress.md: T-FOLLOW-7 移入已完成 (✅ 2026-06-25)

history.md: 追加 2026-06-25 T-FOLLOW-7 日志 (Prompt / 思考 / 意外)"
```

---

## 验收清单 (Definition of Done)

每个 Task 完成后, 走 subagent-driven-development 三段:
- implementer → spec compliance review → code quality review
- 直接 Approve 才算完成

整体 DoD:
- [ ] Task 1: `scripts/deploy.sh` 改造, shellcheck + bash -n 通过, 6 步 + rollback 分支
- [ ] Task 2: `docker-compose.yml` backend image 改 env var pattern, YAML 验证通过
- [ ] Task 3: `.env.example` 加 `BACKEND_IMAGE=...:latest`
- [ ] Task 4: `docs/deploy.md` § 5.3 加 3 段 + § Q4 整合
- [ ] Task 5: `memory-bank/*` 同步 (architecture v1.48 + progress + history)
- [ ] **手动集成测试** (用户 VPS, spec § 6.2 列 5 场景):
  1. Happy path — 已有 v0.1.0 → 推 v0.2.0 (good) → health pass → `.last_good` 覆盖
  2. 健康失败 → 回滚成功 — v0.1.0 已有 → 推 v0.2.0-broken (改 /health 返 500) → 30s fail → 拉 v0.1.0 → 15s pass → deploy green
  3. 首次 deploy 失败 — 删 `.last_good` → 推 broken → fail loud exit 1
  4. 回滚也失败 — `.last_good` 写假 digest → 推 broken → 拉假 fail → exit 1
  5. 同 SHA 重复 deploy — pull (no-op) + restart + health pass
- [ ] **真实验证**: 在用户 VPS 上 push 一个故意坏的 tag → 观察 deploy.yml 显示 red → SSH 看 `.last_good` 仍在 / 容器已回旧版
- [ ] CI 仍全绿 (T-FOLLOW-7 不改业务代码, 测试不受影响)
- [ ] 5 个 commits 全部 push 到 origin/master

---

## 关联文档

- **Spec**: `docs/superpowers/specs/2026-06-25-tfollow7-auto-rollback-design.md` (commit a000a8b)
- **前置 Plan**: `docs/superpowers/plans/2026-06-22-tfollow6-https-tls-domain.md` (T-FOLLOW-6)
- **部署总览**: `docs/deploy.md` (T-FOLLOW-4 建, T-FOLLOW-5/6/7 增补)
- **架构文档**: `memory-bank/architecture.md` (v1.47 → v1.48)
- **历史日志**: `memory-bank/history.md` (T-FOLLOW-6 已记, T-FOLLOW-7 追加)
- **CLAUDE.md**: 项目规约, 文档位置

---

*计划版本：v1.0*
*创建日期：2026-06-25*
*最后更新：2026-06-25*
