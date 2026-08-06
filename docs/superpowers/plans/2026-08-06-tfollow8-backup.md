# T-FOLLOW-8 备份策略 实施 Plan

**任务**：T-FOLLOW-8 - daily pg_dump + 保留策略 + 恢复流程 + storage 抽象
**日期**：2026-08-06
**设计**：`docs/superpowers/specs/2026-08-06-tfollow8-backup-design.md`
**状态**：🟡 待用户审阅

---

## 任务分解

### Task 1: `scripts/backup.sh`（核心备份脚本 + storage 抽象 + prune）
**实现**:
- `set -euo pipefail`
- 读 env: `DB_HOST/PORT/NAME/USER/PASSWORD`, `BACKUP_DIR`(默认 /backups), `BACKUP_STORAGE`(默认 local), `RETENTION_DAILY`(14), `RETENTION_WEEKLY`(8)
- 磁盘空间检查: `df` 检查 `BACKUP_DIR` 可用 < 1GB -> exit 1
- storage 抽象函数:
  - `upload_backup(tmp_file, name)`: local=`mv` 到 `$BACKUP_DIR`; b2/s3=打印 TODO + return 1
  - `list_backups()`: local=`ls $BACKUP_DIR/ptidle-*.dump`
  - `delete_backup(name)`: local=`rm`
- 备份: `pg_dump --format=custom --compress=9 --no-owner -f $TMP_FILE`（用 `PGPASSWORD` env 认证）
- 文件名: `ptidle-$(date -u +%Y-%m-%d).dump`
- prune: 列出备份按日期降序，标记最近 `RETENTION_DAILY` 天 + 最近 `RETENTION_WEEKLY` 个周一保留，其余 `delete_backup`
- summary: 打印备份名 + 大小 + prune 删除数
- trap 清理临时文件

**验证**: `bash -n`; dev PG 跑通生成 dump; `pg_restore -l dump` 列出内容

### Task 2: `scripts/restore.sh`（恢复脚本）
**实现**:
- 用法: `restore.sh <YYYY-MM-DD|latest>`
- 安全: 要求 `CONFIRM_RESTORE=yes` env，否则拒绝 + exit 1
- 定位备份: latest=按日期最新; 指定日期=精确匹配
- 恢复: `pg_restore --clean --if-exists --no-owner --dbname=$DB_NAME $DUMP`
- 验证: 查询关键表 count（users/players/battles）打印
- summary

**验证**: `bash -n`; dev PG 备份后插测试数据 -> restore -> 验证回到备份点; `CONFIRM_RESTORE` 缺失拒绝

### Task 3: `docker-compose.yml` + `.env.example`（backup service + 配置）
**实现**:
- docker-compose.yml 加 `backup` service:
  - `image: postgres:16`, `profiles: ["backup"]`
  - `environment`: DB_* + BACKUP_DIR=/backups + BACKUP_STORAGE/RETENTION_*
  - `volumes`: `./backups:/backups`, `./scripts/backup.sh:/bk.sh:ro`, `./scripts/restore.sh:/rs.sh:ro`
  - `command: ["/bk.sh"]`
  - `depends_on: postgres: service_healthy`
  - entrypoint 支持传参（跑 restore 时 `command: ["/rs.sh", "latest"]`）
- .env.example 加 `BACKUP_STORAGE=local` + `RETENTION_DAILY=14` + `RETENTION_WEEKLY=8` + 注释

**验证**: `docker compose config` 校验; `docker compose run --rm backup` 跑通（本地 dev 配置）

### Task 4: `.github/workflows/backup.yml`（scheduled workflow）
**实现**:
- `name: Backup`
- `on: schedule: cron '17 3 * * *'` + `workflow_dispatch`
- job `backup`: `runs-on: ubuntu-latest`, `timeout-minutes: 10`
- step: `appleboy/ssh-action@v1` 复用 `VPS_SSH_KEY/VPS_HOST/VPS_USER` secrets
- script: `cd /opt/ptidle && docker compose run --rm backup`
- YAML 校验: `python3 -c "import yaml; yaml.safe_load(...)"`

**验证**: YAML 合法; 结构对照 deploy.yml

### Task 5: `docs/deploy.md` 备份章节
**实现**:
- 加 § 六 备份与恢复（或合适章节号）
- 子节: 频率与保留 / 备份存储 / 恢复流程（restore.sh 用法 + CONFIRM_RESTORE）/ 排查（磁盘满/pg_dump 失败/GH red）/ 未来加 B2-S3 提示

**验证**: grep 章节标题存在; 内容覆盖 spec § 三.6

### Task 6: 本地验证（dev PG 容器）
**实现**:
- 在 dev PG（ptidle-dev-pg）跑 backup.sh: `docker run --rm --network=host -e DB_HOST=localhost -e DB_PORT=5433 ... -v ./backups:/backups postgres:16 /bk.sh`（或 docker exec）
- 验证 dump 生成 + `pg_restore -l`
- prune 验证: 造 20+ 假日期文件，跑 prune，验证 daily14+weekly8 保留
- restore 验证: 备份 -> 插测试数据 -> restore -> 验证回退
- storage 抽象: `BACKUP_STORAGE=b2` 验证 TODO + exit 1

**验证**: 全部通过

### Task 7: memory-bank 同步 + commit
**实现**:
- `memory-bank/architecture.md`: 加 T-FOLLOW-8 备份段落（组件/数据流/决策）
- `memory-bank/progress.md`: T-FOLLOW-8 从"待开发"移到"已完成"
- `memory-bank/history.md`: 追加 2026-08-06 T-FOLLOW-8 日志
- commit（不 push，等用户批准）

**验证**: git status 干净; 文档一致

---

## 依赖顺序

Task 1 -> Task 2（restore 复用 backup 的 dump 格式）-> Task 3（compose 引用脚本）-> Task 6（验证依赖 1+2+3）-> Task 4（workflow 独立）+ Task 5（docs 独立）可并行 -> Task 7（最后）

## 风险

- **pg_dump 版本**: backup service 用 postgres:16，生产 PG 也是 16（docker-compose.yml 确认），版本匹配。dev PG 也是 16。无版本不兼容
- **docker network**: backup service 需连 postgres service，复用 ptidle_default 网络（同 compose project 自动同网络）
- **磁盘空间**: prune 限制备份数 + 备份前检查空间，但 VPS 磁盘满仍需用户监控（T-FOLLOW-9）
- **GH Actions cron 延迟**: GH cron 不保证准时（5-15min），daily 备份可接受
