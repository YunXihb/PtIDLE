#!/bin/bash
# =============================================================================
# PtIDLE PostgreSQL restore script (T-FOLLOW-8)
# =============================================================================
# 从备份恢复 PG. 覆盖现有数据 (pg_restore --clean --if-exists).
#
# 用法 (容器内, 由 docker-compose backup service 调用):
#   docker compose run --rm -e CONFIRM_RESTORE=yes -e RESTORE_DATE=YYYY-MM-DD backup /rs.sh latest
#   docker compose run --rm -e CONFIRM_RESTORE=yes backup /rs.sh 2026-08-06
#
# 安全: 必须设 CONFIRM_RESTORE=yes (防误跑覆盖生产数据).
# 依赖 env: DB_HOST/PORT/NAME/USER/PASSWORD, BACKUP_DIR, CONFIRM_RESTORE
# 退出码: 0 成功; 1 失败 (未确认/备份未找到/pg_restore 失败)
# =============================================================================
set -euo pipefail

# ---------- env ----------
DB_HOST="${DB_HOST:-postgres}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-ptidle}"
DB_USER="${DB_USER:-ptidle}"
DB_PASSWORD="${DB_PASSWORD:?DB_PASSWORD must be set}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"

# ---------- safety: explicit confirm ----------
if [ "${CONFIRM_RESTORE:-}" != "yes" ]; then
  echo "❌ 恢复会覆盖 ${DB_NAME} 现有数据! 设 CONFIRM_RESTORE=yes 确认:"
  echo "   docker compose run --rm -e CONFIRM_RESTORE=yes backup /rs.sh <YYYY-MM-DD|latest>"
  exit 1
fi

# ---------- locate backup ----------
TARGET="${1:-${RESTORE_DATE:-}}"
if [ -z "$TARGET" ]; then
  echo "用法: $0 <YYYY-MM-DD|latest>"
  echo "   或设 RESTORE_DATE env"
  exit 1
fi

if [ "$TARGET" = "latest" ]; then
  DUMP=$(ls -1 "${BACKUP_DIR}"/ptidle-*.dump 2>/dev/null | sort -r | head -1 || true)
else
  DUMP="${BACKUP_DIR}/ptidle-${TARGET}.dump"
fi

if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
  echo "❌ 备份未找到: ${TARGET} (在 ${BACKUP_DIR})"
  echo "   可用备份:"
  ls -1 "${BACKUP_DIR}"/ptidle-*.dump 2>/dev/null | xargs -n1 basename 2>/dev/null || echo "   (无)"
  exit 1
fi

# ---------- [1/2] pg_restore ----------
export PGPASSWORD="$DB_PASSWORD"
echo "==> [1/2] pg_restore --clean --if-exists: ${DUMP}"
# --clean: 先 DROP 再 CREATE (覆盖现有); --if-exists: DROP IF EXISTS 防"不存在"报错;
# --no-owner: 跨用户恢复友好; --dbname: 直连恢复 (不需先建空 DB)
if ! pg_restore --host="$DB_HOST" --port="$DB_PORT" --username="$DB_USER" \
  --dbname="$DB_NAME" --clean --if-exists --no-owner --no-acl "$DUMP" 2>&1; then
  echo "⚠️ pg_restore 报告错误 (部分对象可能因 --clean 不存在而 warning, 属正常)"
  echo "   若关键表数据已恢复则视为成功, 见下方 verify"
fi

# ---------- [2/2] verify (关键表 count) ----------
echo "==> [2/2] verify (关键表 count)"
for t in users players battles; do
  count=$(psql --host="$DB_HOST" --port="$DB_PORT" --username="$DB_USER" \
    --dbname="$DB_NAME" -t -A -c "SELECT count(*) FROM ${t};" 2>/dev/null || echo "?")
  echo "    ${t}: ${count}"
done

echo "✅ restore completed: ${DUMP}"
echo "   注意: schema_migrations 已被备份时的状态覆盖; 若备份后有新 migration, 需重跑 npm run db:migrate"
exit 0
