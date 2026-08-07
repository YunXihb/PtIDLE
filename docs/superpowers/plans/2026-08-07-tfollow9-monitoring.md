# T-FOLLOW-9 监控 实施 Plan

**任务**：T-FOLLOW-9 - GH Actions scheduled health check（不依赖域名部分）+ 镜像滞后诊断
**日期**：2026-08-07
**前置**：T-FOLLOW-5 (deploy workflow) / T-FOLLOW-8 (backup) 已完成
**范围**：仅 GH Actions scheduled health check；UptimeRobot + 5xx 告警阻塞于域名，后续补

---

## 背景 / 关键发现

调研监控时发现**镜像滞后**（比监控本身更紧急）：

- `scripts/deploy.sh` 拉 `ghcr.io/yunxihb/ptidle-backend:latest`
- `.github/workflows/release.yml` **仅 push `v*` tag 时才更新 `latest`**
- 最后一个 release tag = **v0.1.1 (e5d21ca, 2026-06-25)**
- 自此所有 deploy（含 run 31157796071）拉同一 v0.1.1 旧镜像，镜像层空操作。deploy 日志 "sha=eb53a82" 只是传入的 GITHUB_SHA，不代表镜像内容。

未上线的 backend 代码（v0.1.1..HEAD 唯一改 backend 的 commit）：
- `e7e51c9` T-FIX 批次 1&2：**P0 级运行时 bug + 并发/资产安全加固 + /health active probe**

影响：
1. #5 根因：生产 /health `db/redis:unknown` + `status:ok/200` = v0.1.1 旧镜像硬编码占位、无 probe（master `index.ts:52-77` 已有 probe，未发布成镜像）。非 bug，是没发布。
2. P0 修复 + 资产安全加固未上线。
3. #3 监控局限：旧镜像 /health 永远 200/ok，ping 只能抓 backend 宕机/崩溃，抓不到 DB/Redis 故障。镜像刷新后（probe 让 DB down 返回 503）才完整。

## Part A：监控 workflow（本次实现）

`.github/workflows/health-check.yml`：
- 触发：schedule cron `8,23,38,53 * * * *`（每 15 min，偏移避整点）+ workflow_dispatch
- `permissions: issues: write`，`GH_TOKEN: GITHUB_TOKEN`（默认，不引入新 secret）
- 复用 `secrets.VPS_HOST`（endpoint = `http://VPS_HOST/health`）
- Step「Ping /health and alert」（单步，避免 output 注入）：
  - `curl -sS --max-time 10 --retry 3 --retry-delay 5 -w $'\n%{http_code}'`
  - 判定 = HTTP 200 且 body 含 `"status":"ok"`
  - 失败：`gh label create health-check --if-not-exists` -> 查 open issue -> 有则评论、无则 `gh issue create`（标题 🚨，含时间/endpoint/HTTP code/响应/run link/排查指引）-> `exit 1`（让 Actions UI 显示 failed）
  - 成功：若有 open issue -> 评论 ✅ Recovered + `gh issue close`
  - 告警文案写 /tmp/msg.txt + `--body-file`，避免 heredoc 缩进/转义
- `timeout-minutes: 5`

文档同步：deploy.md §九 监控 / progress.md (移已完成) / architecture.md (3 处状态) / history.md / 本 plan。

## Part B：镜像刷新（强烈建议，outward-facing 需用户确认，本次未做）

切 v0.1.2 release（tag eb53a82）-> release.yml 构建新 latest -> deploy.yml workflow_run 自动部署。
一次解决：① #5 probe 生效 ② P0+资产安全上线 ③ 监控对 DB/Redis 故障生效。
验证：部署后 curl /health 应返回 `database:ok, redis:ok`。

## Part C：不做（YAGNI / 阻塞）

- UptimeRobot + 5xx 告警：阻塞于域名（#2）
- backup workflow 成功率告警：可选扩展
- monitor + rollback worker 解耦：T-FOLLOW-7 spec 明确「当前不预先做」

## 验证

- `python3 -c yaml.safe_load` YML 语法 OK
- `bash -n` ping+alert 脚本 OK
- 手动 `gh workflow run health-check.yml` 触发一次确认 issue 开/关逻辑（push 后做）
