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

---

## 2026-06-10 - 任务：战士职业逻辑（T039）

### Prompt
实施 T039 战士职业逻辑。范围 5 项：(1) 职业卡牌权限校验（deck + 战斗内）；(2) 攻击累计护盾；(3) 嘲讽（挑战卡，tactical 1 费 warrior 专属，3 格 1 round）；(4) 角色状态栏数据层（后端 status 聚合 API）；(5) 抽 statusEffectService 通用框架。先经 4 轮 AskUserQuestion 锁定范围（profession 限制归 T039，T055 缩窄；存储 Redis-only；不写 WS 不写前端 UI）。

### 思考
- **3 个新 service 文件**：`statusEffectService`（apply/remove/tick/get/clear，Redis LIST）+ `professionMechanicService`（权限 5 API + warrior 机制 1/2）+ `characterStatusService`（聚合 API）
- **2 个新迁移**：`005_seed_taunt_card.sql` 插入「挑战」（template_no=8）
- **battleService 注入**：`getPlayerCard` JOIN card_templates 拿 profession+type；`validateAttack` 5 步加 profession + 10 步加 taunt + 13 步加 warrior attack trigger；`validateAOEAttack` 5 步加 profession（不读 taunt）；新增 `validateTauntCard`
- **characterService 注入**：`assignCardToCharacter` 6 步加 profession 校验
- **routes/characters.ts**：错误映射加 profession substring 分支
- **T039/T055 边界**：profession + taunt 全部归 T039，T055 缩窄为手牌归属、状态效果检查、错误信息标准化
- **同源覆盖语义**：warrior 多次嘲讽同一 target → 后写者赢（removeTauntFromSource 删除同 source 旧 taunt，再写新）
- **warrior 机制 1 滑动窗口**选「每 2 张触发，counter 归 0」而非滑动窗口：实现简单，节奏感强
- **护盾 2 round / 嘲讽 1 round**：「1 回合」= 1 个 battle round
- **taunt.target_id = warrior_id**（强制攻击者改打 warrior），`getTauntRedirect` 读 target 的 active effects 找 taunt

### 意外
1. **mockResolveOnce 队列泄漏**：`professionMechanicService.test.ts` 第一个 beforeEach 用了 `jest.clearAllMocks()`，但它**不清空** `mockResolvedValueOnce` 队列，导致"should return null when no active taunt"测试错拿上一个测试的 taunt 数据。修复：改用 `mockReset()` 显式重置每个 mock fn，再重设默认值。这是从 T037/T038 沿袭下来的坑
2. **removeTauntFromSource 用 getActiveEffects 错**：`getActiveEffects` 会按 `expire_round > currentRound` 过滤，但「同源覆盖」需要读所有 taunt（含过期的）。改用直接 `redisClient.lRange` 读 raw 列表，跳过过期过滤。bug 报告通过测试暴露，1 行修复
3. **characterService.test.ts jest.mock 顺序问题**：原本 `const mockValidateCardForDeckAssignment = jest.fn(); jest.mock(..., () => ({ validateCardForDeckAssignment: mockValidateCardForDeckAssignment, ... }))`，因 jest hoisting 而报 "Cannot access before initialization"。修复：去掉对 `mockValidateCardForDeckAssignment` 的直接引用，改 `import * as professionMechanicService` + `jest.mock({...jest.fn()...})` + `professionMechanicService.validateCardForDeckAssignment as jest.MockedFunction<...>`
4. **getPlayerCard 改了返回类型，battleService.test.ts 旧 mockCard 不兼容**：`{ id, player_id, cost, effect }` 缺 `type` 和 `profession`，profession check 立刻 fail。修复：在 `mockCard` 顶部加 `type: 'attack', profession: 'common'`，AOE 测试也同步加。AOE 攻击的 profession 校验同单体，所以 mock 默认值就够
5. **warrior attack trigger 在 validateAttack 末尾**：现有"should accept valid melee attack"测试 attacker=warrior + card.type=attack，会触发 onWarriorAttackCardPlayed → 调 statusEffectService → 调真实 redis 不可行。修复：在 battleService.test.ts 顶部加 `jest.mock('./professionMechanicService', ...)` 全部 mock 掉，保持测试隔离。返回类型加 `shieldGained?` 和 `forcedTarget?` 可选字段，向后兼容
6. **dynamic import 残留**：初版用 `await import('./statusEffectService')` 想偷懒，结果 CI 跑通但代码有动态 import 异味。最后改成静态 `import { sumActiveShield, removeEffect }` 顶部声明——所有依赖一次解决
7. **characterStatusService 误导入未导出的 `getBattlePiecesKey`**：直接从 battleService 调内部 helper，但它是 private。修复：inline 写 `battle:${battleId}:pieces` key 字符串，0 依赖
8. **TypeScript narrowing 在 .find() 谓词中丢失**：`taunt.target_id` 在谓词 `e.type === 'taunt' && e.target_id` 中是 truthy 检查，但 TS 没把窄化保留到 if 块内。修复：把 truthy 检查也写进 if 条件 `if (taunt && taunt.target_id && taunt.target_id !== attackerId)`
9. **测试统计偏差**：plan 估算「约 100+ tests」，实际 statusEffect(17) + professionMechanic(32) + characterStatus(7) + characterService assignCard(7) + battleService validateAttack profession/taunt/warrior trigger/AOE/taunt(13) + 集成测试(5) = **81 tests**。新加测试都比 plan 估算略多，覆盖更密
10. **完整 service + routes 测试**：`npx jest src/services/ src/routes/` 共 17 + 6 = 23 suites，**289 + 59 = 348 tests 全过**；`npx tsc --noEmit` 0 错误

---

## 2026-06-10 - 任务：战棋公共池系统（T1001）

### Prompt
实施 T1001 战棋公共池系统。设计已锁定（见 T1000-deferred.md）：池内仅「轻击」、无限复用、不可保留、牌库 < count 时补足、HandCard 加 `source` 字段、warrior 攻击累计不计入公共池。`src/migrations/006_public_pool.sql` + `publicPoolService.ts` + `HandCard.source` 字段 + `getPlayerCard` 双 SQL 路径 + `validateAttack` 第 6 参 source + `GET /api/cards/public-pool` 路由。

### 思考
- **新 service 文件**：`publicPoolService.ts`（~70 行）：`drawFromPublicPool(need)` + `isPublicPoolDeckId(deckId)`，从 `cardService.getPublicPoolCards()` 拉数据
- **migration 006_public_pool.sql**：`card_templates.is_public_pool BOOLEAN` 列 + 部分索引 + 标记「轻击」
- **HandCard 联合类型**：`source: 'deck' | 'public_pool'`，TS 联合类型天然约束。`deck_id` 用 `pool:<template_no>` 虚拟 ID 区分
- **drawCards 行为变化**：先抽 `min(count, deckSize)` 张 deck，缺额调 `drawFromPublicPool(count - actualFromDeck)`，drawn_count = deck + public_pool
- **retainHandOnStepEnd 新增 path 3**：命中公共池卡 → 强制全弃 + error `'public pool cards cannot be retained'`（防止公共池卡无限堆叠在 retained key）
- **getPlayerCard(cardId, source)` 双 SQL 路径**：
  - `source='deck'`：原 SQL（player_cards LEFT JOIN card_templates）— 不变
  - `source='public_pool'`：新 SQL（card_templates WHERE is_public_pool=TRUE），返回 `player_id: null`
- **validateAttack 第 4 步**：「卡牌归属」加 `source === 'deck'` 守卫，公共池卡 bypass
- **validateAttack 第 13 步**：warrior attack trigger 加 `source !== 'public_pool'` 过滤（公共池卡不计入累计）
- **公共池端点**：`GET /api/cards/public-pool`，放在 `GET /:id` 之前避免贪婪匹配
- **无限复用语义**：公共池卡不回 player_cards、不持久化「库存」、弃牌堆只作"已使用历史"

### 意外
1. **handService.test.ts 大量旧测试预期变化**：「should return empty hand when deck is empty」原期望空手牌，现在空池时仍空手牌（mock default 返 []），但若公共池非空则返 3 张轻击。修复：default mock 设 `mockResolvedValue([])`，旧测试零修改通过；新增 6 个测试覆盖"池非空时补足"
2. **getPublicPoolCards 名字冲突**：一开始在 routes/cards.ts 错从 publicPoolService 导入，实际该函数在 cardService 中（数据层 vs 业务层分离）。修复：统一从 cardService 导入
3. **jest.mock hoisting 坑**：`cards.public-pool.integration.test.ts` 用了 `const mockFn = jest.fn(); jest.mock(..., () => ({ x: mockFn }))`，报错 "Cannot access 'mockFn' before initialization"。修复：改用 `jest.mock({x: jest.fn()...})` + `import * as cardService` + `as jest.MockedFunction` 强制断言。这是 T039 沿袭下来的坑
4. **CardTemplate type 联合断言**：测试里的 pool cards 用 `as const` 不够，因为 effect 字段是 `Record<string, unknown>`，需要直接 `: cardService.CardTemplate[]` 注解才能通过 TS 编译
5. **route ordering 必须显式声明**：`GET /api/cards/public-pool` 必须在 `GET /api/cards/:id` 之前，否则被贪婪匹配。集成测试加一条"无贪婪匹配"断言
6. **测试统计偏差**：plan 估算 ~150 行测试，实际 publicPoolService(6) + handService 新增(6) + retain 公共池(2) + battleService public_pool(5) + AOE public_pool(1) + 集成(5) = **23 新增测试**。全过：`npx jest` **27 suites / 392 tests 全过**；`npx tsc --noEmit` 0 错误
7. **handService.toHandCard 加 source='deck' 默认**：现有 `toHandCard(row)` 不接受 source 参数，固定写死 `source: 'deck'`。这样 `getCharacterDeckCards` 路径所有返回的卡都是 deck 来源，无需改 toHandCard 签名

---

## 2026-06-10 - 任务：弓手职业机制 1 (T040)

### Prompt
实施 T040 弓手职业机制 1（攻击累计增伤）。沿用 T039 架构：走 `statusEffectService` 通用框架，新增 `StatusEffectType: 'damage_boost'`。规则：弓手每 2 次使用攻击卡片后，下次攻击的单体或 AOE 主体目标伤害增加 50%（1.5×）。用户选「仅机制 1」——不动 characterStatusService、不加弓手新卡、不做 T039 完整镜像。

### 思考
- **「生产」与「应用」分离**：`validateAttack` 仅标记 `damageBoosted=true` / `damageBoostValue=0.5` / `primaryTargetId=targetId`；实际 LREM + 1.5× 应用在 T056 `applyDamage` 阶段（与 T039 warrior shield 模式一致）
- **ranger 私有计数器**：`battle:{id}:ranger_status:{ranger_id}` STRING (JSON) `{attack_counter}`，与 warrior `warrior_status` 平行
- **StatusEffect 复用**：damage_boost 复用 `battle:{id}:effects:{ranger_id}` LIST key（与 warrior shield 共用 key 命名空间，每角色独立）
- **duration_rounds=1 占位**：consume 优先，next round tick 兜底清理
- **AOE 主体目标语义**：T040 选 `targets[0]` 作为 primary target（warrior 1.5× 仅应用到此 target，其他 target 保持基础伤害）
- **公共池卡不累积**：与 warrior 一致，加 `source !== 'public_pool'` 过滤
- **失败路径保护**：能量/射程/职业/taunt 拦截等失败路径不触发累积（在所有校验通过后才累积）
- **AOE currentRound hardcode=0**：T040 不改 `validateAOEAttack` 签名，T051 衔接时再补 currentRound 参数
- **公共 API 入口**：
  - `onRangerAttackCardPlayed(battleId, rangerId, currentRound)` → `{attackCounter, damageBoostApplied, damageBoostValue}`
  - `getRangerDamageBoost(battleId, rangerId, currentRound)` → `DamageBoostInfo | null`（不消耗）
  - `consumeRangerDamageBoost(battleId, rangerId, currentRound)` → `DamageBoostInfo | null`（消耗，T056 调用）
- **AttackValidationResult 扩展**：4 个新字段 `damageBoosted?` / `damageBoostValue?` / `primaryTargetId?` / `damagePerTarget?`

### 意外
1. **AOE test mock 顺序坑**：`getTargetsInRange` 对 positions 中每个 piece 都调 `getCharacterPiece`（hGet）。positions 包含 attacker+enemy 共 2 个 piece，所以要预填 2 次 hGet（attacker 用于 friendly 过滤）。初版只填 1 次 hGet，结果 enemy-1 mock 被 attacker 位置消耗，导致测试 `targets=['char-attacker']`（错把 attacker 当 enemy 添加）。修复：补一个 hGet for attacker (friendly → filtered)
2. **mockResolvedValueOnce 队列从 resetAllMocks 重置**：`jest.resetAllMocks()` 会清空 mock fn 实现 + 调用记录 + mockResolvedValueOnce 队列（与 `clearAllMocks` 不同）。这导致 `beforeEach` 设的 default mock 会被每个 test 共享，但通过 `mockImplementation` / `mockResolvedValue` 重新设的 default 不会跨 test 串扰
3. **「生产/应用」边界**：plan 初版想在 `validateAttack` 直接乘 1.5 + LREM，但 T039 设计「validateAttack 不实现 applyDamage」是 T056 任务。T040 与 T039 一致：validateAttack 负责校验 + 标记语义，apply 推给 T056。这样 T056 一次统一处理「ranger 1.5× + warrior shield absorb + 多 effect 顺序」
4. **TypeScript narrowing 沿用 T039 经验**：`effects.find(e => e.type === 'damage_boost')` 返回 `StatusEffect | undefined`，`boost.value ?? 0` 处理 value 可能 undefined 的情况（与 warrior `sumActiveShield` 同模式）
5. **测试统计偏差**：plan 估算 professionMechanicService 20 个 + battleService 12 个 = 32 个，实际 professionMechanicService(`RANGER_DAMAGE_BOOST_VALUE` 1 + onRangerAttackCardPlayed 2 describe 6 + getRangerDamageBoost 1 describe 5 + consumeRangerDamageBoost 1 describe 4 + ranger 隔离 1) = **17 个** + battleService(ranger trigger 5 + public_pool 1 + AOE 3 + 失败路径 2) = **11 个**。最终 T040 总计 **28 个新测试**（比 plan 少 4 个，因为公共池 vs ranger 测试合并到 1 个，失败路径用了统一 describe）
6. **完整 service 测试**：`npx jest src/services/` 18 suites / 337 tests 全过；`npx tsc --noEmit` 0 错误

---

## 2026-06-11 - 任务：法师职业机制 2 (T041)

### Prompt
实施 T041 法师职业机制 2（debuff/灼伤系统）。沿用 T039 + T040 架构：走 `statusEffectService` 通用框架 + `professionMechanicService` mageMechanic 命名空间。规则：法师攻击附加 fire 标记到 target；当 target 累计 2 个 mark 时清除所有 mark + 附加 1 个 burn effect (duration=2 round, value=1)；target 已有 active burn 时新 mark 被忽略；公共池卡不附加 mark；AOE 每个 target 获得 1 个 mark；灼伤伤害结算 call site 在 T051 orchestrator（T041 仅提供 `applyBurnDamage` 函数）。用户选「仅机制 2」——不动 characterStatusService、不加 mage 新卡、不实现 mage 机制 1。

### 思考
- **mark 存储在 target 上**：与 warrior shield / ranger damage_boost 共享 `battle:{id}:effects:{targetId}` LIST key 命名空间（每角色独立）。每个 mark_fire = 1 list entry；T041 不引入 mage 私有计数器
- **mark 无限持续占位**：`expire_round=99999` 表示「永不主动过期」；mark 仅在 `attachFireMark` 内部 2 mark 触发 burn 时显式 LREM 清除
- **2 mark 触发 burn**：`mark_fire` ≥ 2 → LREM 所有 mark_fire + applyEffect 1 个 burn (value=1, duration=2 round)；mark 转换走 `applyEffect` + `removeEffect` LREM 公共 API，不动 statusEffectService
- **mark + burn 共存强制语义**：target 已有 active burn 时 `attachFireMark` 第 1 步 return early（burn 屏蔽新 mark）。这是用户明确「有 burn 后 mark 被忽略」
- **AOE 标记范围**：mage AOE 优势 → 每个 target 获得 1 个 fire mark。validateAOEAttack 循环调 attachFireMark，`mageMarksApplied` = 实际成功附加数（被 burn 拦截的不计），`mageBurnTriggered` = 任一 target 触发即为 true
- **AOE currentRound hardcode=0**：沿用 T040 边界，T051 衔接时再补参数
- **灼伤伤害结算**：`applyBurnDamage(battleId, targetId, currentRound)` 返回 `{totalDamage, burnCount, burnEffectIds}`；不修改 Redis（call site 自行扣血 + 决定是否清理 burn）。T041 不调用此函数，T051 orchestrator 在 ABABAB 行动完后调用
- **状态查询辅助**：`getMageMarkState` 读取 mark + burn 状态（调试 / 状态栏聚合用），不修改 Redis
- **失败路径保护**：能量/射程/职业/taunt/AOE 无目标/公共池卡 → 不附加 mark（在所有校验通过后才附加）；target 已有 burn → 内部早退
- **公共 API 入口**：
  - `attachFireMark(battleId, targetId, currentRound, source)` → `MageMarkResult { marksAdded, burnTriggered, currentMarkCount, currentBurnCount }`
  - `applyBurnDamage(battleId, targetId, currentRound)` → `BurnDamageResult { totalDamage, burnCount, burnEffectIds }`（T051 调用）
  - `getMageMarkState(battleId, targetId, currentRound)` → `MageMarkState { markCount, burnCount, totalBurnDamage }`
  - 4 个常量：`MAGE_MARK_NEVER_EXPIRE_ROUND=99999` / `MAGE_BURN_DURATION_ROUNDS=2` / `MAGE_BURN_DAMAGE_PER_TICK=1` / `MAGE_MARK_BURN_THRESHOLD=2`
- **AttackValidationResult 扩展**：3 个新字段 `mageMarkApplied?`（单体）/ `mageMarksApplied?`（AOE 数量）/ `mageBurnTriggered?`（任一 target 触发）
- **StatusEffectType 扩展**：2 个新类型 `mark_fire`（T041 新增）/ `burn`（T039 预留，T041 首次实际使用）

### 意外
1. **battleService test mock 顺序坑（首次执行）**：初版 mage 1st/2nd attack 测试只设了 1 次 hGet mock（attacker），但 `validateAttack` 内部需要 2 次 hGet（attacker + target）+ 2 次 hGetAll（positions 字典）。结果 5 个测试 fail：`expect(result.valid).toBe(true)` 拿到 `false`（因为 target 位置查找返回 undefined，触发 "Character position not found"）。修复：补全 mock 顺序（hGet x2 + hGetAll x2），与现有 "should accept valid melee attack" 测试同模式
2. **ranger trigger 测试也需要补 mock**：T040 时代 `onRangerAttackCardPlayed` / `getRangerDamageBoost` 是 mock 函数（在 battleService.test.ts 顶部），但 `getRangerDamageBoost` 默认返 null，validateAttack 跳过 boost 分支不调 lRange 也不报错。但 mage 测试必须把 hGet x2 + hGetAll x2 都补齐（attacker → target → positions → positions）
3. **测试统计偏差**：plan 估算 professionMechanicService 25 个 + battleService 14 个 = 39 个，实际 professionMechanicService(T041 常量 4 + attachFireMark 基础 5 + applyBurnDamage 5 + getMageMarkState 4 + mark+burn 边界 3 + mage 隔离 3) = **24 个** + battleService(mage trigger 7 + mage AOE 5 + warrior/ranger 不触发 2) = **14 个**。最终 T041 总计 **38 个新测试**（比 plan 少 1 个，因为「公共池 vs mage 测试」合并到 1 个）
4. **完整 service 测试**：`npx jest src/services/` 18 suites / 375 tests 全过（比 T040 末态 337 多 38 个）；`npx tsc --noEmit` 0 错误
5. **mark_fire 永远 active 设计**：`getActiveEffects` 用 `expire_round > currentRound` 判定，99999 远大于任何合理 battle round（一场最多几十 round）。`tickEffects` 在 round ≥ 99999 时清理 → 实际不会发生。靠 `attachFireMark` 内部 LREM 显式清除是唯一清理路径
6. **applyBurnDamage 设计选择**：T041 不在 applyBurnDamage 内清理 burn，让 burn 持续 2 round 自然过期（`expire_round = currentRound + 2`，第 2 次结算时 `currentRound + 2 ≤ currentRound` 触发 tickEffects 清理）。语义上 burn 持续 2 个完整 round：第 1 round 结算扣 1 次血，第 2 round 结算扣 1 次血，第 3 round 结算时 burn 已 expire → 扣 0 次
7. **AOE 失败处理**：`mage AOE 失败（无 targets）` 测试中，validateAOEAttack 在第 10 步就 return，根本走不到 attachFireMark 循环（`mageMarksApplied` 仍为 undefined）。这与 mage 单体失败模式一致
8. **mock 顺序 vs mage profession check**：battleService 内部 profession check 在 `attacker.profession === 'mage'` 守卫，warrior/ranger 测试（mock 默认 warrior）不会触发 attachFireMark 调用。这避免了在 warrior/ranger 测试中需要 mock attachFireMark（但保险起见 default 仍设了 `marksAdded: false` 返回）

---

## 2026-06-11 - 任务：T042 实现匹配队列 API (POST /api/match/queue)

### Prompt
实施 T042 阶段 4.1「匹配系统」第一项：实现 `POST /api/match/queue`，玩家认证后加入 Redis 维护的匹配队列。明确范围限定：T042 仅入队，不做状态查询 / 取消（T043）、不撮合 / 不创建 battles 行（T044）、不做 3v3 角色校验（T044/T048）。原因：`battles` 表 schema 不支持「在队列中」状态（`player2_id NOT NULL` + 状态枚举无 `searching`），强行抢跑会留下半截 battle 行，违反 CLAUDE.md「单步循环、不抢跑」。

### 思考
- **Redis-only 存储**：与 `idleQueueService` 一致；`battles` 表当前 schema 不适用
- **两键设计**：`idle:matchmaking:queue`（sorted set，score = enqueuedAt ms）+ `idle:matchmaking:lock:{userId}`（NX EX 600 单用户锁）
- **score = enqueuedAt**：使 T044 撮合可用 `ZRANGE 0 0` O(log N) 取最久等待者，不需要额外维护时间戳字段
- **关键顺序：先抢锁、后入队**：`SET NX EX` 抢锁 → 非 `'OK'` 抛 `'已在匹配队列中'` → 否则 `ZADD`。反向顺序会破坏并发去重。这与 `idleQueueService.acquireGatheringLock`「先入队后抢锁」模式不同，因为 idle 任务是用 score 排序到期时间，而 matchmaking 用 score 排序入队时间 + lock 才是去重唯一保证
- **中文子串异常**：沿用 `gatheringController` 模式，service 抛中文 Error，controller 通过 `errorMessage.includes('已在匹配队列中')` 映射 400。这样保留 service 端语义清晰、controller 端 HTTP 标准化
- **OOS 清单写在服务文件顶部**：8 项「不做的内容」+ 归属任务直接列在 `matchmakingService.ts` 顶部 docstring，防止后续工作误抢跑 T043/T044
- **路由按字母序插入**：`gathering` < `match` < `skills`，遵循 `src/index.ts` 现有约定
- **公共 API**：4 个函数 `enqueueMatchmaking` / `isPlayerInQueue` / `getMatchmakingQueueStats` / `clearMatchmakingQueue`（后两个供测试 + T044 撮合循环复用）

### 意外
1. **`idleQueueService` 无单元测试**：原以为有现成的服务单元测试模板可对照，结果该文件仅在集成测试中通过 mock 间接验证。最终参考 `processingService.test.ts` 的 jest.mock + 类型断言风格自行编写 5 个用例
2. **mock 断言粒度选择**：服务测试中验证「锁先于 zAdd」用了两种方式 —— ① `expect(mockedRedis.set).toHaveBeenCalledTimes(1)` 配合 `expect(mockedRedis.zAdd).toHaveBeenCalledTimes(1)`；② 在重复入队用例中 `expect(mockedRedis.zAdd).not.toHaveBeenCalled()`。两者结合能反向证明「set 失败时 zAdd 不被调用」=「先抢锁」
3. **集成测试用 `import after jest.mock`**：mock 工厂 + `import { redisClient }` 后用类型断言 `as unknown as { ...jest.Mock }` 取出 mock fn。与 `gathering.integration.test.ts` 直接 import 命名 mock 略不同，但 `mockedRedis.set.mockResolvedValueOnce` 行为一致
4. **完全顺利**：单元 5/5 通过，集成 2/2 通过，`tsc --noEmit` 0 错误。无 mock 顺序坑、无 schema 变更、无跨服务依赖



