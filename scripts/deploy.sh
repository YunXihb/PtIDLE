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