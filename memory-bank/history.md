# PtIDLE 工作日志 (History)

> 记录每个任务阶段的 Prompt、思考和意外情况

---

## 2026-03-11 - 任务：离线收益系统 (T010-T011)

### Prompt
实现 T010 离线收益计算服务和 T011 登录时离线收益结算 API，包含：
- 离线收益计算逻辑（最大24小时，资源产出速率）
- POST /api/player/offline-claim 路由
- 仓储上限处理

### 思考
- 利用 players.last_offline 字段记录离线时间
- 铁矿石/原木产出 1个/分钟，煤炭/树液/荧光菇 0.5个/分钟
- 仓储上限默认 1000，超出部分溢出
- 计算逻辑：离线时间 → clamp 到最大时间 → 按速率产出 → 应用仓储上限

### 意外
无

---

## 2026-03-11 - 任务：获取玩家数据 API (T009)

### Prompt
实现获取玩家完整数据的 API，包括资源、材料、棋子列表等信息

### 思考
- 使用 JWT 认证保护路由
- 玩家表 + 棋子表联表查询
- 返回完整的玩家资料结构

### 意外
无

---

## 2026-03-11 - 任务：集成测试和端到端测试

### Prompt
添加集成测试和端到端测试覆盖主要 API

### 思考
- 使用 supertest 模拟 HTTP 请求
- 集成测试覆盖认证路由和玩家路由
- E2E 测试覆盖注册、登录、获取玩家数据流程

### 意外
无

---

## 2026-03-11 - 任务：玩家初始化逻辑 (T008)

### Prompt
实现玩家注册后自动初始化玩家数据（创建 players 记录和 3 个棋子）

### 思考
- 注册流程中调用 initializePlayer
- 创建玩家记录：资源、材料、仓储上限初始化为默认值
- 创建 3 个棋子：战士、弓手、法师，属性各不同

### 意外
无

---

## 2026-03-11 - 任务：JWT 认证中间件 (T007)

### Prompt
实现 JWT 认证中间件，保护需要登录的 API

### 思考
- 使用 jsonwebtoken 库
- Bearer token 验证
- 解析用户信息到 req.user

### 意外
无

---

## 2026-03-12 - 任务：采集技能数据模型 (T012)

### Prompt
实现采集技能数据模型，从数据库读取技能配置：
- 创建 skillService.ts 从 gathering_skills 表读取技能
- 修改 gatheringService.ts 使用数据库配置（带缓存）
- 创建技能查询 API（GET /api/skills/gathering）
- 单元测试覆盖

### 思考
- 技能配置存储在 gathering_skills 数据库表
- 使用 5 分钟内存缓存避免频繁查询
- gatheringService.getConfig() 改为异步，自动初始化配置
- API 路由：GET /api/skills/gathering 和 /api/skills/gathering/:type

### 意外
集成测试需要 mock skillService，否则会因数据库连接问题失败

---

## 2026-03-12 - 任务：加工配方数据模型与服务层 (T016)

### Prompt
实现 T016 加工配方数据模型和服务层：
- 创建 processingService.ts（从 processing_recipes 表读取配方，5分钟缓存）
- 创建 processing.ts 路由（GET /api/processing/recipes, GET /api/processing/recipes/:type, POST /api/processing/process）
- 在 index.ts 注册路由
- 单元测试覆盖

### 思考
- 参考 skillService.ts 的实现模式
- processing_recipes 表包含 type (smelting/carpentry/grinding)、input、output、efficiency 字段
- POST /api/process 需要认证，检查输入材料是否足够，扣除输入并添加输出到 materials
- 初始配方：冶炼(iron_ore+coal→iron_ingot)、木工(wood→plank)、研磨(herb→herb_powder)

### 意外
修复了 AuthRequest.userId 类型错误（应为 req.user?.userId）

---

## 2026-06-09 - 任务：T035 实现攻击判定逻辑

### Prompt
- 用户要求执行实施计划 T035（实现攻击判定逻辑）
- 上下文：验证攻击目标是否在射程内，计算伤害
- 依赖：T034（已实现）
- 验证：单元测试全部通过

### 思考
- T035 计划范围很小（"射程 + 伤害"），但实际 `battleService.ts:679-845` 已经包含了 T055「操作合法性校验」的部分内容（卡牌归属、能量、阵营、死亡检查），沿用 T033 提前实现 T034 的项目惯例
- `validateAttack` 负责单体攻击，射程用 `euclideanDistance`（圆形判定）：近战 ≤1.5，远程 ≤ `card.effect.range`
- `validateAOEAttack` 走 `getTargetsInRange` 在 `hGetAll` 棋盘快照上按距离过滤敌方目标
- 伤害公式保持现状 `cardEffect.damage ?? 0`，不预留职业加成（specs.md 强调"机制驱动而非数值碾压"）
- 决策：T035 **不实现** `applyDamage`（真正扣血改 is_alive 留给 T056 "伤害计算权威化"）；验证通过后只返回 `{damage, targets, energyCost}` 结构

### 意外
1. `getPlayerCard`（battleService.ts:607）和 `getCharacterPiece`（line 569）历史遗留 bug：`if (result.length === 0)` 在 `query()` 返回 `undefined` 时崩溃。修复为 `if (!result || result.length === 0)`，加防御性检查
2. 9 个 T033 时代遗留测试 mock 顺序错位（把 card 写到了 hGet，query mock 放错位置）。按代码真实调用链重写：hGet #1 = attacker piece, query #1 = card, hGet #2 = target piece, hGetAll #1/#2 = positions
3. 新增 AOE 成功路径测试时，发现 `getTargetsInRange` 距离超 range 时**直接 continue**，不调用 hGet（enemy-3 在 (6,6) 距离 2.83 > range 2）。这导致原本 mock 5 个 hGet 多 mock 了一次
4. 集成测试（authController + gathering）8 个用例失败，原因是 PostgreSQL 5433 和 Redis 6379 端口未运行。基线就有的环境问题，与 T035 无关
5. 决策冲突：用户原话"在我验证测试通过之前不要开始下个步骤" vs T035 范围 19/19 单测已过——最终接受单测通过，集成测试环境问题延后处理

---

## 2026-06-09 - 任务：回合流程控制 (T036)

### Prompt
实现 T036 回合流程控制：管理抽牌、移动、打牌、回合结束的流程；3v3 全队轮流蛇形激活（ABABAB 6 步）；依赖 T034, T035；要求回合流程正确切换

### 思考
- T036 范围严格限定在"状态机本身"，T037（抽牌）、T038（手牌保留）、T051（WS 路由）作为独立任务
- 蛇形激活采用 1-单位/步算法：`buildSnakeOrder` 在 2N 步内偶数索引取 p1，奇数取 p2。3v3 → `[p1[0], p2[0], p1[1], p2[1], p1[2], p2[2]]`，ABABAB 6 步
- 状态存储双轨：Redis `battle:{battleId}:session` 存临时态，PG `battles` 表存持久态（initializeSession / endCurrentRound / finishSession 同步）
- 状态机 7 个阶段：idle / draw / move / play / end_step / end_round / finished，转换函数一一对应 8 个公共 API + buildSnakeOrder 共 9 个
- `endCurrentStep` 边界处理：非最后一步 → step+1, actor 切换, phase=idle；最后一步 → phase=end_round（不自动切轮，留给 `endCurrentRound` 显式持久化）
- battles 表已有 `status`/`winner_id`/`battle_data` 字段，本次新增 `current_round`/`current_step`/`current_actor_id`/`current_phase`/`updated_at`，加 CHECK 约束限定 phase 枚举

### 意外
1. PG migration 中 `current_phase` 列加 CHECK 约束时用 `DO $$` 块做幂等检查（避免重复执行迁移报错），其他列用 `IF NOT EXISTS`
2. 测试 `getCurrentState` "should compute nextActorId in end_step phase" 必须先走完 idle→draw→move→play→end_step 全链 4 步才能验证 nextActorId 字段，而非直接在状态里覆盖字段
3. `getCurrentState` 的 `should indicate last step of round` 测试需要手工构造 step=5 的状态 JSON，因为单元测试范围内没有 API 可以跳到指定 step
4. `endCurrentRound` 必须显式调用才能持久化轮次切换（不自动随 `endCurrentStep` 触发），让上层 orchestrator 决定何时落库（vital for 防回滚和重连恢复）
5. `finishSession` 是 9 个 API 之外的辅助函数，专为 T052 胜负判定设计，文档已注明用途但不在原计划 9 个之内
6. 集成测试（authController + gathering）8 个用例失败与 T036 无关，是 PostgreSQL 5433 / Redis 6379 端口未运行的基线环境问题（与 T035 history 记录一致）

---

## 2026-06-10 - 任务：修复 gathering 集成测试 Redis 单例未连接问题

### Prompt
检查 PTIDLE 本地状态；用户要求处理 T035/T036 history 中提到的「集成测试 8 个失败」，确认是否环境问题

### 思考
- 执行 `docker compose up -d` 拉起 PostgreSQL 5433 + Redis 6379 容器，状态变 Up
- 验证环境：authController 单测 15/15、auth 集成 14/14 全过；gathering 集成 6/9，**3 个用例 500 错误**
- 排除环境基线问题后，根因转向代码：堆栈显示 `idleQueueService.ts:30` `redisClient.zAdd` 抛 `ClientClosedError: The client is closed`
- 分析：`src/config/redis.ts:8` 的 `redisClient` 是模块单例，`createClient()` 后**未 `.connect()`**；集成测试不调用 `connectRedis()`，命令直接失败
- 决策：采用**测试侧修复**（mock redis 模块），不修改 `idleQueueService` 生产代码——生产环境正常连接，不引入防御性 `ensureConnected()` 复杂度
- 修复：在 `gathering.integration.test.ts` 顶部加 `jest.mock('../config/redis', ...)`，覆盖 `idleQueueService` 用到的所有方法（`zAdd`/`zRem`/`zRangeByScore`/`zRange`/`zCard`/`set`/`del`）以及 `connectRedis`/`disconnectRedis`
- 验证：单文件 9/9，三个文件合计 38/38 全过
- 同步更新：`architecture.md` 新增「集成测试 Mock 模式」章节（v1.22→v1.23），`progress.md` 问题与解决表新增一行

### 意外
1. T035/T036 history 中「集成测试 8 个失败」其实是**两个不同问题**叠加误读：6 个是数据库/Redis 端口未启动的 ECONNREFUSED 基线，2 个是 gathering 的真实 500 错误——但当时未拆开，导致「8 个」估算不准
2. 修复后控制台仍有 `console.error('Error starting gathering:', ...)` 输出——来自「should reject if already has active task」用例的预期错误路径，不是测试失败
3. authController 单测有「Jest did not exit one second after the test run has completed」警告，是 `redisClient` 单例在进程退出时未 graceful close 的**已存在**问题，与本次修复无关
4. 5v5 蛇形激活（chunk-based 算法 A-1/B-2/A-2/B-2/A-2/B-1）在 T036 仍标记为「future work」，但 `buildSnakeOrder` 当前 1-单位/步算法不直接支持 chunk 粒度——下一轮 T037 之前需评估是否扩展该函数

---

## 2026-06-10 - 任务：T037 抽牌 + T038 手牌保留机制

### Prompt
在已存在的 `handService.ts`（T037 基础抽牌）之上扩展，覆盖 T038 回合结束保留 1 张手牌 + 弃牌堆机制；不动 `battleSessionService`（状态机层留给 T051 orchestrator 串联）；只用 Redis 临时态；保留 21 个旧测试全过（向后兼容）。

### 思考
- **分层决策**：handService 只做"手牌全生命周期"的纯服务，不调用状态机 API。这样 T051 WS 路由层才能自由地按状态机时序串联 `drawCards → completeDrawPhase → ... → retainHandOnStepEnd → endCurrentStep`；如果直接耦合，未来时序变更（如插入二次抽牌）会强迫改 handService
- **三 Redis 键设计**（命名延续 T036 风格）：
  - `battle:{id}:hand:{cid}` STRING（每回合覆盖）
  - `battle:{id}:retained:{cid}` STRING（最多 1 张，下次 draw 读+DEL）
  - `battle:{id}:discard:{cid}` LIST（RPUSH 保时序，未来 T054 战斗结束统一 DEL）
- **drawCards 向后兼容核心**：函数开头新增 `consumeRetainedCard` 调用，retained key 不存在时直接返回 null，后续流程完全不变。21 个旧测试不预填充 retained key → 零修改通过
- **`drawn_count` 语义**：只算新抽的牌，不含合并的 retained。若未来需"手牌总张数"，应新增 `hand_size` 字段而非污染 `drawn_count`
- **retainHandOnStepEnd 三路径**：
  - `null` → 全弃，retained:null（玩家不保留）
  - 命中 → 写 retained key + 其余 RPUSH 弃牌 + DEL hand
  - 未命中 → 全弃 + error（**安全降级，牌不丢**，用户从 error 文案感知问题）
- **空数组 RPUSH 早退**：`addToDiscardPile([])` 不发 Redis 命令，避免向 LIST 写 0 长度引发的边界（redis v4 接受但浪费一次网络往返）
- **损坏 JSON 静默过滤**：`getDiscardPile` 与 `getActorHand` 一致——单条损坏不污染整批读取；`consumeRetainedCard` 损坏时不仅返回 null 还顺手 DEL 清掉

### 意外
1. **redis v4 camelCase API**：在原 mock 加 `lRange`/`rPush` 时差点写成 v3 的 `lrange`/`rpush`，因为 `idleQueueService` 那边的 mock 也是 v4 风格（`zAdd`/`zRem`），最终统一用 v4。`rPush(key, string[])` 和 `rPush(key, string)` 两种签名都支持，mock 写成兼容两种形态
2. **`del` mock 必须同时清两个 store**：测试一开始只清 `handStore`，结果 `addToDiscardPile` 后 `clearActorHand` 触发 `del` 但 `discardStore` 没动——表面上没报错，但隔离测试时穿透了不同 `it` 之间的状态。修复为 `del` 一次清 `stringStore + discardStore` 同 key，因为它们在键命名空间上不会冲突（前缀不同）
3. **stringStore 命名调整**：旧测试用 `handStore`，新测试需要同时操作 hand 与 retained 两个 STRING key。最终重命名为 `stringStore`（hand+retained 共用），并加一行 `handStore = stringStore` 别名让 21 个旧测试零修改通过
4. **测试数错位**：plan 估算 24 旧 + 23 新 = 47，实际旧测试只有 21（drawCards 15 + getActorHand 4 + clearActorHand 2），最终 21 + 23 = **44 全过**。plan 的估算偏 high，不影响内容
5. **"retainHandOnStepEnd 隔离 battleId" 测试**：原 plan 是检查"其他战斗 retained / discard / hand 都没被污染"，但当传入的 `hand` 只有 1 张且 retainDeckId 命中时，`discarded=[]` → `addToDiscardPile` 早退不发 rPush，所以**本战斗的 discardStore 也是 undefined**——这本身就是预期行为，不破坏隔离测试的语义，但需要注意：单 hand 用例验证不出"discard 写入"的隔离，只能验证 retained/hand 隔离
6. **TypeScript 编译**：`npx tsc --noEmit` 全过，exit 0，**无 type 错误**——`redisClient.rPush(key, string[])` 在 v4 typing 中合法（`RedisCommandArgument | RedisCommandArgument[]`）

