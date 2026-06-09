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
