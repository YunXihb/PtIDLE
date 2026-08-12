# PtIDLE 执行进度记录 (Progress)

> 此文件由 AI 在项目开发过程中逐步填充
> 记录每个任务的执行状态、完成时间、遇到的问题等

---

## 待开发

| 任务ID | 名称 | 备注 |
|--------|------|------|
<!-- T-FOLLOW-9 已完成 (2026-08-07), 见「已完成」表. 其余 UptimeRobot/5xx 告警阻塞于域名 -->

---

## 开发中

<!-- 在此记录正在开发的任务 -->

---

## 已完成

| 任务ID | 名称 | 完成时间 |
|--------|------|----------|
| T001 | 初始化 Node.js 项目结构 | 2026-03-10 |
| T002 | 配置 TypeScript 和 ESLint | 2026-03-10 |
| T003 | PostgreSQL 数据库设计 | 2026-03-10 |
| T004 | Redis 配置 | 2026-03-10 |
| T005 | 用户注册 API | 2026-03-11 |
| T006 | 用户登录 API | 2026-03-11 |
| T007 | JWT 认证中间件 | 2026-03-11 |
| T008 | 玩家初始化逻辑 | 2026-03-11 |
| T009 | 获取玩家数据 API | 2026-03-11 |
| T010 | 离线收益计算服务 | 2026-03-11 |
| T011 | 离线收益结算 API | 2026-03-11 |
| T012 | 采集技能数据模型 | 2026-03-12 |
| T013 | 采集 API（开始采集） | 2026-03-11 |
| T014 | 采集进度查询 API | 2026-03-11 |
| T015 | 采集完成与收益计算 | 2026-03-11 |
| T016 | 加工配方数据模型与服务层 | 2026-03-12 |
| T017 | 加工 API | 2026-03-12 |
| T018 | 仓库资源查询 API | 2026-03-12 |
| T019 | 仓储上限管理 | 2026-03-12 |
| T020 | 制造配方数据模型 | 2026-03-19 |
| T021 | 实现卡牌制造 API | 2026-03-19 |
| T022 | 实现装备制造 API | 2026-03-19 |
| T023 | 实现消耗品制造 API | 2026-03-19 |
| T024 | 实现生产装备效率计算 | 2026-03-19 |
| T025 | 实现周期性挂机收益计算 | 2026-03-19 |
| T026 | 实现职业数据模型服务层 | 2026-03-19 |
| T027 | 实现棋子创建 API | 2026-03-19 |
| T028 | 实现棋子查询 API | 2026-03-19 |
| T029 | 实现棋子命名 API | 2026-03-19 |
| T030 | 定义基础卡牌数据模型 | 2026-03-19 |
| T031 | 实现卡牌库查询 API | 2026-03-19 |
| T032 | 实现卡牌分配 API | 2026-03-19 |
| T033 | 实现棋盘初始化逻辑 | 2026-03-19 |
| T034 | 实现移动判定逻辑 | 2026-03-19 |
| T035 | 实现攻击判定逻辑 | 2026-06-09 |
| T036 | 实现回合流程控制 | 2026-06-09 |
| T037 | 实现手牌抽牌逻辑 | 2026-06-10 |
| T038 | 实现回合结束保留 1 张手牌 | 2026-06-10 |
| T039 | 实现战士职业逻辑（权限+攻击累计+嘲讽+状态栏数据层） | 2026-06-10 |
| T1001 | 实现战棋公共池系统（补足手牌 + 不可保留 + 不计入职业机制） | 2026-06-10 |
| T040 | 实现弓手职业机制 1（攻击累计增伤，damage_boost 状态效果） | 2026-06-10 |
| T041 | 实现法师职业机制 2（debuff/灼伤系统，fire mark + burn DoT） | 2026-06-11 |
| T042 | 实现匹配队列 API (POST /api/match/queue) | 2026-06-11 |
| T043 | 实现匹配状态查询 + 取消匹配 API (GET + DELETE /api/match/queue) | 2026-06-11 |
| T044 | 实现对手匹配逻辑（tryMatch + Lua 撮合 + battles 行创建 + LOSER 兜底） | 2026-06-11 |
| T045 | 配置 Socket.io 基础连接（HTTP+WS 同 server + 握手期 JWT 鉴权 + socket.data 元数据） | 2026-06-11 |
| T046 | 实现房间管理逻辑（user-room 推送通道 + battle:join 鉴权 + 撮合 push + 断线通知） | 2026-06-11 |
| T047 | 实现实时状态同步（broadcaster 函数库 + battle:join 初期推 full state） | 2026-06-11 |
| T048 | 实现战场初始化（双 join 触发 + 7 步流水 + 失败回滚） | 2026-06-15 |
| T049 | 实现移动操作同步（battle:move + executeMove 流水 + board 广播 + phase 推进） | 2026-06-15 |
| T050 | 实现打牌操作同步（attack + tactical taunt 17 步流水 + 副作用 + 广播 + 阶段推进） | 2026-06-17 |
| T051 | 实现回合切换 orchestrator（executeEndStep 11 步 + executeRoundEnd 5 步 + tickBurnDamageOnTarget + battle:skip_play 事件） | 2026-06-17 |
| T052 | 实现胜负判定逻辑（kill star + base star + 6 阈值胜利 + 平局 + DB 持久化 + WS 广播） | 2026-06-17 |
| T053 | 实现卡牌消耗（consumePlayerCard + 步骤 9.5 + withTransaction 事务） | 2026-06-18 |
| T054 | 实现对战结算 API（POST /api/battle/result + 玩家 wins/losses/draws 累加 + player_battle_history + Redis 清理 + 幂等） | 2026-06-20 |
| T055 | 操作合法性校验中心化（WS Handler 入口跨切校验：room membership + battle status + rate-limit via Redis Lua） | 2026-06-20 |
| T-FOLLOW-1 | 实现 migrations runner 自动化（`npm run db:migrate` 脚本 + `schema_migrations` 跟踪表 + idempotent 事务 + 启动顺序） | 2026-06-20 |
| T-FOLLOW-2 | Migrations 启动期集成 + README 文档（`checkMigrationsStatus` 只读检测 + `index.ts` 启动 warn + 根 + backend 双 README） | 2026-06-20 |
| T-FOLLOW-3 | CI/CD 接入（GitHub Actions ci.yml + PG 16 / Redis 7 service containers + 42/701 jest 全量 + coverage artifact + README badge） | 2026-06-20 |
| 测试基线 | T-FOLLOW-3 收尾：CI workflow 文件就绪，待 push 后首次跑通验证（本地 42/701 仍全绿） | 2026-06-20 |
| CI 首次跑通 | T-FOLLOW-4 commit 5582977 推送后, GitHub Actions CI 首次跑通 (run #27936624591): 2 min 17 sec, 14/14 steps success, jest 42/701 + db:migrate + coverage artifact 全过 | 2026-06-22 |
| v0.1.0 Release | T-FOLLOW-4 release workflow 首次跑通: 推送 tag v0.1.0 (commit 634e2ee) → run #27937392708, 3 min 19 sec, 6/6 steps success → GHCR 4 tag 上传 (latest / 0.1 / 0.1.0 / 634e2ee)。Multi-arch (linux/amd64+arm64) build 无失败但需 make public 后 docker manifest 验证。**默认 private** — 需用户手动在 package settings 改 public | 2026-06-22 |
| T-FOLLOW-4 | CD 接入 - 镜像层（Dockerfile multi-stage + .dockerignore + release.yml multi-arch GHCR + docs/deploy.md + 本地 smoke test 通过 /health 200） | 2026-06-22 |
| T-FOLLOW-5 | 单 VPS 部署编排（migrate.js 重写 + Dockerfile baked migrations + docker-compose 4 services + deploy.yml workflow_run trigger + scripts/deploy.sh + docs/deploy.md § 5.3 + memory-bank 同步） | 2026-06-22 |
| T-FOLLOW-6 | HTTPS / TLS / domain（Caddy 2-alpine 第 5 service + Let's Encrypt HTTP-01 + caddy_data 持久化 + 删 backend host port + .env 加 DOMAIN/ACME_EMAIL + docs/deploy.md § 5.3 DNS 步骤） | 2026-06-22 |
| T-FOLLOW-6 bug fix | CI Run #28099535056 失败修复 - migrate.js 内联 pg.Pool 移除 .ts 依赖（CI 不 build；npm run db:migrate 直接 require .ts 抛 MODULE_NOT_FOUND）。**CI 验证**: commit 34a1625 推送后 Run #28113095056 全 13 步 success (2m17s) | 2026-06-25 |
| T-FOLLOW-7 | 自动回滚（deploy.sh 加 .last_good + health check fail 时 restore 旧 image + docker-compose ${BACKEND_IMAGE} env var 模式） | 2026-06-25 |
| T-FOLLOW-7 v0.1.1 部署 | tag v0.1.1 推送 → Release #2 (run #28175386357) image build success → Deploy #1 (run #28175599367) 失败: job 8s exit 1, "Process completed with exit code 1"。根因待 SSH 调试 (`bash -x scripts/deploy.sh 2>&1 | tee /tmp/deploy-debug.log`)。生产 backend 仍是 v0.1.0 image | 2026-06-26 |
| T-FIX 质量修复批次 | 修复已完成代码的 P0 级 bug（详见 history 2026-08-06 条目）：双状态源、手牌类型冲突、回合轮转、阵营判定、据点坐标、skip_play 归属、AOE currentRound、撮合 SQL 优先级、制造扣料顺序、采集/离线/加工幂等、IDOR、JWT 密钥、health 探测、deploy.sh 回滚 | 2026-08-06 |
| T-FIX 批次 2 (P1/P2) | 并发/资产安全 + 代码整洁：moveCharacter Lua 原子、settleBattle 行锁幂等、consumePlayerCard 归属复核、全局错误中间件、CORS 收敛 + auth 限流、共享缓存工具、Redis key 常量集中、错误码统一、迁移 004 + 唯一约束 | 2026-08-06 |
| T-FOLLOW-8 | 备份策略（daily pg_dump + 保留 daily14/weekly8 + 恢复 + storage 抽象） | 2026-08-06 |
| T-FOLLOW-7 失败诊断 | deploy.sh 加 ERR trap (`set -E` + `trap on_error ERR`) 打印失败行号 + 定位提示，改善 v0.1.1 部署失败 (8s exit 1) 无 step-level 输出问题。裸命令失败 (cd/pull/migrate/up) 触发，`if`/`while` 不触发。本地 bash 模拟验证 trap 行为；仍需 VPS 访问真正修复部署 | 2026-08-06 |
| T-FOLLOW-9 | 监控（GH Actions scheduled health check：每 15 min curl /health，失败开/评论 issue 告警，恢复自动关 issue；复用 VPS_HOST，GITHUB_TOKEN 开 issue） | 2026-08-07 |
| v0.1.2 Release | tag v0.1.2(4824672) -> release.yml run 31161641510 (首次冷构建 multi-arch 29min 被取消, rerun 吃 cache 4min success) -> deploy.yml run 31164125069 (workflow_run) 自动 success. 上线 e7e51c9 (T-FIX P0+资产安全+/health probe). /health 现返回 database:ok redis:ok (#5 修复). 镜像滞后解决 | 2026-08-07 |
| P2 代码改进 批次1 | 注册事务化 + 响应包裹统一。createUser 包 withTransaction（existence+INSERT user+initializePlayer 原子化，修孤立 user bug；initializePlayer 加可选 client），新增 utils/http.ts ok()/fail()，12 routes+4 controllers 全部信封化（裸数据->ok，错误加 success:false），全局错误中间件加 success:false。tsc 零错；jest 703/703 全绿（+1 注册回滚回归测试）；真库 smoke 验证 commit/duplicate/ROLLBACK。剩 zod 字段校验 + REST 统一(next(error)/ApiError) 下一批 | 2026-08-07 |
| P2 代码改进 批次2 | zod 字段校验 + REST 统一。新增 zod@3 + `middleware/validate.ts`（safeParse 失败 next(ApiError(400,首条msg))，通过替换 req.body）+ `validations/` 6 schema（auth/gathering/crafting/processing/characters/battle，自定义 message 对齐既有契约）；新增 `utils/ApiError.ts`（status+code?+extra?）+ `middleware/errorHandler.ts`（状态感知：ApiError 按 status+展开 extra / ZodError 400 / 其余 500 屏蔽）；路由/控制器 catch 统一 next(error)，ad-hoc `Error&{code}` 收敛为 ApiError（gathering 已活跃/processing 缺料+玩家不存在，缺料 missing 经 extra 回传），catch-all 500 不再各自 console.error+fail；auth/rateLimit 401/429 补 success:false。matchmaking LOSER 兜底保留原结构。tsc 零错；jest 703/703 全绿；10 个集成测试 app 挂载 errorHandler 保持错误信封一致。路由命名审计：现状一致（action 风格 /start /complete /result 等有意为之），无需改名 | 2026-08-07 |
| v0.1.3 Release | tag v0.1.3(a2514ba) push → Release run 31262817512 success（含 P2 批次1&2 后端改进 + 前端骨架仓库提交，前端不进镜像）→ Deploy run 31262952269 success 自动上线。health-check 连续 5 次 success 验证 VPS 在线。T-FOLLOW-7 部署问题确认已解决 | 2026-08-08 |
| T057 | 初始化 Vue 3 项目（Vite5 + Vue3 + TS + Router + Pinia + axios + socket.io-client）。含类型定义对齐后端契约、axios 拦截器(JWT+401登出+信封剥离)、3 stores(auth/player/game)、路由守卫、登录/注册/主页+离线收益弹窗、5 占位视图。`npm run build` 通过（vue-tsc+vite）。T058/T059 同步完成（路由+Pinia 随骨架就绪） | 2026-08-08 |
| T058-T063 | 随 T057 骨架一并完成（代码已实现，此处补登）：T058 路由(router/index.ts 7 路由+懒加载+beforeEach 守卫)/T059 Pinia(auth/player/game 3 store)/T060 登录页/T061 注册页/T062 主界面布局(HomeLayout 顶栏导航)/T063 离线收益弹窗(HomeView modal) | 2026-08-08 |
| T064 | 采集界面。新增 stores/gathering.ts(skills/efficiency/activeTask+loadAll/start/complete/cancel，complete 成功后刷 player profile)+ components/GatheringPanel.vue(技能列表+活跃任务进度条+领取/取消+2s 轮询检测后端定时器自动完成)+ utils/resources.ts(资源名映射)+ WorkshopView 改 tab 壳(采集/加工/制造，加工/制造占位留 T065/T066)。后端 T013/T014 已就绪无改动。npm run build + typecheck 通过 | 2026-08-08 |
| T065 | 加工界面。新增 stores/processing.ts(recipes/loadAll/process，process 成功刷 player profile；400 缺料取 lastMissing+刷 profile)+ components/ProcessingPanel.vue(配方卡 grid + input->output 流 + 数量 1/5/10 + 客户端预算校验 canAfford/missingFor + 缺料禁用按钮 + notice)+ types/index.ts(ProcessResult 加 resources/materials)。WorkshopView 挂载替换占位。后端 T017 processing route 已修(commit 16af1fa: input 走 resources 校验/扣除而非 materials)。typecheck 零错；build 通过(WorkshopView chunk 9.69kB)；API smoke 全过(冶炼/木工/研磨×1+smelting×5+缺料 400 missing 顶层) | 2026-08-12 |
| T066 | 制造界面。新增 stores/crafting.ts(recipes/loadAll/craft，craft 按 category 分发 card/gear/consumable 端点，成功+失败都刷 profile；后端 result.success 模式无 missing 数组，错误仅文案)+ components/CraftingPanel.vue(3 分类 section: 卡牌/装备/消耗品 + 替代料 input「或」连接 + 数量 1/5/10[装备强制1] + 客户端预算校验 canAfford/missingFor[任一替代组合满足] + 职业门槛 badge/禁用 + notice)。WorkshopView 挂载替换占位(工坊三子页全完成)。后端 T021/T022/T023 已就绪无改动。typecheck 零错；build 通过(WorkshopView chunk 14.55kB)；API smoke 全过(card/gear/consumable×1+法师火球卡×3缩放+弓手职业卡+回血药替代料+缺料400无missing+职业403+卡牌上限400边界) | 2026-08-12 |
| T067 | 仓库界面。改 frontend/src/views/WarehouseView.vue(替换占位)：onMount 调 player.fetchWarehouse(GET /warehouse)+ 资源/材料两 section + 分类用量条(绿<80%/黄<100%/红>=100%，storageLimits={resource:1000,material:500,gear:50} 分类级总和上限)+ 物品 grid(按数量降序，0 值 dim)+ 刷新按钮+ 本地 loading/error。后端 T018 已就绪无改动(player store 已有 warehouse ref+fetchWarehouse)。typecheck 零错；build 通过(WarehouseView 0.25kB->3.34kB)；API smoke 全过(GET /warehouse 返回 resources/materials/storageLimits 字段+数据正确+401 未鉴权+UI 用量计算 资源510/1000 51%/材料173/500 35%) | 2026-08-12 |
| T068 | 战棋棋盘渲染。新增 frontend/src/components/BattleBoard.vue(9x9 CSS Grid 棋盘 + 基地(3,3/6,6)按 bases 染色 p1蓝/p2红/neutral虚线 + 状态条 round/step/phase/stars + 坐标轴 x0-8/y0-8 + cell-click 事件供 T071)+ 改 frontend/src/views/BattleView.vue(接 game store.board，WS 未接前预览 mock BoardStateEvent 验证渲染)。坐标约定: P1 侧 y=0(底)/P2 侧 y=8(顶)，行渲染 y8->y0。渲染技术 CSS Grid(非计划 Canvas/SVG: 离散格子+点击交互+主题一致)。game store 已完整(board/ownHand/move/playCard 全就绪)。typecheck 零错；build 通过(BattleView 3.28kB)。棋盘无 REST 状态端点(实时走 WS T073)，契约编译期对齐 BoardStateEvent(与后端 battleStateBroadcaster 核实一致) | 2026-08-12 |

---

## 问题与解决

| 日期 | 问题 | 解决方案 |
|------|------|----------|
| 2026-06-10 | `gathering.integration.test.ts` 3 个用例（开始采集×2、取消采集）因 `ClientClosedError: The client is closed` 失败。根因：集成测试未调用 `connectRedis()`，但 `idleQueueService.zAdd/zRem` 路径要求已连接的单例 | 在测试文件顶部加 `jest.mock('../config/redis', ...)` 覆盖所有用到的 Redis 方法。同步更新 `architecture.md` 增加「集成测试 Mock 模式」章节。详见 history 2026-06-10 条目 |
| 2026-06-18 | T052 收尾时 `npx jest` 跑出 7 个失败（5 `authController` + 2 `socketServer`）。根因是开发环境缺 PostgreSQL/Redis 服务（`ECONNREFUSED 127.0.0.1:5433` + `ClientClosedError`），不是代码问题 | `docker compose up -d` 启动 `ptidle-postgres-1`（5433）+ `ptidle-redis-1`（6379）；`socketServer.test.ts` 在 `beforeAll` 加幂等 `connectRedis()`（用 `redisClient.isOpen` 防重复连）；`afterAll` 不调 `disconnectRedis()` 防止关掉跨文件共享的单例。修复后 36 个 test suite / 620 个 test 全绿。同步更新 `architecture.md` Docker 配置 + 集成测试模式 章节。详见 history 2026-06-18 条目 |
| 2026-06-18 | T053 spec compliance 收尾时发现 T053 describe block 落在 executePlayCard describe 之外（结构问题）；code quality review 发现 partial delete 路径在 withTransaction 回调内显式 ROLLBACK 导致回调返回后 withTransaction 仍会 COMMIT，产生 driver-level 副作用 + 双日志 | (1) 修正 T053 describe 嵌套位置（amend 6dd68da→be85e9a，b1f3d61 保留原状）；(2) 重构 consumePlayerCard 用 PartialDeleteError sentinel 替代 in-callback ROLLBACK，外层 catch 用 instanceof 区分 partial (warn) vs error (error)，commit b42f89f。修复后 5/5 T053 + 23/23 executePlayCard + 480/480 service + 4/4 database 全绿 |
| 2026-06-20 | T054 simplify review 发现：(1) applySettlementInTransaction 4 个近重复调用（4a 双 UPDATE + 4b 双 INSERT）易引入参数错位 bug；(2) controller switch 缺 exhaustiveness 检查，新增 error variant 会静默漏分支；(3) integration/unit test 的 `jest.spyOn(console, 'error')` 在 describe 顶层 spy，永不 mockRestore 会污染同进程后续测试输出；(4) integration test 残留无用 `_refs = {...}` 占位语句 | (1) 把 4 个对称 SQL 调用改写为 `for side of [p1/p2]` 循环 + `insertBattleHistory` 收 1 个 `side` 对象替代 7 位置参数；(2) controller switch 加 `default: const _exhaustive: never = result.error` + throw，让新增 error variant 编译失败；(3) 两处 console.error spy 改用 `beforeEach` 局部 spy + `afterEach mockRestore()`；(4) 删 `_refs` 行。修复后 21/21 T054 + 39/39 全量 suite 全绿 |
| 2026-06-20 | T-FOLLOW-1 单测初次运行全部失败：`process.exit called with "1"` 立即终止 jest 进程，无任何 case 输出。根因 mockClient 缺 `release` 方法 → `applyMigration` `finally` 块 `client.release()` 抛 TypeError → 失败被 runMigrations 捕获 → `failureCount++` → 走 process.exit(1) | mockClient 加 `release: jest.fn()`。修复后 8/8 migrate test + 42/42 全量 suite 全绿 |
| 2026-06-20 | T-FOLLOW-2 smoke test 在 /tmp/ 写脚本跑 ts-node 失败 2 次：第一次相对路径解析失败（`./src/config/database` 在 /tmp/ 找不到），第二次 /tmp/ 文件被 ESM loader 拒绝（`ERR_UNKNOWN_FILE_EXTENSION`） | 把脚本挪到 `backend/src/scripts/smoke-warn.ts` 内部 + 用绝对路径 import。修复后 3 个状态切换（before 全 applied → drop 一行 → after hasPending=true → 恢复）全部正确 |
| 2026-06-20 | T-FOLLOW-3 端口混淆风险：dev docker-compose 把 PG 5432 → 5433（host 端口）避免本机冲突，但 CI GitHub Actions service container 内部就是 5432，**用 5433 会连不上** | workflow 显式 `DB_PORT: 5432` + `REDIS_PORT: 6379`，并加注释说明「dev = 5433 / CI = 5432」。`database.ts` 兜底 `|| '5432'` 兼容两端 |
| 2026-06-22 | T-FOLLOW-4 smoke test 容器内 `localhost` 解析问题：容器内 `localhost` = 容器自己 loopback，不是 host。直接用 `DB_HOST=localhost` 会连不上 host 上的 PG/Redis | `docker run --add-host=host.docker.internal:host-gateway` + `DB_HOST=host.docker.internal`（Docker 20.10+ Linux 支持）。文档化在 `docs/deploy.md` § 自定义 build |
| 2026-06-22 | T-FOLLOW-5 Task 1 spec 偏差: 实际 test 数 14 (8 已有 + 1 env var + 5 checkMigrationsStatus 边界), 不是 spec 写的 9; 需新增 `migrate.d.ts` 声明文件供 .ts 引用 | 实测 14/14, 接受偏差; `migrate.d.ts` 是 TS interop 标准做法, ts-jest + tsc 都需 |
| 2026-06-22 | T-FOLLOW-5 Task 2 spec 偏差: `tsc` 不编译 `.js` 文件, `dist/scripts/migrate.js` 不会自动生成 | Dockerfile 显式加 `COPY src/scripts/migrate.js /app/dist/scripts/migrate.js` |
| 2026-06-22 | T-FOLLOW-5 Task 4 code review 发现 bug: `docker compose up -d backend` 不加 `--force-recreate` 时, pull 新镜像不会被实际加载, 旧容器继续跑 | 改为 `docker compose up -d --force-recreate backend` (commit 52c625e) |
| 2026-06-22 | T-FOLLOW-5 Task 5 code review 发现 bug: `workflow_run` 触发时**不**自动 checkout, `script_path: scripts/deploy.sh` 找不到文件 | 加 `actions/checkout@v4` step, ref 用 `head_sha || github.sha` (commit eee5c29) |
| 2026-06-25 | T-FOLLOW-6 推送后 CI Run #28099535056 failed: "Apply database migrations" exit 1。根因：migrate.js (T-FOLLOW-5 commit 4f924e6 引入) 第一行 `require('../config/database')` 是 .ts 源文件，但 CI workflow 只 `npm ci` 不 `npm run build`，dist/ 没生成 → MODULE_NOT_FOUND。CI 自 T-FOLLOW-5 推送起就一直是失败状态，前 2 次 push 推送者未察觉 | 选 Option B：migrate.js 内联 pg.Pool + dotenv，让 .js 文件不依赖 .ts 编译产物；改 jest.mock 'pg' 替换 '../config/database'，bootstrap 走 pool.connect 调高各 case 计数（4/10/2）。修复后 14/14 migrate test 全绿，dist 不再需要 migrate.js 的 .ts 编译路径。Commit 0079eb2 (本地，待 push 验证 CI) |
| 2026-06-26 | T-FOLLOW-7 首次部署失败：v0.1.1 tag 推送后 Deploy workflow run #28175599367 失败，job 8s 内 exit 1（太短，跳过 health check 30s 窗口，失败必在 [1/6]~[3/6]）。`set -euo pipefail` 模式下任一前置命令失败即终止，错误信息仅 "Process completed with exit code 1"，无 step-level 输出（WebFetch 拿不到详细 log，需登录 GH UI）。最可能根因：(a) `docker compose pull backend` 拉不到 `:latest`（网络/认证问题，v0.1.0 部署时正常，可能 VPS 状态变化）；(b) `docker compose run --rm migrate` 启动后 migrate.js 报错；(c) `docker compose up -d --force-recreate backend` 容器启动失败。生产 backend 仍跑 v0.1.0，`.last_good` 仍未写入 | 临时：SSH 到 VPS 跑 `bash -x scripts/deploy.sh 2>&1 | tee /tmp/deploy-debug.log` 拿具体失败行；定位后修复并重 push tag (v0.1.2 或 amend v0.1.1)。长期改进：deploy.sh 在 `set -e` 模式下失败时打印 "FAIL at line N" 上下文；考虑分步 `|| true` 包裹非关键检查 (`.last_good` 读写) 让 deploy 状态可分 |

---

*此文件将在项目开始开发后逐步填充*
