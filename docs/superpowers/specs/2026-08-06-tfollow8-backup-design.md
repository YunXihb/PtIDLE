# T-FOLLOW-8 备份策略 设计文档

**任务**：T-FOLLOW-8 - 生产数据备份（daily pg_dump + 保留策略 + 恢复流程 + storage 抽象）
**日期**：2026-08-06
**状态**：🟡 设计待用户审阅
**前置任务**：T-FOLLOW-5（单 VPS 部署编排，已完成）+ T-FOLLOW-7（自动回滚，已完成）

---

## 一、目标

为 PtIDLE 生产数据提供可恢复的备份链。daily `pg_dump` + 保留策略 + 恢复流程，防止数据丢失（误操作 / migration 失败 / 硬件故障）。storage 抽象成接口，本轮实现 Local backend，后续加 B2/S3 只需实现接口分支。

### 1.1 范围

- ✅ `scripts/backup.sh`：`pg_dump` + gzip + storage backend dispatch（local/b2/s3）+ 保留清理（prune）
- ✅ `scripts/restore.sh`：从指定备份恢复 PG
- ✅ `docker-compose.yml`：加 `backup` service（postgres:16 image 含 pg_dump，`profiles:["backup"]` 隔离，挂载 backups 卷 + 脚本）
- ✅ `.github/workflows/backup.yml`：scheduled（daily cron）+ `workflow_dispatch`，SSH 跑 `docker compose run --rm backup`
- ✅ `.env.example`：加 `BACKUP_*` 配置项
- ✅ `docs/deploy.md`：加备份章节（频率 / 保留 / 恢复流程 / 排查）
- ✅ storage 抽象接口（`upload_backup` / `list_backups` / `delete_backup` 函数 dispatch；Local 现实现，B2/S3 预留 TODO 分支）

### 1.2 范围外（明确不做）

- ❌ **Redis 备份**：Redis 是缓存/会话层，`redisdata` volume 持久化已够；battle session 丢失可接受（玩家重连重建）。若未来需保护进行中对战，单独评估 RDB 快照
- ❌ **.env / 配置备份**：含密钥，备份需加密，复杂度高；用户自行保管 `.env`（docs 提示）
- ❌ **B2/S3 实际实现**：本轮只做 Local + 接口抽象，B2/S3 留 TODO 分支（返回非零 + 提示未实现）
- ❌ **增量备份 / WAL archiving**：`pg_dump` 全量够 solo dev；PITR 留未来
- ❌ **备份加密**：本地存储不需；B2/S3 实现时再加 GPG
- ❌ **跨区域复制**：单 VPS + 单存储
- ❌ **VPS 系统 cron**：用 GH Actions scheduled，不依赖 VPS cron

### 1.3 关键决策摘要

| 维度 | 选择 | 理由 |
|---|---|---|
| **备份内容** | PG full dump（`pg_dump --format=custom --compress=9`） | 全量、可选择性恢复单表、solo dev 够用 |
| **频率** | daily（GH Actions cron） | 复用 GH Actions SSH 模式，不依赖 VPS cron |
| **保留** | daily 14 天 + weekly 8 周（周一） | 平衡存储成本与恢复点；约 22 个备份 |
| **存储** | 本地（VPS `/opt/ptidle/backups/`）+ 抽象接口 | 用户选；不依赖外部账号；后续 B2/S3 易加 |
| **实现** | bash 脚本 + `postgres:16` image | `pg_dump` 自带，轻量，容器化复用 docker 网络 |
| **调度** | GH Actions scheduled workflow | 配置在 GH，复用 SSH 模式，审计可见 |
| **恢复** | `restore.sh` 脚本 + 文档 | 灾难时手动恢复；定期演练 |
| **失败处理** | `set -euo pipefail` + 退出码 1 | GH Actions red，用户介入 |

---

## 二、架构

### 2.1 改造范围

```
┌──────────────────────────────────────────────────────────────┐
│  GitHub Actions (新增 .github/workflows/backup.yml)           │
│  ┌────────────────────────────────────────────┐              │
│  │ schedule: cron '17 3 * * *'  (daily 03:17 UTC)│             │
│  │ workflow_dispatch (手动)                     │              │
│  │   │                                          │              │
│  │   ↓ appleboy/ssh-action (复用 T-FOLLOW-5 模式)│             │
│  └────────────────────────────────────────────┘              │
└──────────────────────────┬───────────────────────────────────┘
                           │ SSH: cd /opt/ptidle && docker compose run --rm backup
                           ↓
┌──────────────────────────────────────────────────────────────┐
│  VPS /opt/ptidle                                              │
│  ┌────────────────────────────────────────────────┐          │
│  │ docker-compose.yml (改: 加 backup service)      │          │
│  │  ┌──────────┐  image: postgres:16               │          │
│  │  │ backup   │  profiles: ["backup"]  (隔离)      │          │
│  │  │          │  volumes:                         │          │
│  │  │          │    - ./backups:/backups           │          │
│  │  │          │    - ./scripts/backup.sh:/bk.sh   │          │
│  │  │          │  command: ["/bk.sh"]              │          │
│  │  └──────────┘                                   │          │
│  └────────────────────────────────────────────────┘          │
│           │ 复用 ptidle_default 网络连 postgres:5432          │
│           ↓                                                   │
│  ┌──────────────────┐    ┌─────────────────────────┐         │
│  │ postgres service │←───│ pg_dump (容器内)          │         │
│  │ (已有)           │    │ -> /backups/DATE.dump.gz │         │
│  └──────────────────┘    │ -> prune 旧备份           │         │
│                          └─────────────────────────┘         │
│  ┌────────────────────────────────────────────────┐          │
│  │ /opt/ptidle/backups/  (host volume, 持久)       │          │
│  │   2026-08-06.dump.gz                            │          │
│  │   2026-08-05.dump.gz                            │          │
│  │   ... (prune 按 daily14+weekly8 保留)            │          │
│  └────────────────────────────────────────────────┘          │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 storage 抽象

backup.sh 内用函数 dispatch 实现 storage backend 接口，`BACKUP_STORAGE` env 选 backend：

```bash
# 统一接口: dump 文件已生成在 $TMP_FILE, 按 backend 上传/落盘
upload_backup()   { ... }   # local: mv 到 $BACKUP_DIR;  b2/s3: rclone/aws 上传 (TODO)
list_backups()    { ... }   # local: ls $BACKUP_DIR;     b2/s3: 列远程 (TODO)
delete_backup()   { ... }   # local: rm;                 b2/s3: 远程删 (TODO)
```

本轮只实现 `local` 分支；`b2`/`s3` 分支打印 "TODO: 未实现" + return 1（让用户明确知道需后续实现，而非静默成功）。

---

## 三、组件

### 3.1 `scripts/backup.sh`
- `set -euo pipefail`
- 读 env: `DB_HOST/PORT/NAME/USER/PASSWORD`, `BACKUP_DIR`, `BACKUP_STORAGE`, `RETENTION_DAILY`(默认14), `RETENTION_WEEKLY`(默认8)
- 步骤: 检查磁盘空间 → `pg_dump --format=custom --compress=9` 到临时文件 → `upload_backup` → `prune_backups`（按 daily+weekly 保留）→ 清临时文件 → 打印 summary
- 文件名: `ptidle-YYYY-MM-DD.dump`（custom format 不再加 .gz，pg_dump --compress 已压缩；统一 `.dump` 扩展名）

### 3.2 `scripts/restore.sh`
- 用法: `restore.sh <YYYY-MM-DD>` 或 `restore.sh latest`
- 步骤: 定位备份 → `pg_restore --clean --if-exists --no-owner` → 验证（count 关键表）→ 打印 summary
- 安全: 要求 `CONFIRM_RESTORE=yes` env 才执行（防误跑，覆盖生产数据）

### 3.3 `docker-compose.yml` backup service
```yaml
backup:
  image: postgres:16
  profiles: ["backup"]          # 隔离: 不随 docker compose up 启动
  environment:
    DB_HOST: postgres
    DB_PORT: 5432
    DB_NAME: ${POSTGRES_DB:-ptidle}
    DB_USER: ${POSTGRES_USER:-ptidle}
    DB_PASSWORD: ${DB_PASSWORD}
    BACKUP_DIR: /backups
    BACKUP_STORAGE: ${BACKUP_STORAGE:-local}
    RETENTION_DAILY: ${RETENTION_DAILY:-14}
    RETENTION_WEEKLY: ${RETENTION_WEEKLY:-8}
  volumes:
    - ./backups:/backups
    - ./scripts/backup.sh:/bk.sh:ro
    - ./scripts/restore.sh:/rs.sh:ro
  command: ["/bk.sh"]
```

### 3.4 `.github/workflows/backup.yml`
- `on: schedule: cron '17 3 * * *'`（daily 03:17 UTC，避开整点）+ `workflow_dispatch`
- 单 job `backup`，`appleboy/ssh-action@v1` 复用 `VPS_SSH_KEY/VPS_HOST/VPS_USER` secrets
- script: `cd /opt/ptidle && docker compose run --rm backup`
- `timeout-minutes: 10`

### 3.5 `.env.example` 加 `BACKUP_*`
```
# T-FOLLOW-8: Backup
BACKUP_STORAGE=local          # local | b2 | s3 (b2/s3 本轮 TODO)
RETENTION_DAILY=14            # daily 备份保留天数
RETENTION_WEEKLY=8            # weekly 备份保留周数
```

### 3.6 `docs/deploy.md` 备份章节
- 频率 / 保留策略 / 备份存储位置
- 恢复流程（`restore.sh` 用法 + `CONFIRM_RESTORE`）
- 排查（磁盘满 / pg_dump 失败 / GH Actions red）
- 未来加 B2/S3 的步骤提示

---

## 四、数据流

- **备份**：GH cron → SSH → `docker compose run --rm backup` → backup.sh → `pg_dump` → `/backups/ptidle-DATE.dump` → prune 旧备份 → exit 0（GH green）
- **恢复**：SSH → `docker compose run --rm -e CONFIRM_RESTORE=yes -e RESTORE_DATE=YYYY-MM-DD backup /rs.sh` → restore.sh → `pg_restore --clean` → 验证 → summary
- **prune 逻辑**：列出所有 `ptidle-*.dump`，按日期降序；标记最近 N 天（daily）+ 最近 M 个周一（weekly）保留；其余删除

---

## 五、错误处理

| 场景 | 行为 |
|---|---|
| `pg_dump` 失败 | 删临时文件，exit 1，GH red |
| 磁盘可用空间 < 1GB | 打印警告 + exit 1（防 dump 写半磁盘满） |
| `upload_backup` 失败 | exit 1（备份未落地） |
| `prune_backups` 失败 | `warn` 但 exit 0（备份本身已成功，清理非关键） |
| `BACKUP_STORAGE` 未知 | exit 1 + 明确错误 |
| b2/s3 backend 调用 | 打印 "TODO: 未实现" + exit 1（不静默成功） |

---

## 六、测试

### 6.1 本地验证（dev PG 容器）
- `docker run --rm --network ptidle_default -e DB_HOST=ptidle-postgres-1 ...` 或直接在 dev PG 容器内跑 backup.sh
- 验证: `ptidle-DATE.dump` 生成 + 非空 + `pg_restore -l` 能列出内容
- 验证 prune: 造 20+ 假备份文件（touch 不同日期），跑 prune，验证 daily14+weekly8 保留正确

### 6.2 恢复验证
- 备份后，往 dev PG 插入测试数据 → 跑 restore.sh → 验证数据回到备份点（测试数据消失）
- 验证 `CONFIRM_RESTORE` 缺失时拒绝执行

### 6.3 storage 抽象验证
- `BACKUP_STORAGE=local` 跑通
- `BACKUP_STORAGE=b2` 验证打印 TODO + exit 1（不静默）

### 6.4 语法
- `bash -n backup.sh` + `bash -n restore.sh`

---

## 七、未来

- **B2/S3 backend 实现**：实现 `upload_backup`/`list_backups`/`delete_backup` 的 b2/s3 分支（rclone 或 aws-cli；需对应凭据 secret）
- **备份加密**：GPG 加密 dump（B2/S3 时推荐）
- **恢复演练自动化**：定期自动 restore 到临时 DB 验证备份可用性
- **WAL archiving + PITR**：point-in-time recovery（更细粒度恢复）
- **备份成功率监控**：T-FOLLOW-9 监控加 backup workflow 成功率告警

---

## 八、关联

- **T-FOLLOW-5**（部署编排）：复用 docker-compose + SSH 模式
- **T-FOLLOW-7**（自动回滚）：共享 deploy.sh/SSH 模式；备份独立于部署
- **T-FOLLOW-9**（监控，待开发）：未来加备份成功率告警
- **migrate.js**（T-FOLLOW-1）：恢复流程涉及 migration 一致性（恢复后 schema_migrations 应与备份时一致）
