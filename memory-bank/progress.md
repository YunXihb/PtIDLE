# PtIDLE 执行进度记录 (Progress)

> 此文件由 AI 在项目开发过程中逐步填充
> 记录每个任务的执行状态、完成时间、遇到的问题等

---

## 待开发

| 任务ID | 名称 | 备注 |
|--------|------|------|
|  |  |  |

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
| 测试基线 | T055 收尾：41 suite / 688 test 全绿（新增 23 unit + 10 integration + 5 battleRoom 回归 = 38 新测试） | 2026-06-20 |

---

## 问题与解决

| 日期 | 问题 | 解决方案 |
|------|------|----------|
| 2026-06-10 | `gathering.integration.test.ts` 3 个用例（开始采集×2、取消采集）因 `ClientClosedError: The client is closed` 失败。根因：集成测试未调用 `connectRedis()`，但 `idleQueueService.zAdd/zRem` 路径要求已连接的单例 | 在测试文件顶部加 `jest.mock('../config/redis', ...)` 覆盖所有用到的 Redis 方法。同步更新 `architecture.md` 增加「集成测试 Mock 模式」章节。详见 history 2026-06-10 条目 |
| 2026-06-18 | T052 收尾时 `npx jest` 跑出 7 个失败（5 `authController` + 2 `socketServer`）。根因是开发环境缺 PostgreSQL/Redis 服务（`ECONNREFUSED 127.0.0.1:5433` + `ClientClosedError`），不是代码问题 | `docker compose up -d` 启动 `ptidle-postgres-1`（5433）+ `ptidle-redis-1`（6379）；`socketServer.test.ts` 在 `beforeAll` 加幂等 `connectRedis()`（用 `redisClient.isOpen` 防重复连）；`afterAll` 不调 `disconnectRedis()` 防止关掉跨文件共享的单例。修复后 36 个 test suite / 620 个 test 全绿。同步更新 `architecture.md` Docker 配置 + 集成测试模式 章节。详见 history 2026-06-18 条目 |
| 2026-06-18 | T053 spec compliance 收尾时发现 T053 describe block 落在 executePlayCard describe 之外（结构问题）；code quality review 发现 partial delete 路径在 withTransaction 回调内显式 ROLLBACK 导致回调返回后 withTransaction 仍会 COMMIT，产生 driver-level 副作用 + 双日志 | (1) 修正 T053 describe 嵌套位置（amend 6dd68da→be85e9a，b1f3d61 保留原状）；(2) 重构 consumePlayerCard 用 PartialDeleteError sentinel 替代 in-callback ROLLBACK，外层 catch 用 instanceof 区分 partial (warn) vs error (error)，commit b42f89f。修复后 5/5 T053 + 23/23 executePlayCard + 480/480 service + 4/4 database 全绿 |
| 2026-06-20 | T054 simplify review 发现：(1) applySettlementInTransaction 4 个近重复调用（4a 双 UPDATE + 4b 双 INSERT）易引入参数错位 bug；(2) controller switch 缺 exhaustiveness 检查，新增 error variant 会静默漏分支；(3) integration/unit test 的 `jest.spyOn(console, 'error')` 在 describe 顶层 spy，永不 mockRestore 会污染同进程后续测试输出；(4) integration test 残留无用 `_refs = {...}` 占位语句 | (1) 把 4 个对称 SQL 调用改写为 `for side of [p1/p2]` 循环 + `insertBattleHistory` 收 1 个 `side` 对象替代 7 位置参数；(2) controller switch 加 `default: const _exhaustive: never = result.error` + throw，让新增 error variant 编译失败；(3) 两处 console.error spy 改用 `beforeEach` 局部 spy + `afterEach mockRestore()`；(4) 删 `_refs` 行。修复后 21/21 T054 + 39/39 全量 suite 全绿 |

---

*此文件将在项目开始开发后逐步填充*
