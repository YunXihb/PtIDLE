# T-FOLLOW-7 自动回滚 设计文档

**任务**：T-FOLLOW-7 - 新版本 health check 失败时，自动切回上一个 known-good image
**日期**：2026-06-25
**状态**：🟡 设计待用户审阅
**前置任务**：T-FOLLOW-5 (单 VPS 部署编排, 已完成) + T-FOLLOW-6 (HTTPS, 已完成)

---

## 一、目标

在 T-FOLLOW-5/6 (deploy workflow) 之上加「自动回滚」安全网。push tag 后如果新版本 health check 失败，VPS 自动 pull + restart 回上一个 known-good image，无需人工介入。

### 1.1 范围

- ✅ `scripts/deploy.sh` 改造：增加 `.last_good` 读写 + health check 失败时回滚分支
- ✅ `docker-compose.yml` 改：backend image 支持 env var 覆盖（`${BACKEND_IMAGE:-...}`）
- ✅ `.env.example` 加 `BACKEND_IMAGE` 默认值
- ✅ `.last_good` 文件 (VPS 上 `/opt/ptidle/.last_good`)：存上次成功 deploy 的 image ref (digest)
- ✅ `docs/deploy.md` § 5.3 加 auto-rollback 行为说明 + 手动回滚 + 回滚失败时 ops 排查
- ✅ 文档化「forward-only migrations」policy (T-FOLLOW-6 Q4 已有, 复用)

### 1.2 范围外（明确不做）

- ❌ 深健康检查（DB/Redis ping、5xx 率、smoke test 窗口）—— 不在 scope, 用户可能想未来 T-FOLLOW-9 (监控) 一起做
- ❌ 蓝绿部署 / 金丝雀发布 —— 单 VPS 不需要
- ❌ 自动重试 / 循环检测 —— 回滚失败 → 退出 + 让用户介入
- ❌ 多镜像管理 / 镜像 GC —— GHCR 不自动 GC, 单 VPS 容量不是问题
- ❌ 跨 VPS 协调 / HA —— 单 VPS 场景
- ❌ 改 GH Actions deploy.yml —— deploy.sh 行为已变, yml 不动
- ❌ 新增 docker service —— 回滚走原 `docker compose up` 路径

### 1.3 关键决策摘要

| 维度 | 选择 | 理由 |
|---|---|---|
| **触发条件** | 仅 health check 30s 失败 | 简单、零误触发；其他失败（pull/migrate）由用户判断 |
| **回滚目标** | `/opt/ptidle/.last_good` 文件 | 简单、可外部 `cat` 检查、不依赖 Docker 运行时状态 |
| **更新时机** | 仅 deploy 成功后更新 | 避免「连续 deploy 都坏」时 .last_good 被覆盖成坏状态 |
| **Image ref 格式** | digest (sha256:...) 完整 ref | 不可变、精确锁定 image content |
| **首次 deploy** | 无 .last_good → 失败 loud exit | 没有安全回滚目标 |

---

## 二、架构

### 2.1 改造范围

```
┌────────────────────────────────────────────────────────┐
│  T-FOLLOW-5/6 已有                                       │
│  ┌──────────────────┐                                  │
│  │ scripts/deploy.sh│  ← 改造: 加 .last_good + 回滚分支  │
│  └──────────────────┘                                  │
│           │ pull / migrate / restart / health check     │
│           ↓                                              │
│  ┌──────────────────────────────────────────┐           │
│  │ docker-compose.yml                       │           │
│  │  ┌──────────┐  image: ${BACKEND_IMAGE:-…} │  ← 改:  │
│  │  │ backend  │  ...                        │  ← env var│
│  │  └──────────┘                            │  ← override│
│  └──────────────────────────────────────────┘           │
│           ↑ 部署时 docker compose up 用 :latest         │
│           ↑ 回滚时 BACKEND_IMAGE=$prev_good docker compose up│
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│  T-FOLLOW-7 新增                                          │
│  ┌────────────────────────────────┐                    │
│  │ /opt/ptidle/.last_good          │ ← 新文件            │
│  │ "ghcr.io/.../ptidle-backend@   │   单行完整 ref      │
│  │  sha256:abc..."                 │   仅成功时写入       │
│  └────────────────────────────────┘                    │
└────────────────────────────────────────────────────────┘
```

### 2.2 关键设计原则

1. **回滚是安全网, 不是 critical path** —— 失败 deploy → 回滚；回滚也失败 → exit 1 + dump logs + 用户介入。不做重试、不做循环检测。
2. **.last_good 只反映「确定好用的 image」** —— 仅成功时更新；rollback 不更新（因为 rollback 后的 image 本来就是 `.last_good` 里的值, 无变化）。
3. **Migrations forward-only 假设** —— 回滚代码到 N-1 时, DB schema 仍是 N 的状态; 假设 N 的 migration 只是 additive (加列, 不删列/改类型/重命名), 旧代码不会引用新列, 可正常运行。
4. **零新依赖** —— 不加新 service, 不加新 workflow, 不加新 monitoring。纯 shell 脚本 + 1 个文件 + 1 个 env var。

### 2.3 文件改动清单

| 文件 | 改动 | 行数估算 |
|---|---|---|
| `scripts/deploy.sh` | 加 .last_good 读/写 + 回滚分支 | +35 / -5 |
| `docker-compose.yml` | backend image 改 `${BACKEND_IMAGE:-...}` | +1 / -1 |
| `.env.example` | 加 `BACKEND_IMAGE=ghcr.io/...:latest` | +2 |
| `docs/deploy.md` § 5.3 + § Q4 | 加 auto-rollback 段 + 回滚失败排查 | +35 / -5 |
| `memory-bank/architecture.md` | v1.47 → v1.48, 加 T-FOLLOW-7 章节 | (收尾) |
| `memory-bank/progress.md` | T-FOLLOW-7 移已完成 (实施后) | +1 / -1 |
| `memory-bank/history.md` | 追加 2026-06-25 T-FOLLOW-7 日志 | (收尾) |

总计 ~7 个文件，~75 行净增。

---

## 三、组件

### 3.1 `scripts/deploy.sh`（核心改造）

**当前 4 步核心**：pull → migrate → restart → 30s health check
**T-FOLLOW-7 改造**：在头/尾各加 1 步（读 / 写 `.last_good`）+ 1 个回滚分支

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

# T-FOLLOW-7: 失败路径 — 进入回滚分支
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

**关键变化**：
- 启动时读 `.last_good` → `PREV_GOOD` (in-memory, 仅本次 deploy 用)
- health check pass → `docker inspect` 拿新 digest, 写入 `.last_good`
- health check fail → 检查 `PREV_GOOD` 非空 → 拉 + restart + 15s 健康检查
- 回滚成功 → exit 0 (deploy.yml 显示 green)
- 回滚失败 → exit 1 (deploy.yml 显示 red) + dump logs
- 首次 deploy 无 `.last_good` → fail loud exit 1

### 3.2 `docker-compose.yml`（env var override）

**改一处**：backend service 的 `image:` 字段。

```yaml
services:
  # ... (postgres / redis / migrate 不变)

  backend:
    # T-FOLLOW-7: 改 image 为 env var override 模式
    # 正常 deploy: BACKEND_IMAGE 默认 :latest, docker compose pull 会拉新
    # 回滚时:     BACKEND_IMAGE=$prev_good 传进去, 用指定 digest
    image: ${BACKEND_IMAGE:-ghcr.io/yunxihb/ptidle-backend:latest}
    restart: unless-stopped
    # ... (其余不变: depends_on / environment / healthcheck)
```

**为什么这样改**：
- 默认值 `:latest` 跟当前行为完全一致 (常规 deploy)
- 回滚时传 `BACKEND_IMAGE=ghcr.io/...@sha256:abc` env var, `docker compose up` 读 compose 文件时用这个值
- 不影响正常 deploy (`BACKEND_IMAGE` 不设时, 用 `:latest` 默认)

### 3.3 `.env.example`（加 1 行）

在文件末尾加：

```bash
# T-FOLLOW-7: Backend image override
# 默认 :latest (常规 deploy 走这个)
# 回滚时由 scripts/deploy.sh 临时覆盖 (不写进 .env, 仅 shell 变量)
BACKEND_IMAGE=ghcr.io/yunxihb/ptidle-backend:latest
```

**说明**：用户**永远不需要手动改这个值**。`deploy.sh` 在回滚时临时设 shell 变量。`.env` 里的值仅作为「正常 deploy 时的默认值」。文档化此约束。

### 3.4 `/opt/ptidle/.last_good`（新文件, VPS 上）

**位置**：`/opt/ptidle/.last_good`
**格式**：单行 + 完整 image ref + digest
**示例**：`ghcr.io/yunxihb/ptidle-backend@sha256:a1b2c3d4e5f6...`
**生命周期**：
- 不存在 → 首次 deploy, 无回滚目标
- deploy 成功 → 覆盖为新 image digest
- deploy 失败 → 不动
- 手动操作 → 用户可 SSH 改写 (极端情况: 跳过某坏 deploy)

**外部检查**（SSH 进去）：

```bash
cat /opt/ptidle/.last_good
# ghcr.io/yunxihb/ptidle-backend@sha256:abc...

# 比对当前 running
docker inspect --format='{{.Image}}' ptidle-backend
# ghcr.io/yunxihb/ptidle-backend@sha256:def...   ← 不一致 = 正在跑非 .last_good
```

### 3.5 `docs/deploy.md` § 5.3（文档化）

**加 3 段**：

```markdown
#### 自动回滚 (T-FOLLOW-7)

T-FOLLOW-7 起, `scripts/deploy.sh` 会在 health check 失败时**自动回滚**:

- 触发: deploy 后 30s 内 `/health` 没返回 200
- 目标: `/opt/ptidle/.last_good` 里记录的上次成功 deploy 的 image
- 行为: 拉旧 image → 重启 → 15s 健康检查
  - 回滚成功 → deploy.yml 显示 green (旧版本恢复服务)
  - 回滚失败 → deploy.yml 显示 red + dump logs, 用户 SSH 介入

**首次 deploy 不会触发回滚** (无 `.last_good`)。`docs/deploy.md § Q4` 的 forward-only migrations 假设仍成立, 回滚代码可安全运行在新 schema 上 (旧代码不引用新列)。

#### 查看/手动覆盖 .last_good

```bash
# SSH 到 VPS
ssh ptidle@vps

# 查看当前 .last_good
cat /opt/ptidle/.last_good

# 比对当前 running
docker inspect --format='{{.Image}}' ptidle-backend

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

**也修改 § Q4**（Q4: 如何回滚到旧版本?）：把 Q4 的「手动回滚命令」删掉，合并到上面「查看/手动覆盖 .last_good」段，保持单一权威源。

---

## 四、数据流

### 4.1 首次 deploy（无 .last_good）

```
[User: git tag v0.1.0 && git push origin v0.1.0]
  ↓
[GH Actions: release.yml] build + push GHCR
  ↓
[GH Actions: deploy.yml] SSH → VPS → deploy.sh
  ↓
[VPS: deploy.sh]
  step 0: cat .last_good 2>/dev/null → "" (文件不存在)
  step 1: docker compose pull backend  → :latest
  step 2: docker compose run --rm migrate
  step 3: docker compose up -d --force-recreate backend
  step 4: health check 30s
  step 5a (pass):
    docker inspect → NEW_DIGEST
    echo $NEW_DIGEST > .last_good    ← 首次写入
    exit 0
  step 5b (fail):
    PREV_GOOD="" → echo "No previous good image" → exit 1
    用户 SSH 介入
```

### 4.2 第二次 deploy (有 .last_good, 假设成功)

```
[User: git tag v0.2.0 && git push origin v0.2.0]
  ↓
[GH Actions: deploy.yml] SSH → deploy.sh
  ↓
[VPS: deploy.sh]
  step 0: cat .last_good → "ghcr.io/...@sha256:v0.1_digest"  ← PREV_GOOD
  step 1-4: 同上 (pull v0.2 / migrate / restart / 30s health check)
  step 5a (pass):
    docker inspect → v0.2_digest
    echo v0.2_digest > .last_good   ← 覆盖
    exit 0
  step 5b (fail):
    进入回滚 → 见 § 4.3
```

### 4.3 回滚路径（health check 30s fail + PREV_GOOD 非空）

```
[VPS: deploy.sh — health check 30s fail]
  ↓
  echo "❌ Health check failed"
  echo "--- backend logs ---"
  docker compose logs --tail=50 backend
  ↓
  PREV_GOOD="ghcr.io/...@sha256:v0.1_digest"  (非空)
  ↓
  echo "==> [ROLLBACK] Rolling back to $PREV_GOOD"
  ↓
  docker pull "$PREV_GOOD"   ← 拉旧 image
  ↓ 失败 → exit 1 (image 不可达)
  ↓
  BACKEND_IMAGE="$PREV_GOOD" docker compose up -d --force-recreate backend
  ↓ 用 env var override, compose 启旧 image
  ↓ 失败 → exit 1 (compose error)
  ↓
  健康检查 15s
  ↓ pass → echo "✅ Rollback succeeded" → exit 0  ← deploy.yml green
  ↓ fail → echo "❌ Rollback also failed" + dump logs → exit 1  ← deploy.yml red
```

### 4.4 状态机

```
                ┌─────────────────┐
                │  Initial state  │
                │  (no .last_good)│
                └────────┬────────┘
                         │ first deploy starts
                         ↓
                ┌─────────────────┐
                │ Deploying v1    │
                │  (no rollback   │
                │   possible)     │
                └────────┬────────┘
                         │
              ┌──────────┴──────────┐
              ↓                     ↓
      health pass             health fail
              ↓                     ↓
   ┌──────────────────┐   ┌──────────────────┐
   │ Wrote .last_good │   │ Loud exit 1,     │
   │ = v1_digest      │   │ no rollback      │
   │ exit 0           │   │ (no target)      │
   └────────┬─────────┘   └──────────────────┘
            │
            │ next deploy
            ↓
   ┌──────────────────┐
   │ Deploying v2     │
   │  PREV_GOOD = v1  │
   │  (in memory)     │
   └────────┬─────────┘
            │
   ┌────────┴────────┐
   ↓                 ↓
health pass      health fail
   ↓                 ↓
Wrote .last_good   ┌──────────────────┐
= v2_digest         │ Rolling back     │
exit 0              │ to v1            │
                    └────────┬─────────┘
                             │
                  ┌──────────┴──────────┐
                  ↓                     ↓
            rollback pass         rollback fail
                  ↓                     ↓
           exit 0                exit 1 + dump
           (v1 still in          (user
            .last_good,          intervenes)
            no change)
```

---

## 五、错误处理

| 失败点 | 表现 | 处理 | 回滚? |
|---|---|---|---|
| `docker compose pull backend` 失败 | exit 1 | log + GH Actions 红 | ❌ (registry/infra) |
| `docker compose run --rm migrate` 失败 | exit 1 | log + dump | ❌ (DB 问题, 用户判断) |
| `docker compose up -d backend` 失败（罕见） | exit 1 | log | ❌ (container 起不来; 也会被 health check 抓) |
| **Health check 30s 失败** | **进入回滚分支** | **见下** | **✅** |
| `PREV_GOOD` 为空（首次 deploy） | exit 1 | log "no previous good image" | ❌ (无目标) |
| **回滚 `docker pull $PREV_GOOD` 失败** | exit 1 | log "cannot pull" | ❌ (image 不可达) |
| **回滚 `docker compose up` 失败** | exit 1 | log + dump | ❌ (compose error) |
| **回滚 health check 15s 失败** | exit 1 | log + dump logs | ❌ (新旧都坏; 用户介入) |

**设计原则**：
- 不自动重试（一次失败 loud exit, 用户看 deploy.yml 决策）
- 不循环检测（连续 deploy 坏 = 推回滚也坏, 也 loud exit, 不试图自动跳到 N-2）
- 不切到「hardcoded good」tag (YAGNI; 单 VPS 简单为先)

**回滚失败时 GH Actions UI 显示**：
- 红色 ❌
- 日志包含: 「Health check failed」+ 「Rolling back to ...」+ 「Rollback also failed」+ backend logs (last 50 lines)
- 用户 SSH 进去按 § 3.5 「回滚失败排查」文档操作

---

## 六、测试策略

### 6.1 单元 / 静态检查

| 测试 | 方法 | 通过标准 |
|---|---|---|
| **shellcheck 静态分析** | CI: `shellcheck scripts/deploy.sh` | exit 0, 无 SC2086/SC2154 警告 |
| **bash -n 语法检查** | CI: `bash -n scripts/deploy.sh` | exit 0 |
| **docker-compose 语法** | CI: `python3 -c "import yaml; yaml.safe_load(open('docker-compose.yml'))"` | exit 0 |
| **.env.example 完整性** | `grep -q BACKEND_IMAGE .env.example` | exit 0 |

### 6.2 集成测试（手动, 在用户 VPS 上）

| 场景 | 步骤 | 预期 |
|---|---|---|
| **Happy path** | 1. 已有 v0.1.0 deploy 成功 (.last_good 已写)<br>2. 推 v0.2.0 (假设 good)<br>3. 触发 deploy | health pass → .last_good 覆盖为 v0.2.0 digest → deploy green |
| **健康失败 → 回滚成功** | 1. 已有 v0.1.0 成功<br>2. 改代码让 `/health` 返回 500<br>3. 推 v0.2.0-broken<br>4. 触发 deploy | 30s health fail → 拉 v0.1.0 digest → restart → 15s health pass → deploy green; 容器跑 v0.1.0 |
| **首次 deploy (无 .last_good) 失败** | 1. 删 .last_good<br>2. 推 broken version<br>3. 触发 deploy | health fail → "No previous good image" → exit 1; deploy red |
| **回滚也失败 (image 不可达)** | 1. 写 .last_good = 假 digest `ghcr.io/...@sha256:0000...`<br>2. 推 broken version<br>3. 触发 deploy | 30s fail → 拉假 digest fail → exit 1; deploy red; 旧 .last_good 不动 |
| **同 SHA 重复 deploy** | 1. 已 deploy v0.1.0<br>2. 手动重跑 deploy workflow (无新 push) | pull (no-op) + restart + health pass → .last_good 仍 = v0.1.0 digest (覆盖为相同值, OK) |

### 6.3 验收清单 (Definition of Done)

- [ ] `scripts/deploy.sh` 改造完成, shellcheck + bash -n 通过
- [ ] `docker-compose.yml` backend image 改 env var pattern, YAML 验证通过
- [ ] `.env.example` 加 `BACKEND_IMAGE` 默认值
- [ ] `docs/deploy.md § 5.3` 加 auto-rollback + 排查 + § Q4 整合
- [ ] `memory-bank/architecture.md` v1.47 → v1.48, 加 T-FOLLOW-7 章节
- [ ] `memory-bank/progress.md` T-FOLLOW-7 移入已完成 (实施后)
- [ ] `memory-bank/history.md` 追加 2026-06-25 T-FOLLOW-7 日志
- [ ] **手动集成测试** 5 场景全过 (用户 VPS)
- [ ] CI 仍全绿 (T-FOLLOW-7 不改业务代码, 测试不受影响)
- [ ] **真实验证**: 在用户 VPS 上 push 一个故意坏的 tag → 观察 deploy.yml 显示 red → SSH 看 .last_good 仍在 / 容器已回旧版

### 6.4 风险与回退

| 风险 | 缓解 |
|---|---|
| `deploy.sh` bug 导致 deploy 全坏 | T-FOLLOW-7 改动是「在尾部加逻辑」, 核心 4 步不动; 万一坏, 用户可手动 SSH 跑原 4 步命令 (pull/migrate/up/health) |
| `.last_good` 写错 / 被损坏 | 文件是单行 text, 用户 SSH `echo X > .last_good` 即可修复 |
| `BACKEND_IMAGE` env var 污染 .env | 文档明示「不写进 .env」; deploy.sh 用 shell 临时变量 (`VAR=val command` 语法), 不 export, 不持久 |
| GH Actions 显示 green 但实际回滚 | 取决于 health check 准确性 (沿用 T-FOLLOW-5 的 30s /health 探测, 已知弱但够用) |

---

## 七、未来工作 (T-FOLLOW-8+)

| 任务 | 描述 | 优先级 |
|---|---|---|
| **T-FOLLOW-8** | 备份策略 (daily pg_dump → B2 / S3) | 中 |
| **T-FOLLOW-9** | 监控 (UptimeRobot free tier + GH Actions scheduled health check + 5xx 告警) | 中 |
| **T-FOLLOW-10** | 镜像签名 (cosign) + 扫描 (trivy) | 低 |
| **T-FOLLOW-11** | Distroless 镜像 (gcr.io/distroless/nodejs20) | 低 |
| **T-FOLLOW-12** | HA / multi-instance (load balancer + 2 VPS) | 低 (用户量到时) |
| **T-FOLLOW-13** | 蓝绿/金丝雀 deploy (深 health check + 流量切分) | 低 (单 VPS 暂不需要) |
| **T-FOLLOW-14** | 通用 forward-only migration lint (CI 拒绝「DROP COLUMN」/「RENAME」/「ALTER TYPE」) | 低 |
| **T-FOLLOW-15** | 回滚状态通知 (deploy.yml 加 Slack / Discord webhook) | 低 |
| **T-FOLLOW-16** | multi-image last_good (保留 N 个 good tag, 失败时跳到 N-2 而非仅 N-1) | 低 (单 deploy 失败概率极低) |

**T-FOLLOW-9 监控** 是 T-FOLLOW-7 的自然延伸：当前 health check 30s 内只能抓启动期崩溃; 加 UptimeRobot 外部 5xx 告警后, T-FOLLOW-7 的「仅 health check 失败」触发面能扩到「线上 5xx 风暴」, 那时会需要回滚触发机制从 deploy.sh 解耦到独立 monitor + rollback worker。当前不预先做。

---

## 八、关联文档

- **前置**：[T-FOLLOW-5 设计](commit e10b9da) — 单 VPS 部署 + deploy workflow
- **前置**：[T-FOLLOW-6 设计](commit bd8b838) — HTTPS / Caddy / domain
- **部署总览**：`docs/deploy.md` (T-FOLLOW-4 建, T-FOLLOW-5/6 增补, T-FOLLOW-7 再增补 § 5.3)
- **架构文档**：`memory-bank/architecture.md` v1.47 (T-FOLLOW-6 收尾)
- **历史日志**：`memory-bank/history.md` (T-FOLLOW-6 已记, T-FOLLOW-7 待追加)
- **项目规约**：根 `CLAUDE.md` 工作流 + 文档位置
- **回滚命令参考**：原 `docs/deploy.md § Q4` 「如何回滚到旧版本」文档, T-FOLLOW-7 实施时合并到 § 5.3 (单一权威源)

---

*文档版本：v1.0*
*创建日期：2026-06-25*
*最后更新：2026-06-25*
