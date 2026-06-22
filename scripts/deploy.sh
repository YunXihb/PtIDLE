#!/bin/bash
# =============================================================================
# PtIDLE VPS deploy script
# =============================================================================
# T-FOLLOW-5: GitHub Actions deploy.yml 通过 SSH 在 VPS 上跑此脚本
# 流程: pull + migrate + restart + health check
#
# 触发: GH Actions workflow_run (release.yml 成功)
# 输入 (env): DEPLOY_TS, GITHUB_SHA
# 失败: 退出码 1, GH Actions 显示红色
# =============================================================================

set -euo pipefail

cd /opt/ptidle

echo "==> [1/4] Pull latest backend image from GHCR"
docker compose pull backend

echo "==> [2/4] Run database migrations"
docker compose run --rm migrate

echo "==> [3/4] Restart backend"
docker compose up -d backend

echo "==> [4/4] Wait for /health (max 30s)"
for i in $(seq 1 30); do
  if docker compose exec -T backend node -e "require('http').get('http://127.0.0.1:3000/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))" 2>/dev/null; then
    echo "✅ Health check passed at attempt $i (sha=${GITHUB_SHA:-unknown}, ts=${DEPLOY_TS:-unknown})"
    exit 0
  fi
  sleep 1
done

echo "❌ Health check failed after 30s"
echo "--- backend logs (last 50 lines) ---"
docker compose logs --tail=50 backend
exit 1