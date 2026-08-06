#!/bin/bash
# =============================================================================
# PtIDLE PostgreSQL backup script (T-FOLLOW-8)
# =============================================================================
# pg_dump (custom format, compressed) + storage backend dispatch + prune.
# Storage 抽象: BACKUP_STORAGE=local (本实现) | b2 | s3 (TODO, 见 spec §七).
#
# 用法 (容器内, 由 docker-compose backup service 调用):
#   docker compose run --rm backup
#
# 依赖 env: DB_HOST/PORT/NAME/USER/PASSWORD, BACKUP_DIR, BACKUP_STORAGE,
#           RETENTION_DAILY, RETENTION_WEEKLY
# 退出码: 0 成功; 1 失败 (pg_dump/upload/磁盘不足/未知 storage)
# =============================================================================
set -euo pipefail

# ---------- env ----------
DB_HOST="${DB_HOST:-postgres}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-ptidle}"
DB_USER="${DB_USER:-ptidle}"
DB_PASSWORD="${DB_PASSWORD:?DB_PASSWORD must be set}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_STORAGE="${BACKUP_STORAGE:-local}"
RETENTION_DAILY="${RETENTION_DAILY:-14}"
RETENTION_WEEKLY="${RETENTION_WEEKLY:-8}"

DATE=$(date -u +%Y-%m-%d)
BACKUP_NAME="ptidle-${DATE}.dump"
TMP_FILE="${BACKUP_DIR}/.tmp-${BACKUP_NAME}"

# ---------- cleanup tmp on exit ----------
cleanup() {
  rm -f "$TMP_FILE" 2>/dev/null || true
}
trap cleanup EXIT

# ---------- storage abstraction ----------
# 统一接口: 本轮实现 local; b2/s3 留 TODO 分支 (打印明确错误 + return 1, 不静默成功)
upload_backup() {
  local src="$1"
  local name="$2"
  local dest="${BACKUP_DIR}/${name}"
  case "$BACKUP_STORAGE" in
    local) mv "$src" "$dest" ;;
    b2) echo "❌ TODO: BACKUP_STORAGE=b2 未实现 (见 spec §七 未来)"; return 1 ;;
    s3) echo "❌ TODO: BACKUP_STORAGE=s3 未实现 (见 spec §七 未来)"; return 1 ;;
    *) echo "❌ unknown BACKUP_STORAGE=$BACKUP_STORAGE (允许: local|b2|s3)"; return 1 ;;
  esac
}

list_backups() {
  case "$BACKUP_STORAGE" in
    local) ls -1 "${BACKUP_DIR}"/ptidle-*.dump 2>/dev/null | sort -r || true ;;
    b2|s3) echo "❌ TODO: list_backups 未实现 for $BACKUP_STORAGE" >&2; return 1 ;;
  esac
}

delete_backup() {
  local name="$1"
  local path="${BACKUP_DIR}/${name}"
  case "$BACKUP_STORAGE" in
    local) rm -f "$path" ;;
    b2|s3) echo "⚠️ TODO: delete_backup 未实现 for $BACKUP_STORAGE (跳过 $name)" >&2; return 1 ;;
  esac
}

# ---------- disk space check (>= 1GB) ----------
avail_kb=$(df -P "$BACKUP_DIR" 2>/dev/null | awk 'NR==2{print $4}')
if [ -z "$avail_kb" ] || [ "$avail_kb" -lt 1048576 ]; then
  echo "❌ 磁盘可用空间 < 1GB on ${BACKUP_DIR} (avail=${avail_kb:-unknown}KB), abort"
  exit 1
fi

# ---------- [1/3] pg_dump ----------
export PGPASSWORD="$DB_PASSWORD"
echo "==> [1/3] pg_dump -> ${BACKUP_NAME} (storage=${BACKUP_STORAGE})"
# --format=custom: 支持选择性恢复 + 并行恢复; --compress=9 内置压缩; --no-owner 跨环境恢复友好
pg_dump --host="$DB_HOST" --port="$DB_PORT" --username="$DB_USER" \
  --dbname="$DB_NAME" --format=custom --compress=9 --no-owner \
  --file="$TMP_FILE"
# 兼容 GNU stat (-c) 与 BSD stat (-f)
size=$(stat -c%s "$TMP_FILE" 2>/dev/null || stat -f%z "$TMP_FILE" 2>/dev/null || echo 0)
echo "    dump size: $(( size / 1024 )) KB"

# ---------- [2/3] upload ----------
echo "==> [2/3] upload (storage=${BACKUP_STORAGE})"
upload_backup "$TMP_FILE" "$BACKUP_NAME"

# ---------- [3/3] prune (daily N 天 + weekly M 个周一) ----------
echo "==> [3/3] prune (daily=${RETENTION_DAILY}, weekly=${RETENTION_WEEKLY})"

# 保留集: 最近 N 天 + 最近 M 个周一
declare -A keep=()
today=$(date -u +%Y-%m-%d)
# daily: 最近 RETENTION_DAILY 天
i=0
while [ "$i" -lt "$RETENTION_DAILY" ]; do
  d=$(date -u -d "${today} - ${i} day" +%Y-%m-%d 2>/dev/null) || break
  keep["$d"]=1
  i=$((i + 1))
done
# weekly: 最近 RETENTION_WEEKLY 个周一 (1=Mon..7=Sun, GNU date -u +%u)
dow=$(date -u +%u 2>/dev/null) || dow=1
if [ -n "$dow" ]; then
  last_mon=$(date -u -d "${today} - $((dow - 1)) day" +%Y-%m-%d 2>/dev/null) || last_mon=""
  j=0
  while [ "$j" -lt "$RETENTION_WEEKLY" ] && [ -n "$last_mon" ]; do
    d=$(date -u -d "${last_mon} - ${j} week" +%Y-%m-%d 2>/dev/null) || break
    keep["$d"]=1
    j=$((j + 1))
  done
fi

prune_count=0
prune_failed=0
# list_backups 已按日期降序
while IFS= read -r line; do
  [ -z "$line" ] && continue
  b=$(basename "$line")
  d="${b#ptidle-}"; d="${d%.dump}"
  if [ -z "${keep[$d]:-}" ]; then
    if delete_backup "$b"; then
      echo "    prune: $b"
      prune_count=$((prune_count + 1))
    else
      prune_failed=$((prune_failed + 1))
    fi
  fi
done < <(list_backups)

echo "    pruned ${prune_count} backup(s)" $([ "$prune_failed" -gt 0 ] && echo ", ${prune_failed} delete failed (non-fatal)")

# ---------- summary ----------
echo "✅ backup completed: ${BACKUP_NAME} ($(( size / 1024 )) KB), pruned ${prune_count}"
exit 0
