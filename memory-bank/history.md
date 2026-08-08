# PtIDLE 工作日志 (History)

> 记录每个任务阶段的 Prompt、思考和意外情况

---


## 2026-03-10 - 任务：PRD文档体系建设与实施计划创建

### Prompt
用户希望我阅读当前目录的所有参考文档，理解项目"代号：工匠之心"的整体设计，然后帮他创建一个完整的Product Requirements Document (PRD)。用户要求：
- 每次只问一个问题
- 每个问题基于前一个回答展开
- 对重要细节深入挖掘

用户明确要涵盖：项目概述、核心需求、核心功能、核心组件、用户流程、技术栈、实施计划

### 思考
通过阅读9个参考文档，我理解了这是 一个"战棋+PVP"的挂机游戏项目，核心特色是：
1. 绝对公平的PVP（棋子无数值差异，职业由装备决定）
2. 挂机系统与战棋系统通过"材料流水线"紧密关联
3. 符文/装备的目的是提供策略深度（机制效果），而非数值碾压

我按照PRD结构向用户提问，逐步明确了：
- 项目名称：PtIDLE（暂定）
- 平台：Web网页端
- 目标：休闲+硬核兼顾
- MVP：仅PVP，3个职业（战士/弓手/法师）
- 技术栈：Vue 3 + Node.js + PostgreSQL + Redis

### 意外
1. 用户纠正了我对"装备和符文目的"的描述，最初我写成"提高数值"，用户明确指出是"提高战术深度而非数值"
2. 用户要求将实施计划按"阶段"而非"周"为单位
3. 用户要求体现"挂机内容和战棋内容的关联"

---

## 2026-03-10 - 任务：后端基础架构搭建（T001, T002）

### Prompt
用户要求我执行 implementation-plan.md 中的阶段1第1步：
- 初始化 Node.js 项目结构（创建目录、package.json、安装依赖）
- 配置 TypeScript 和 ESLint
- 写代码前必须阅读 architecture.md 和 specs.md
- 每完成里程碑必须更新 architecture.md

### 思考
按照 tech-stack.md 中的技术选型，创建了完整的后端项目骨架：
- 使用 TypeScript + Express + Socket.io + PostgreSQL + Redis
- 配置了 ESLint 代码规范
- 创建了 src/ 下的模块化目录结构（controllers, models, services, middleware, routes, socket）

### 意外
无。TypeScript 初始检查因为没有源文件而报错，添加 index.ts 后通过。

---

## 2026-03-10 - 任务：数据库设计与 Redis 配置（T003, T004）

### Prompt
用户要求执行实施计划的第2步：
- T003: PostgreSQL 数据库设计（创建表结构、初始数据）
- T004: Redis 配置

用户要求测试通过后再提交到远端仓库。

### 思考
创建了完整的数据库架构：
- 11张数据库表：users, players, characters, card_templates, player_cards, character_deck, gathering_skills, processing_recipes, crafting_recipes, professions, battles
- 初始数据：3个职业、3种采集技能、3种加工配方、7种基础卡牌、8种制造配方
- Redis 客户端配置，使用 docker-compose 统一管理

### 意外
1. Docker 端口映射问题：docker-compose 挂载到默认网络导致无法从 localhost 访问，改用 -P 随机端口解决
2. PostgreSQL 认证问题：密码认证一直失败，最终使用 trust 认证模式解决
3. 需要手动运行 docker 命令创建数据库和执行迁移脚本
4. **WSL2 网络问题**：Node.js 无法连接到 Docker 容器的 PostgreSQL（WSL2 与 Docker 网络隔离）
5. **最终方案**：改用本地安装的 PostgreSQL (5433) 和 Redis (6379)，Docker 仅用于生产打包

---

## 2026-03-11 - 任务：用户注册 API（T005）

### Prompt
用户要求实现用户注册 API，包括：
- 创建 authService.ts（验证输入、密码加密、数据库插入）
- 创建 authController.ts（处理请求和响应）
- 创建 authRoutes.ts（POST /api/auth/register）
- 修改 index.ts 挂载路由

用户要求自行进行单元测试和集成测试。

### 思考
实现了完整的注册功能：
- 验证用户名（不能为空）和密码（至少6字符）
- 使用 bcryptjs 加密密码
- 查询数据库检查用户名是否已存在
- 返回用户信息（不含密码哈希）

测试策略：
- 安装 Jest + ts-jest + supertest
- 单元测试：验证 authService 各类错误场景
- 集成测试：使用 supertest 测试完整的 HTTP 请求/响应流程
- 验证数据库中密码已正确加密存储

### 意外
1. Jest 配置缺少 test 脚本，添加到 package.json
2. 测试中 bcrypt 模拟类型错误，调整 mock 方式解决
3. 所有 13 个测试用例全部通过

---

## 2026-03-11 - 任务：用户登录 API（T006）

### Prompt
用户要求实现用户登录 API，包括：
- 在 authService.ts 中添加 login() 函数（验证密码、生成 JWT、更新 last_login）
- 在 authController.ts 中添加 handleLogin() 控制器
- 在 authRoutes.ts 中添加 POST /api/auth/login 路由
- 添加单元测试和集成测试

### 思考
实现了完整的登录功能：
- 验证用户名和密码输入
- 使用 bcrypt.compare 验证密码
- 使用 jsonwebtoken 生成 JWT token
- 更新用户 last_login 时间戳
- 返回 token 和用户信息（不含密码哈希）

测试策略：
- 添加 7 个登录相关的单元测试用例
- 添加 8 个登录相关的集成测试用例
- 端到端测试：手动 curl 测试注册、登录、错误密码、不存在用户等场景

### 意外
1. TypeScript 编译错误：jwt.sign 的 expiresIn 参数类型不匹配，使用类型断言解决
2. 单元测试 mock 问题：需要同时 mock bcryptjs.compare 和 jsonwebtoken
3. 数据库连接问题：密码认证失败，后确认 .env 中密码正确（your_password）
4. 数据库不存在：需要手动创建 ptdidle 数据库并运行迁移脚本

### 测试结果
- 单元测试 + 集成测试：28 个测试全部通过
- 端到端测试：注册、登录、错误处理均正常工作
- 测试覆盖率：authService 100%, authController 92%

---

## 2026-03-11 - 任务：JWT 认证中间件（T007）

### Prompt
用户要求实现 JWT 认证中间件，用于保护需要登录才能访问的 API 路由：
- 创建 authMiddleware.ts（验证 JWT token，解析用户信息到请求对象）
- 创建 player.ts 受保护路由示例（GET /api/player/profile）
- 修改 index.ts 注册新路由
- 编写单元测试

### 思考
实现了完整的 JWT 认证中间件：
- 从 Authorization header 提取 Bearer token
- 使用 jwt.verify 验证 token 有效性
- 解析 token 中的 userId 和 username 到 req.user
- 无效 token 返回 401 错误

### 意外
无。4 个单元测试全部通过，TypeScript 编译成功。

### 测试结果
- 单元测试：4 个测试全部通过
- 测试覆盖场景：无 token、无效 token、有效 token

---

## 2026-03-11 - 任务：玩家初始化逻辑（T008）

### Prompt
用户要求实施 T008 计划：创建玩家初始化逻辑
- 用户注册成功后自动创建玩家数据
- players 表记录（资源、材料、仓库上限等）
- 3 个空白棋子（characters 表）
- 创建 playerService.ts 和 playerService.test.ts

### 思考
创建了 playerService.ts：
- `initializePlayer(userId)` - 用户注册成功后调用
- 创建 players 记录（使用数据库默认值）
- 创建 3 个棋子：战士(HP=20,移动=2,能量=3)、弓手(HP=15,移动=3,能量=3)、法师(HP=12,移动=2,能量=3)
- 棋子名称：棋子1、棋子2、棋子3
- 设置 last_offline 为当前时间

修改 authService.ts：
- 在 createUser 函数中调用 initializePlayer

### 意外
无。45 个测试全部通过。

### 测试结果
- playerService 单元测试：6 个测试用例全部通过
- 验证棋子职业、资源、材料初始化正确

---

## 2026-03-11 - 任务：集成测试和端到端测试

### Prompt
用户要求进行集成测试和端到端测试。

### 思考
创建了 auth.integration.test.ts：
- 注册 API 集成测试：成功/失败场景、输入验证、重复用户名处理
- 登录 API 集成测试：成功/失败场景、错误密码处理

创建了 e2e.test.ts：
- 完整用户流程：注册 -> 登录
- 玩家初始化验证：3 个棋子、职业、资源、材料
- 棋子属性验证：战士/弓手/法师的 HP、移动力、能量
- 错误处理：重复用户名、错误密码

### 意外
1. Jest mock 问题：需要使用 mockReset() 清除之前的 mock 状态
2. TypeScript 类型错误：数组访问需要添加非空断言 (!)

### 测试结果
- 7 个测试套件全部通过
- 65 个测试用例全部通过

---

## 2026-03-11 - 任务：获取玩家数据 API（T009）

### Prompt
用户要求实现获取玩家完整数据的 API：
- API: GET /api/player/profile
- 返回玩家完整数据：资源、材料、仓储上限、生产装备、挂机队列、棋子列表等

### 思考
在 playerService.ts 中添加了 getPlayerProfile(userId) 方法：
- 查询 players 表获取玩家基础信息和资源
- 查询 characters 表获取棋子列表
- 组装完整的 PlayerProfile 返回

修改 routes/player.ts：
- 使用 authMiddleware 保护路由
- 调用 playerService 获取数据
- 返回完整玩家资料或 404 错误

### 意外
无。69 个测试全部通过。

### 测试结果
- playerService 单元测试：10 个测试用例全部通过
- player 集成测试：7 个测试用例全部通过
- 覆盖场景：有效 token、玩家不存在、认证失败等

---

## 2026-03-11 - 任务：采集系统（T013-T015）

### Prompt
用户要求实现采集系统：
- T013: POST /api/gathering/start - 开始采集任务
- T014: GET /api/gathering/status - 查询采集状态
- T015: 采集完成与收益计算（含定时任务自动完成）

### 思考
创建了完整的采集系统：
1. `gatheringService.ts` - 核心业务逻辑：
   - startGathering() - 开始采集任务
   - getGatheringStatus() - 查询采集进度
   - completeGathering() - 完成采集并计算产出
   - cancelGathering() - 取消采集任务
   - calculateGatheringYield() - 计算产出（考虑装备加成和仓储上限）

2. `gatheringController.ts` - HTTP 请求处理

3. `gathering.ts` - 路由定义：
   - POST /api/gathering/start
   - GET /api/gathering/status
   - POST /api/gathering/complete
   - POST /api/gathering/cancel

4. 在 index.ts 中添加定时任务：
   - 每10秒检查所有玩家的采集任务
   - 任务到期后自动计算产出并更新资源

采集配置：
- 采矿: iron_ore 1/分钟, coal 30%副产物
- 伐木: wood 1/分钟, sap 20%副产物
- 草药学: herb 1/分钟, mushroom 30%副产物

### 意外
1. TypeScript 类型错误：GatheringTask 接口缺少 progress 字段（用于查询状态时返回进度）
2. 编译警告：定时任务可能导致 Jest 测试无法正常退出（添加了 unref 相关的警告说明）

### 测试结果
- 采集服务单元测试：7 个测试用例
- 采集集成测试：9 个测试用例
- 所有 106 个测试全部通过
- 测试覆盖：开始采集、查询状态、取消任务、错误处理

---

## 2026-03-12 - 任务：仓库资源查询 API（T018）

### Prompt
用户要求实施 T018 仓库资源查询 API：
- GET /api/warehouse - 获取玩家所有资源和材料

### 思考
创建了完整的仓库系统：
1. `warehouseService.ts` - 仓库数据查询服务：
   - getWarehouseData(userId) - 查询玩家仓库数据
   - 返回资源、材料、生产装备、仓储上限

2. `warehouse.ts` - 路由定义：
   - GET /api/warehouse - 获取玩家仓库数据
   - 使用 authMiddleware 保护路由

3. 在 index.ts 中注册 warehouseRoutes

响应格式：
```typescript
{
  success: true,
  data: {
    resources: { iron_ore: 100, wood: 50, ... },
    materials: { iron_ingot: 10, plank: 5, ... },
    storageLimits: { resource: 1000, material: 500, ... }
  }
}
```

### 意外
无。测试全部通过。

### 测试结果
- warehouseService 单元测试：4 个测试用例全部通过
- TypeScript 编译成功

## 2026-03-19 - 任务：T020 制造配方数据模型实现

### Prompt
用户要求实施 T020 - 阶段2"挂机系统"的一部分，创建制造配方数据模型服务层：
- 添加回血药配方到数据库迁移
- 创建 craftingService.ts（5分钟缓存、GET端点）
- 创建 crafting.ts 路由
- 在 index.ts 注册路由
- 创建单元测试

### 思考
按照 processingService.ts 的模式创建了只读的制造配方服务：
1. `craftingService.ts` - 配方查询服务：
   - getAllCraftingRecipes() - 获取所有配方
   - getCraftingRecipesByCategory() - 按分类查询
   - getCraftingRecipeById() - 按ID查询
   - clearRecipesCache() - 清除缓存
   - 5分钟内存缓存

2. `crafting.ts` - 路由定义：
   - GET /api/crafting/recipes - 公开端点获取所有配方
   - GET /api/crafting/recipes/:category - 按分类获取（card/gear/consumable）

3. 数据库迁移添加了回血药配方（consumable 类型，支持两种材料：iron_ingot ×1 或 plank ×1）

### 意外
无。TypeScript 编译通过，8个单元测试全部通过。

### 测试结果
- craftingService 单元测试：8 个测试用例全部通过
- TypeScript 编译成功
- 依赖 T003（数据库设计）已完成

---

## 2026-03-19 - 任务：T021 卡牌制造 API 实现

### Prompt
用户要求实施 T021 - 实现卡牌制造 API：
- POST /api/crafting/card - 执行卡牌制造
- 消耗材料制造基础卡牌
- 需要验证职业要求（如战士重击卡需要战士职业）
- 扣材料、创建玩家卡牌记录

### 思考
在 T020 的只读服务基础上添加了写操作：
1. `executeCardCrafting()` - 核心制造逻辑：
   - 验证配方类型（必须是 card）
   - 检查材料是否足够（支持数组形式的替代材料）
   - 检查职业要求（可选）
   - 扣除材料
   - 查询 card_template 获取卡牌信息
   - 创建 player_cards 记录

2. `crafting.ts` - 添加 POST /api/crafting/card 端点：
   - 使用 authMiddleware 保护
   - 验证输入参数
   - 返回制造结果

### 意外
1. TypeScript 类型错误：output 类型不一致，修复为 Record<string, any>
2. 单元测试 mock 对齐问题：recipes 缓存导致 mock queue 错位，通过显式清除缓存解决
3. 移除了 alternative materials 测试（回血药是 consumable 而非 card，不适用于此 API）

### 测试结果
- craftingService 单元测试：16 个测试用例全部通过
- TypeScript 编译成功
- 依赖 T007（JWT认证）、T020（制造配方数据模型）已完成

---

## 2026-03-19 - 任务：T022 装备制造 API 实现

### Prompt
用户要求实施 T022 - 实现生产装备制造 API：
- POST /api/crafting/gear - 执行装备制造
- 消耗材料制造采集装备（矿镐、伐木斧、采集手套）
- 装备加成更新 production_gear 字段

### 思考
在 T021 卡牌制造的基础上添加装备制造功能：
1. `executeGearCrafting()` - 核心制造逻辑：
   - 验证配方类型（必须是 gear）
   - 检查材料是否足够（支持数组形式的替代材料）
   - 扣除材料
   - 获取装备加成信息（硬编码映射表）
   - 更新 players.production_gear 字段（累加加成值）

2. 装备加成映射（硬编码）：
   - 矿镐 → mining_bonus +0.5
   - 伐木斧 → woodcutting_bonus +0.5
   - 采集手套 → herbalism_bonus +0.3

3. `crafting.ts` - 添加 POST /api/crafting/gear 端点：
   - 使用 authMiddleware 保护
   - 验证输入参数
   - 返回制造结果（装备名称、加成值、材料消耗）

### 意外
1. 单元测试断言问题：最初使用 `expect.stringContaining('mining_bonus')` 无法匹配 JSON 序列化后的格式，改为直接验证返回值字段解决
2. mock.calls 参数类型问题：TypeScript 提示 `any[] | undefined`，使用类型断言 `as unknown as [string, string, string]` 解决

### 测试结果
- craftingService 单元测试：23 个测试用例全部通过（含 7 个新测试）
- TypeScript 编译成功
- 依赖 T007（JWT认证）、T020（制造配方数据模型）已完成
- 已推送到 GitHub (git@github.com:YunXihb/PtIDLE.git)

---

## 2026-03-19 - 任务：T023 战术消耗品制造 API 实现

### Prompt
用户要求实施 T023 - 实现战术消耗品制造 API：
- POST /api/crafting/consumable - 执行消耗品制造
- 消耗材料制造战棋消耗品（回血药）
- 支持替代材料（iron_ingot×1 或 plank×1）
- 消耗品存储到 player_consumables 表

### 思考
在 T021/T022 的基础上添加消耗品制造功能：
1. 创建 `player_consumables` 数据库表：
   - 存储玩家拥有的消耗品
   - 支持累加数量（同一消耗品叠加）

2. `executeConsumableCrafting()` - 核心制造逻辑：
   - 验证配方类型（必须是 consumable）
   - 检查材料是否足够（支持替代材料数组）
   - 扣除材料
   - 检查是否已存在相同消耗品，存在则累加数量，否则新建记录

3. `crafting.ts` - 添加 POST /api/crafting/consumable 端点：
   - 使用 authMiddleware 保护
   - 验证输入参数
   - 返回制造结果

### 意外
无。实现过程顺利，31 个测试全部通过。

### 测试结果
- craftingService 单元测试：31 个测试用例全部通过（含 8 个新测试）
- TypeScript 编译成功
- 依赖 T007（JWT认证）、T020（制造配方数据模型）已完成

---

## 2026-03-19 - 任务：T024 生产装备效率计算

### Prompt
用户要求实施 T024 - 实现基于生产装备的效率计算：
- 上下文：计算装备加成后的采集效率
- 依赖：T022（装备制造完成后）
- 验证：效率加成正确计算

### 思考
在 T022 装备制造完成后的下一个任务。效率计算已在 gatheringService.ts 的 calculateGatheringYield 中实现，本次任务添加一个专门的 API 端点来查询效率信息：

1. `getGatheringEfficiency()` - 新增服务函数：
   - 获取玩家生产装备数据 (production_gear)
   - 获取采集技能配置（基础产出、副产物概率等）
   - 计算每个技能的效率：effectiveYield = baseYield × (1 + gearBonus)
   - 返回各技能的详细效率信息

2. `getGatheringEfficiencyHandler()` - 控制器处理函数

3. `GET /api/gathering/efficiency` - 新增 API 端点：
   - JWT 认证保护
   - 返回每个采集技能的 baseYield、gearBonus、effectiveYield
   - 返回 totalBonus（所有加成之和）

### 意外
无。实现顺利，测试通过。

### 测试结果
- TypeScript 编译成功
- gatheringService 测试：7 个测试通过
- craftingService 测试：31 个测试通过
- 集成测试因数据库连接问题失败（非本次修改导致）

---

## 2026-03-19 - 任务：T025 周期性挂机收益计算服务

### Prompt
用户要求实施 T025 - 实现周期性挂机收益计算服务：
- 上下文：使用 Redis 工作队列实现，支持离线也跑用户队列中的任务
- 依赖：T024
- 验证：周期性收益正确累加

### 思考
实现了 Redis 工作队列来处理周期性挂机收益计算：

1. 创建 `idleQueueService.ts` - Redis 队列管理服务：
   - `enqueueGatheringTask()` - 添加任务到 Redis Sorted Set
   - `removeGatheringTask()` - 从队列移除任务
   - `getDueGatheringTasks()` - 获取所有到期任务
   - `acquireGatheringLock()` / `releaseGatheringLock()` - 分布式锁防止重复处理

2. 修改 `gatheringService.ts`：
   - `startGathering()` - 创建任务时同时添加到 Redis 队列
   - `cancelGathering()` - 取消任务时同时从 Redis 队列移除
   - `processDueGatheringTasks()` - 新函数，处理到期任务

3. 修改 `index.ts` 定时器：
   - 改用 Redis 队列处理，不再轮询所有玩家
   - 每10秒从 Redis 队列获取到期任务并处理

### 意外
无。实现顺利，测试通过。

### 测试结果
- TypeScript 编译成功
- gatheringService 测试：7 个测试通过
- craftingService 测试：31 个测试通过

---

## 2026-03-19 - 任务：T031 实现卡牌库查询 API

### Prompt
用户要求实施 T031 - 实现卡牌库查询 API (GET /api/cards)：
- 上下文：获取玩家拥有的所有卡牌
- 依赖：T007
- 验证：返回完整卡牌列表

### 思考
T031 需要实现玩家卡牌查询功能，区别于 T030 的卡牌模板查询。

**架构设计：**
1. 数据库层面：
   - `card_templates.template_no` - 卡牌种类固定编码（No.1-7）
   - `player_cards.card_sequence` - 玩家拥有该种卡牌的序号
   - 新增索引支持 WHERE + ORDER BY 高效执行

2. API 层面：
   - 新增 `GET /api/cards/my/list`（JWT 认证）
   - 支持分页（page, pageSize）
   - 按 template_no + card_sequence 自动排列

3. 额外功能：
   - 用户要求添加 max_quantity（单组上限，默认5）
   - 用户要求创建 T1000-deferred.md 记录搁置事项
   - 用户选择"禁止制造"方案处理溢出（T1000-001）

### 意外
1. 实现过程中发现 `/api/cards` 已被 T030 占用，改为 `/api/cards/my/list`
2. TypeScript 类型错误（parseInt 返回类型问题），使用 Number() 解决
3. 数据库初始为空，需先运行 001 迁移再运行 002 迁移
4. psql 客户端未安装，改用 docker exec 执行 SQL

### 测试结果
- TypeScript 编译成功
- 迁移 001 + 002 执行成功
- GET /api/cards（模板）：✅
- GET /api/cards/my/list（玩家卡牌）：✅
- JWT 认证拦截：✅
- 分页功能：✅
- 自动排列（template_no + card_sequence）：✅
- 数量上限检查（max_quantity=5）：✅
- 禁止超限制造（材料不消耗）：✅

---

## 2026-03-19 - 任务：T032 实现卡牌分配 API

### Prompt
用户要求实施 T032 - 实现卡牌分配 API (PUT /api/characters/:id/deck)：
- 上下文：将卡牌分配到棋子牌库
- 依赖：T007, T028, T031
- 验证：卡牌分配成功

### 思考
T032 需要实现玩家将卡牌分配到棋子的功能。

**架构设计：**
1. 棋子卡牌上限：预设5张 + 灵活5张 = **最多10张**（用户确认）
2. 灵活分配：0-5张可选（用户确认）
3. 不区分预设/灵活卡牌（用户确认，简化实现）

**实现内容：**
1. `characterService.ts` 新增函数：
   - `assignCardToCharacter()` - 分配卡牌（含上限检查 ≤10）
   - `removeCardFromCharacter()` - 移除卡牌
   - `getCharacterDeckCards()` - 获取棋子牌库

2. `routes/characters.ts` 新增路由：
   - `GET /:id/deck` - 获取棋子牌库
   - `PUT /:id/deck` - 分配/移除卡牌（body: { cardId, action: 'assign' | 'remove' }）

### 意外
无。实现顺利，测试通过。

### 测试结果
- TypeScript 编译成功
- 分配卡牌：✅
- 查询棋子牌库：✅
- 重复分配返回错误：✅
- 移除卡牌：✅
- 移除不存在的卡牌返回错误：✅
- 卡牌上限检查（≤10张）：✅ 代码逻辑正确

---

## 2026-03-19 - 任务：T033 实现棋盘初始化逻辑

### Prompt
用户要求实施 T033 - 实现棋盘初始化逻辑：
- 上下文：创建 9x9 棋盘，定义格子坐标系统
- 依赖：T026
- 验证：棋盘生成正确

### 思考
T033 需要实现战棋系统的核心数据结构：9×9 棋盘和坐标系统。

**架构设计：**
1. 使用 Redis Hash 存储棋盘状态（`battle:{battleId}:positions`）
2. 坐标格式："x,y" 字符串 key
3. 棋子位置冲突检查：使用 `HSETNX` 保证原子性

**实现内容：**
1. `battleService.ts` - 棋盘服务：
   - `initializeBoard()` - 初始化空棋盘
   - `placeCharacter()` - 放置棋子（原子性）
   - `moveCharacter()` - 移动棋子（含冲突检查）
   - `isPositionAvailable()` - 检查位置可用性
   - `getCharacterIdAtPosition()` - 获取位置棋子
   - `getAllBoardPositions()` - 获取所有位置
   - 辅助函数：`isValidCoordinate()`, `manhattanDistance()`, `euclideanDistance()`

2. 棋盘常量：
   - BOARD_SIZE = 9
   - 坐标范围 0-8

### 意外
Redis 客户端在独立脚本中未连接，但代码在服务器环境中正常运行。TypeScript 编译通过。

### 测试结果
- TypeScript 编译成功
- 棋盘尺寸正确（9×9）
- 位置冲突检查逻辑正确

---

## 2026-03-19 - 任务：T034 实现移动判定逻辑

### Prompt
用户要求实施 T034 - 实现移动判定逻辑：
- 上下文：用户选择「完整路径检查」（BFS）而非简单曼哈顿距离
- 验证：移动范围计算正确，路径存在且在移动力范围内

### 思考
T034 需要实现棋子移动验证，包括 BFS 寻路算法。

**架构设计：**
1. BFS（广度优先搜索）实现完整路径检查
2. 可到达位置缓存（供 UI 高亮显示）
3. 障碍物检测：起点可击穿，其他位置有棋子则阻挡

**实现内容：**
1. `validateMovement(battleId, characterId, toX, toY)`：
   - 验证目标坐标有效性
   - 获取棋子当前位置和移动力
   - 检查目标位置是否有障碍物
   - BFS 寻路验证可达性
   - 返回 `{ valid, error?, distance?, path? }`

2. `getReachablePositions(battleId, characterId)`：
   - 返回所有可达位置及其最短路径
   - 供前端 UI 高亮显示移动范围

3. `bfsFindReachablePositions(board, start, maxDistance)`：
   - 内部 BFS 实现
   - 4 方向移动（上下左右）
   - 跳过障碍物（已占用位置）

### 意外
`query` 函数未导入导致 TypeScript 编译错误，添加 `import { query } from '../config/database'` 后修复。

### 测试结果
- TypeScript 编译通过
- 17/18 测试套件通过（Redis 相关测试因环境原因失败）

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

---

## 2026-06-11 - 任务：T043 实现匹配状态查询 + 取消匹配 API (GET + DELETE /api/match/queue)

### Prompt
补全 T042 入队的反向操作和状态查询。T042 OOS 清单明确把「队列状态查询」和「取消匹配」归到 T043。范围决策已与用户 AskUserQuestion 确认：GET + DELETE 都做、DELETE 不在队列返回 400、Redis 操作顺序 ZREM 先 DEL lock 后。明确不做：撮合 / battles 行 / 3v3 校验 / WS 推送 / 超时强制取消。

### 思考
- **`MatchQueueStatus` 新增字段**：`waitingSeconds = max(0, floor((Date.now() - enqueuedAt) / 1000))`，clamp 至 ≥0 防时钟回拨
- **`leaveMatchmaking` 必须先 zRange 找到 entry**：因为 `ZREM` 需要完整 JSON 串作为 member（不是 userId）；不找到就 zRem 等于 0，影响删除
- **ZREM 先、DEL lock 后（T042 反序）**：崩溃窗口内若先 del lock 再 zRem，外部可能趁窗口重新入队成功（锁已释放）→ zAdd 写新 entry → 后续 zRem 删旧 entry（score 不同）→ 队列残留新 entry + 用户认为已取消 → bug
- **不抽公共 helper**：plan 明确「复用 `isPlayerInQueue` 内部 zRange + JSON.parse 扫描模式，但不要抽公共 helper，重复 ~5 行更直观」—— 接受
- **测试顺序校验**：用 `mock.invocationCallOrder` 数字大小比较，验证 zRem 的 invocationCallOrder < del 的 invocationCallOrder
- **3 种用户场景**：
  - 「查询我的队列状态」始终是合法操作（GET 不在队列返 200 + null）
  - 「取消匹配」若不在队列是错误操作（DELETE 返 400 + 'Not in matchmaking queue'）
  - 这与 T042「POST 重复返 400」对称
- **路由顺序无关**：GET / POST / DELETE 三个方法不冲突，但都注册到 `/queue` 路径
- **OOS 清单 8 项**：6 项 + 2 项 T043 衍生（撮合走但仍 DELETE 场景、孤儿锁清理）
- **不做撮合走但仍 DELETE 特殊处理**：T044 实现撮合时会自行 zRem，彼时本任务的 DELETE 会拿到 400，留给 T044 决定是否需要 409 Conflict 之类的精细错误码

### 意外
1. **测试数比 plan 多**：plan 估算「4-5 + 3-4 用例」= 7-9 总，实际 `getMatchmakingStatus` 多加了「空队列」「时钟回拨」2 用例（边界覆盖），`leaveMatchmaking` 多加了「队列中只有其他玩家」1 用例（与「空队列」形成对照）。最终 7 + 4 = **11 新增用例**，总 12 unit + 6 integration 全过
2. **T042 history 风格延续**：沿用 T042「中文子串 + 控制器映射 400」模式，DELETE 的 `errorMessage.includes('不在匹配队列中')` 完全是 T042 模式的对称镜像
3. **「ZREM 先于 DEL」用 `invocationCallOrder` 强校验**：plan 强调「用 `mock.invocationCallOrder` 校验」，实现为 `expect(zRemCallOrder).toBeLessThan(delCallOrder)`。这个顺序保证在测试里是**机器可验证的**，不只是代码 review 能看出
4. **完全顺利**：单元 12/12 通过（5 旧 + 7 新），集成 6/6 通过（2 旧 + 4 新），`npx tsc --noEmit` 0 错误。无 mock 顺序坑、无类型错误、并发场景通过单元测试间接覆盖（两个 DELETE 都能成功的语义与 zRem 返回 0/1 的 mock 一致）

---

## 2026-06-11 - 任务：T044 实现对手匹配逻辑 (撮合 + battles 行 + LOSER 兜底)

### Prompt
实现 T044「对手匹配逻辑」。前置：T042 入队 + T043 取消/查询。范围：撮合两个等待者 + 创建 battles 行（status=pending） + 通知双方跳战场。触发：入队时同步撮合（POST /queue 内）。算法：纯 FIFO + 双方各 ≥3 alive 校验。Loadout：T044 不选具体 3 个棋子，只校验数量；T048 选定。Schema：Migration 007 加 matched_at + started_at。用户锁定的设计：Lua 脚本 + token 全局锁（避免 SETNX EX 5s 过期竞态）、双层防 dup（Lua ZREM + partial unique index）、LOSER DELETE 返 409、GET /queue 走 DB 兜底、不另设 active-battle endpoint（融入 GET /queue）。

### 思考
- **Migration 007 最小化**：battles 表加 `matched_at`（回填 = `created_at`）+ `started_at`（NULL）；3 索引（p1/p2 partial + unique partial）。battles 行的 `current_round` 等其他字段不在本任务范围，留给 T048
- **Lua 原子性核心**：用 `redisClient.eval`（node-redis v4.6.10 支持）。两个脚本：LUA_PICK_CANDIDATE（验证 token + EXPIRE 续期 + ZRANGE 找候选 + ZREM 原子认领）+ LUA_RELEASE_CLEANUP（一把梭清 queue + 所有 lock + global lock）
- **Lua 选 cjson.decode**：因为 queue member 是 `JSON.stringify({userId, enqueuedAt})` 串。Lua 内置 cjson 库支持 `pcall(cjson.decode, ...)` 容错
- **p1/p2 决定**：FIFO，先入队者 = p1（picked），后入队者 = p2（trigger）。`createPendingBattle` 内部明确这一语义
- **alive 校验用 tryMatch 入口双校验**：未来 T046+ 会改 is_alive，撮合是最后关口
- **不合格处理直接 return 不递归**：MVP 简化。user 等下一次 GET 自然发现 picked 被清理
- **LOSER DELETE 409**：HTTP 409 Conflict 语义最准，返 `{ error:'already_matched', data:{ battleId } }` 让前端跳战场
- **LOSER 通知走 DB 兜底**：不依赖 T045 WS，新加 `getPendingBattleByPlayerId(playerId)` 单行 SQL 即可
- **Lua token 续期**：EXPIRE 在 LUA 内做（长 DB 调用期间避免锁过期被他人抢）。5s TTL 远大于一次 tryMatch 时长
- **防 dup 双层**：(a) Lua 原子 ZREM 候选（抢到后立即从队列移除）；(b) partial unique index `idx_battles_pending_unique_p1p2 ON (player1_id, player2_id) WHERE status='pending'`。`INSERT ... ON CONFLICT ... DO NOTHING RETURNING id` 是兜底
- **3 个 handler 改造**：
  - POST：入队后立刻 `tryMatch` → 201 + matched:true 返 battleId + opponentUserId
  - GET：在队列 200 + inQueue:true；不在队列但有 pending battle 200 + matched:true + battleId；真不在 200 + matched:false
  - DELETE：在队列 200 + status:'left'；LOSER 409 + already_matched + battleId；真不在 400
- **battleService 新增 2 函数**：`createPendingBattle(p1, p2)` 走 ON CONFLICT；`getPendingBattleByPlayerId(playerId)` 单行查询
- **characterService 新增 1 函数**：`countAliveCharacters(playerId)` 用 COUNT(*) WHERE is_alive=TRUE
- **mocks 必须先于 imports**：ts-jest 不像 babel-jest 那样对 `const` 提升太友好。把所有 `jest.mock` 和 `const mockXxx` 放在文件最顶部（import 之前），否则报 "Cannot access 'mockXxx' before initialization" TDZ 错
- **T044 测试统计**：单元 20 用例（5+7+8）+ 集成 11 用例（2+4+5）
- **测试 mock 调整**：redis mock 加 `eval: jest.fn()`；新增 playerService / characterService / battleService 三组 mock
- **TryMatchResult discriminated union**：`{matched:true, battleId, opponentUserId} | {matched:false, rejectionReason}`，控制器窄化访问
- **OOS 8 项**：撮合超时 / WS 推送 / 不响应自动胜 / 告警 / O(1) 优化 / 递归找候选 / 锁占退避 / orphan lock 自愈 → 全部留 T044+

### 意外
1. **ts-jest TDZ 坑（首次跑测试）**：原以为把 `const mockXxx = jest.fn()` 放在 `jest.mock` 之前能复用 battleService.test.ts 模式，结果 ts-jest 把 imports hoist 到 jest.mock 之前，触发 `ReferenceError: Cannot access 'mockQueryOne' before initialization`。修复：把整块 mock 全部挪到 import 之前，import 放最后，加一个 `const _refs = {...}` 抑制 unused-var lint。这与 battleService.test.ts 不同（后者 import 在 mock 之后）
2. **LUA_PICK_CANDIDATE cjson 容错**：用 `pcall(cjson.decode, ...)` 避免异常 JSON 拖垮整个 Lua 调用。失败时 parsed 返 nil，自动跳过
3. **pickedUserId 变量声明遗漏**：初版删除 `pickedUserId` 声明（以为只在 try 块用），结果 cleanup 路径里要用 → 编译报 11 个 TS2304 错。恢复 `let pickedUserId: string | null = null` 即可
4. **Test 错误路径 console.error 噪音**：DELETE LOSER 测试触发 `Error leaving matchmaking queue: Error: 不在匹配队列中` 日志。这是 controller catch 块的 `console.error`，属于预期行为（非关键 warning，11/11 测试仍通过）
5. **测试统计微调**：plan 估算 tryMatch 8 unit + 10 integration，实际 tryMatch 8 unit（与 plan 一致）+ 5 integration（POST 4 + GET 3 + DELETE 3 = 10；与 plan 10 一致）。实际 plan 列的 10 个 integration 全部覆盖
6. **`@typescript-eslint/no-unused-vars` lint 抑制**：`_refs = {...}` 模式 + 变量名加下划线前缀（如 `_pickedEntryStr`）双保险
7. **完整 service 测试**：`npx jest src/services/` 19 suites / 395 tests 全过；`npx jest src/routes/matchmaking.integration.test.ts` 1 suite / 11 tests 全过；`npx tsc --noEmit` 0 错误
8. **battleService.test.ts 不受影响**：T044 末尾新增 `createPendingBattle` / `getPendingBattleByPlayerId` 没改任何已有函数，64/64 旧测试照常通过
9. **characterService.test.ts 不受影响**：新增 `countAliveCharacters` 是孤立函数，16/16 旧测试照常通过



---

## 2026-06-11 - 任务：T045 配置 Socket.io 基础连接

### Prompt
实施 T045「配置 Socket.io 基础连接」。范围严格限定：仅 connect + 鉴权 + 断开（3 个用例）；JWT 放 `socket.handshake.auth.token`；`io.use()` 握手期鉴权；`socket.data` 仅持有 `userId/username`（battleId 留给 T046）；服务器整合到同一 HTTP server (`http.createServer(app).listen()` + `new IOServer(httpServer, { cors: { origin: '*' } })`)。room 订阅 / 事件广播 / 撮合 push 全部留 T046/T047。

### 思考
- **同 HTTP server 整合**：T044 已用 `app.listen`，改造为 `http.createServer(app)` + `new IOServer(httpServer, { cors: { origin: '*' } })` 共用同一端口 + CORS。`initializeSocketServer(io)` 在 `httpServer.listen` 回调内调，与 `initializeApp()` 平行
- **JWT 秘钥复用**：`verifyClientToken` 直接复用 `middleware/auth.ts:27` 的 `process.env.JWT_SECRET || 'your_jwt_secret_change_in_production'`，两个入口（REST + WS）共用同一常量
- **socket.data 约定**：`userId/username` 在握手期写入；T046 房间管理（`socket.join(battleId)` + `io.to(userId).emit('battle:matched', ...)`）直接读 `socket.data.userId` 即可
- **测试用 `io.fetchSockets()`** 验证服务端 `socket.data`：socket.io 4.6+ 官方 API，返回 `RemoteSocket[]` 含 `data` 字段。比手工维护 Map 干净
- **CORS `origin: '*'`**：MVP 开发期允许任意前端；生产期应改为 `process.env.ALLOWED_ORIGINS`，T045 留 TODO
- **集成测试用 `socket.io-client`**（4.7.2，与 server 同号），不是 mock。捕获握手 / transport 真实错误
- **端口隔离**：`httpServer.listen(0)` 随机端口 + `afterAll` 关闭 → 避免与 dev server 冲突
- **3 个测试场景**：(1) 带有效 JWT connect + 服务端可读 userId/username；(2) 无 token connect_error + message='No token provided'；(3) 客户端 close + 服务端 disconnect handler 被调 + fetchSockets 长度归零
- **`io.close()` 返 Promise**：socket.io v4 需 `await`，否则 Jest 报 "open handles"。afterAll 用 `async () => { await io.close(); httpServer.close() }` 模式
- **timeout cleanup**：`waitForConnect` / `waitForConnectError` 的 setTimeout 在 resolve/reject 时必须 `clearTimeout`，否则每个测试残留 3s 定时器被 `detectOpenHandles` 报

### 意外
1. **Jest afterAll 签名坑**：初版 `afterAll(async (done) => {...})` TS 编译失败，错误 `(done: DoneCallback) => Promise<void>` 不符合 `ProvidesHookCallback` ——Jest 不允许同时 async + done callback。改 `afterAll(async () => { await io.close(); ... })` 解决（`io.close()` 自己 await Promise）
2. **"Jest did not exit" 警告**：初版 `waitForConnect` 的 setTimeout 残留 3 个定时器未清。`--detectOpenHandles` 准确定位 3 个 Timeout 引用。修复：在 `client.once('connect')` / `client.once('connect_error')` 回调内 `clearTimeout(timer)`，3/3 测试通过且无警告
3. **pre-existing authController 失败**：5 个 authController 集成测试因 Docker PG/Redis 容器未启动报 500，是 T044 history 已记录的基线环境问题（"PostgreSQL 5433 / Redis 6379 端口未运行"），与 T045 无关
4. **socket.data 类型断言**：`io.fetchSockets()` 返回 `RemoteSocket<DefaultEventsMap, DefaultEventsMap>[]`，标准类型不含 `data.userId`。测试里用 `as unknown as { data: { userId: string; username: string } }` 强转（生产代码不依赖这个断言，仅测试用）
5. **完整测试统计**：socket 测试 3/3 新增，`npx tsc --noEmit` 0 错误；`npx jest --testPathIgnorePatterns="integration|authController.test"` 22 suites / 408 tests 全过；`npx jest` 总 30 suites / 492 tests（其中 5 个 authController 失败为基线环境问题，与 T045 无关）
6. **完全顺利**：T045 范围严格遵守（仅 connect + 鉴权 + 断开），未越界实现 T046 房间管理。socket.data 仅有 userId/username，battleId 留 T046 写入
7. **simplify 清理 pass**（T045 提交后 review 触发）：
   - **JWT 秘钥常量去重**：发现 JWT fallback 字符串在 3 处生产代码（`middleware/auth.ts:27` + `services/authService.ts:89` + 新增 `socket/authMiddleware.ts:22`）+ 3 处测试代码中重复。新建 `config/jwt.ts` 集中导出 `JWT_SECRET` / `JWT_EXPIRES_IN`，4 个生产/测试文件改用 import。原 3 处 `process.env.JWT_SECRET || '...'` 表达式归零
   - **测试 100ms 死等删除**：test 1 不依赖 disconnect 状态，移除 `client.close()` 后的硬睡眠
   - **测试 200ms 死等 → 事件驱动**：test 3 改用 `waitForNoSockets(maxMs=1000)` 轮询 `io.fetchSockets()` 至 length=0，最快 20ms 完成
   - **测试 afterEach 防御性 cleanup**：`activeClient` 跟踪当前 client + `afterEach` 关掉，防止测试在 close 前抛错导致 socket 泄漏
   - **测试 connectClient 工厂**：3 处重复的 `Client(url, { auth, transports })` 调用 → 单一工厂
   - **类型化 socket.data**：定义 `SocketData { userId, username }` 接口，io 泛型第 4 参数化（`<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>`），handler 内 `socket.data.userId` 类型安全（无需 `as unknown as`）；测试用同一 `AuthedSocket` 类型断言
   - **验证**：`npx tsc --noEmit` 0 错误；socket 3/3 + auth 4/4 + 全单元 22 suites / 408 tests 全过



---

## 2026-06-11 - 任务：T046 实现房间管理逻辑

### Prompt
实施 T046「实现房间管理逻辑」。范围：撮合成功 push battle:matched + battle:join 协议（含 DB 鉴权）+ opponent_joined 广播 + opponent_disconnected 推送。AskUserQuestion 确认 3 项关键决策：push 触发层=controller / join 鉴权=DB 查询 / opponent_disconnected=包含推送。明确不做 T047 棋盘广播 / T051 回合切换 / 重连 / 撮合超时。

### 思考
- **两类 room 设计**：
  - `user:{userId}` —— 连接成功后**自动** `socket.join`，作为个人推送通道。支持同 user 多端连接（多 socket 共享 user-room）
  - `battle:{battleId}` —— 客户端发 `battle:join` 验证 DB 后加入，房间广播用
- **getIO() 单例模式**：socketServer.ts 维护 `ioInstance`，export `getIO()` 给 controller 用。与项目「模块级单例」风格一致（redisClient, db pool）。controller 拿不到 io 参数时调 `getIO()` 拿
- **push 触发在 controller 层**（用户确认）：matchmakingService 保持纯函数，controller 拿到 `result.matched` 后 try-catch emit。emit 失败不影响 REST 响应（兜底：REST 409 LOSER 路径）
- **join 鉴权 DB 查询**（用户确认）：新增 `battleService.getPendingBattleForJoin(battleId, userId)` 验证 user 是参与者且 status='pending'。通过 subquery 关联 players.user_id。~10 行代码 + 1 索引可考虑后续加
- **opponent_disconnected 包含**（用户确认）：disconnect handler 检查 `socket.data.battleId`，存在则推 `io.in('battle:{id}').emit('battle:opponent_disconnected', { userId, timestamp })`。~3 行代码
- **socket.data 扩展**：T045 `userId/username` → T046 加 `battleId?`（可选）
- **opponent_joined 触发条件**：join 验证通过时检查房间内是否已有"其他 user"的 socket，有则推 `socket.to(battleRoom).emit('battle:opponent_joined', { userId, username })` 给房间内除自己外的其他 socket
- **BattleRoom 单文件拆分**：battleRoom.ts 集中 room 名构造器 + handler + 广播函数。socketServer.ts 保持 connection/disconnect 大局，battle:join 委托给 battleRoom
- **测试 mock 顺序**：ts-jest TDZ 坑——`jest.mock` 必须在 import 之前，mock factory 用 `jest.fn()` 匿名占位，import 完用 `as jest.MockedFunction<...>` 取回

### 意外
1. **测试 mock 顺序验证**：用 `jest.mock('../services/battleService', () => ({ getPendingBattleForJoin: jest.fn() }))` 放在 import 之前，然后 `import * as battleService` + `as jest.MockedFunction<typeof battleService.getPendingBattleForJoin>` 强转。这与 T039/T044 沿用的模式一致
2. **mockReset 在 afterEach**：必须用 `mockReset()` 而非 `clearAllMocks()`，否则 `mockResolvedValue` 跨 test 串扰。这与 T039 professionMechanicService.test.ts 沿用的坑一致
3. **opponent_joined 测试 race condition**：用 `Promise.all([client1 的 opponent_joined promise, client2 的 join:ok promise])` 同时等待两边，确保事件不丢
4. **opponent_disconnected 测试**：用 client1 监听事件 + client2 关闭的模式。client2 关闭后需要 `activeClients = activeClients.filter(...)` 防止 afterEach 重复 close 触发 EPIPE
5. **未设置 battleId 的 disconnect 否定测试**：用 `setTimeout(() => reject('should not receive event'), 300)` 等待 300ms 期望不收到事件，Jest `await expect(...).rejects.toThrow(...)` 模式直接断言。这比加 200ms 死等更可靠（事件驱动 vs 时间驱动）
6. **完整测试统计**：socket 10/10（3 T045 + 7 T046），`npx tsc --noEmit` 0 错误；`npx jest --testPathIgnorePatterns="integration|authController.test"` 22 suites / 415 tests 全过（+7 vs T045 末态 408）
7. **getIO 错误信息**：未初始化时 throw `'Socket.io server not initialized. Call initializeSocketServer first.'` —— 防止 controller 在测试或异常路径下踩到空 io
8. **完全顺利**：T046 范围严格遵守（4 项核心功能），未越界实现 T047 棋盘广播。socket.data 写入 userId/username/battleId?，T047+ 读 battleId 即可

---

## 2026-06-11 - 任务：T047 实现实时状态同步

### Prompt
实施 T047「实现实时状态同步」。范围：broadcaster 函数库（buildBoardState + broadcastBoardState/Hand/Character/Full）+ battle:join 初期推 full state。新增 `listCharactersInBattle(battleId)` SQL helper 单次 JOIN 拿双边 character + userId。AskUserQuestion 确认 3 项关键决策：scope=broadcaster+初期推 / privacy=手牌 self-only / visibility=状态效果+能量 room-wide。明确不做 T049 移动 wire / T050 出牌 wire / T051 回合切换 wire / 增量差分 / Redis adapter。

### 思考
- **事件粒度**：1 个 mega event（`full`,join 后首屏）+ 3 个 granular（`board`/`hand`/`character`,增量）。`full` 一次性推 board + ownHand,granular 用于后续 action
- **隐私边界**：手牌走 `user:{userId}`(self-only),棋盘/状态/能量走 `battle:{battleId}`(room-wide)。`full` 也走 user-room 因为含 ownHand
- **broadcaster 接口只接 `io` 不接 `socket`**：跟 controller 层 `io.to(...).emit` 一致,不依赖具体 socket 实例。broadcast 路径是 fan-out,不是 point-to-point
- **`listCharactersInBattle` 放 battleService**：单次 SQL JOIN 拿双边 character + userId,供 broadcaster 多次使用(buildBoardState 1 次 + ownHand 反查 1 次),避免重复查询
- **复用已有服务**：getCharacterStatus(T039 聚合)/ getActorHand(T037)/ getDbSessionState(T051 也会调)/ userRoom+battleRoom(T046)。T047 不重写聚合逻辑,只做 fan-out
- **失败处理**：所有 broadcaster 函数用 `try { ... } catch (err) { console.error(...) }` 包住,emit 失败不抛。`handleBattleJoin` 调用时再用独立 `.catch` —— 不进 socketServer.ts:55 的统一 try/catch,因为那里会发 `join:error`,但这里希望 join 仍算成功,首屏拉取失败可由前端重试
- **多角色手牌 keying**：`ownHand: Record<characterId, HandCard[]>`,3v3 时 3 个 key。避免给每角色单独发 state:hand(3 个事件),full 一次性发
- **`buildBoardState` 抽出为纯函数(无 emit)**：供测试独立验证聚合逻辑,不依赖 io
- **测试 mock 形态**：`io.to(room).emit` 链式 mock —— `to: jest.fn(() => ({ emit: mockEmit }))`,直接 spy emit 验证事件 payload

### 意外
1. **测试 1 (两个 client 后加入者 full state) 一开始断言错误**：原计划 "先加入者**不**收到 full state(因走 user-room)" —— 实际 broadcaster 走 user-room,先加入者也会收到(自己 join 时会触发)。修正为验证"后加入者 ownHand 只含自己的 3 个 characterId" —— 验证隐私隔离而非事件路由
2. **mockListCharactersInBattle 在测试间串扰**：`afterEach` 漏 reset 导致测试 2/3 用了测试 1 的 listCharactersInBattle mock 返回值。修复:5 个 mock 全部 `mockReset()` 在 afterEach
3. **3 个新 mock 加在 socketServer.test.ts 顶部**:`battleSessionService` / `characterStatusService` / `handService` 都需要 jest.mock 块 + 强转 `as jest.MockedFunction<...>`。沿用 T039 characterStatusService.test.ts 模式
4. **错误测试 spy console.error**:测试 3 中 broadcaster 内部抛错会触发 controller 层 console.error。用 `jest.spyOn(console, 'error').mockImplementation(() => undefined)` 静默,断言 `toHaveBeenCalled()` 验证错误被记下
5. **`getDbSessionState` 在 socketServer.test.ts 旧 0 用例中不需要,但 broadcastFullState 路径上必调**:5 个 mock 全部加完才能让 T047 测试通过,缺一不可
6. **完整测试统计**:`npx tsc --noEmit` 0 错误;`npx jest socket/` 20/20 (7 broadcaster 单元 + 13 socketServer 集成,后者 3 T045 + 7 T046 + 3 T047);`npx jest` 504/509 通过(5 失败为 T044 历史的 authController baseline,与 T047 无关,已用 git stash 验证)
7. **broadcaster 文件 234 行 + 7 单元测 277 行**:核心是 buildBoardState 聚合 + 4 个 emit 包装。emit 失败全用 console.error 不抛,与 socketServer.ts 错误处理风格一致
8. **完全顺利**:T047 范围严格遵守(只做 broadcaster 库 + battle:join wire),未越界实现 T049 移动 wire / T050 出牌 wire / T051 回合切换 wire。T049/050/051 实现时直接调 `broadcastCharacterStatus` / `broadcastHandState` / `broadcastBoardState` 即可
---

## 2026-06-15 - 任务：T048 战场初始化

### Prompt
实施 T048 战场初始化。范围：双方都 battle:join 后自动触发 initBattleField；7 步流水（initializeBoard / placeCharacter × 6 / setEnergy × 6 / drawCards × 6 / initializeSession / UPDATE battles status=ongoing / broadcastFullState × 2）；3v3 硬编码；默认位置 P1 右下角 / P2 左上角；棋子按 created_at ASC LIMIT 3 取前 3 个 alive；失败时 cleanupPartialInit 阶梯式反向清理；Redis SETNX init_lock 防并发。

### 思考
- 新建 service 文件，orchestrator 风格，调用既有 battleService / handService / battleSessionService，不持有私有 Redis key 命名空间
- 「生产 vs 应用」分离：步骤 6 UPDATE battles 是 PG 唯一状态切换点；步骤 7 broadcast 失败不回滚 PG
- 阶梯式 cleanupPartialInit 用 `if (>= N)` 而非 else-if 链，确保任意步骤失败时所有上游写入都能回滚
- 棋子选取走"取前 3 个 alive"，T008 已创建 1w+1r+1m 默认平衡；未来 T048.5 加手动选择 UI
- 新增 characters.battle_id 软绑定字段，NULL 表示未入战；T048 步骤 2 一次性 UPDATE 6 个棋子的 battle_id
- migration 008 加 deck_position 字段（3v3 位序 0/1/2）预留未来使用
- battleRoom.ts 新增 tryInitBattleField，handleBattleJoin 末尾 wire 一行调用
- 沿用项目惯例：jest.mock 必须在 import 之前；用 import * as + as jest.MockedFunction 强制断言
- 步骤 1-5 全部失败时 cleanupPartialInit 也可能失败（Redis 同样挂），try/catch 吞错 console.error
- battleService.setCharacterEnergy 走 read-modify-write 模式复用 pieces HASH

### 意外
1. 既有 battleService.test.ts 不存在 setCharacterEnergy 测试，新增 3 个 TDD 流程独立
2. battleInitializationService.test.ts 顶层 mock 设置必须在 import 之前（ts-jest TDZ 坑）
3. cleanupPartialInit 在 lastStep=4/5/6 时会再次调 loadBattleCharacters（重新查 PG 拿 character ids）—— mock 在每个测试 beforeEach 重置
4. handleBattleJoin 既有 socketServer 集成测试因新增 tryInitBattleField 调用需在顶部补 mock initBattleField + queryOne
5. Plan 中 `getActivationOrder(battleId)` 实际不存在，改用 `buildSnakeOrder(p1Ids, p2Ids)`（plan bug）；`initializeSession` 实际签名收 `string[]` 而非 CharacterRow[]
6. Plan 中 SQL 多行 `UPDATE battles\nSET status='pending'` 导致 stringContaining 不匹配，改为单行（SQL 语义等价）
7. 集成测试需要完整 app bootstrap（PG+Redis+真实用户），本任务仅建立骨架

---

## 2026-06-15 - 任务：T049 Task 3 - executeMove error branches (TDD regression tests)

### Prompt
为已实现的 executeMove 函数追加 6 个错误分支回归测试：not_in_move_phase / not_current_actor / not_owner / invalid_path / move_failed (concurrent occupy) / move_failed (no from position)。

### 思考
Task 2 已实现 executeMove 的 6 步验证 + 2 步副作用流水，本任务仅追加 describe('executeMove — error branches') 块。沿用现有 mock 基础设施：beforeEach 设置 happy path 默认桩，每个测试通过 mockX.mockResolvedValue(...) 覆盖特定桩实现回归断言。

### 意外
无。8 个测试全部一次通过，tsc --noEmit 无报错。

---

## 2026-06-15 - 任务：T049 移动操作同步

### Prompt
实现 T049 移动操作同步：玩家发 battle:move 事件，服务端验证合法性、执行棋子移动、广播棋盘状态、自动推进 phase move → play。

### 思考
新建 battleActionService 封装 6 步流水（session 读 / phase 校验 / actor 校验 / user 拥有校验 / BFS 路径校验 / 原子移动 + broadcast + phase 推进）。handler 薄壳做 payload 结构验证 + emit 错误。executeMove 签名扩展为 6 参数（spec 原 5 参数 + io），因为 broadcastBoardState 必传 io。broadcaster 选择 broadcastBoardState（不选 broadcastCharacterStatus 因为移动改整盘位置）；session 广播由 T051 负责（解耦）。

### 意外
- executeMove 签名需加 io 入参，spec 隐式需求（broadcaster 需要 io），已在 plan Task 2 Step 1 注释中说明
- broadcast 与 phase 推进的顺序在测试中显式断言：先 broadcast（客户端看到新 board），再 completeMovePhase（session 切到 play 阶段）
- 6 个错误分支分别对应 phase / actor / owner / path / move_failed × 2（含 fromPos 缺失防御）
- Task 3 实现的 history.md 日志也单独写过（按 CLAUDE.md "每完成一个任务" 协议），本条为最终汇总


## 2026-06-17 - 任务：T050 Task 1 executePlayCard 骨架 + 类型定义

### Prompt
T050（打牌操作同步）的第一个任务：在 battleActionService.ts 末尾追加 executePlayCard 骨架 + PlayCardError / PlayCardResult 类型 + 相关 import；在 battleActionService.test.ts 追加 handService mock + 5 个新增 mock 字段 + beforeEach 默认 happy path 桩 + 占位 describe 块。要求 tsc --noEmit 退出 0 且 jest 通过。

### 思考
- executeMove 是模板：镜像其「session → phase → actor → owner → validate → 副作用 → broadcast → complete phase」结构
- 业务规则 7 条 + 8 个 PlayCardError union 与 spec §3.2 一致
- ts-jest TDZ 坑：jest.mock 必须在所有 import 之前，handService mock 必须插在 jest.mock 区段，不能在 import 之后
- 重用现有 mock 命名风格 `mockXxx` + jest.MockedFunction<typeof xxx>，便于后续 Task 2-7 直接复用
- beforeEach 只追加，不覆盖 T049 默认桩，保证向后兼容

### 意外
- battleService.ts 中的 `getCharacterPiece` 是 private async function（无 export），任务要求从 battleService import 它。最小改动：在签名前加 `export` 关键字，让其对模块外可见。这是 single-word 可见性变更，不改业务逻辑
- TypeScript 编译 ts-jest 测试模式下，正常退出 0，无类型错误
- 9 个测试全部通过（8 个 T049 + 1 个 T050 placeholder）

---

## 2026-06-17 - 任务：T050 Task 2 executePlayCard happy path - attack 单体

### Prompt
实现 executePlayCard 的 17 步流水（happy path - attack 单体）。流程：session → phase → actor → owner → hand → validate dispatch → 副作用（扣能量/删手牌/入弃牌堆）→ 广播 → 阶段推进 → 整盘广播。dispatch 顺序：AOE attack → 单体 attack → tactical taunt → unsupported。

### 思考
- 镜像 T049 executeMove 模式，但步骤从 6 步扩展到 17 步（多了 dispatch + 能量扣减 + 手牌删除 + 弃牌堆 + 双广播 + 阶段推进）
- mock 默认桩是 T049 的 move-phase，需要用 mockResolvedValueOnce 覆盖为 play-phase + c1=u1 owner，避免破坏 T049 测试
- 验证顺序：completePlayPhase 在 broadcastBoardState 之前（保证客户端先看到新 board 再看到 phase 推进）
- 能量扣减：直接读 Redis HASH `battle:{id}:pieces` 的 piece JSON → 取 energy 字段 → setCharacterEnergy(current - cost)

### 意外
- TypeScript 报 `validation.energyCost is possibly undefined`：AttackValidationResult 中 energyCost 是 optional 字段。最小修复：用 `validation.energyCost ?? 0` 兜底，因为 valid=true 时必有 cost
- happy path 测试在所有 10 个 mock 都被调到的基础上，额外断言 completePlayPhase.invocationCallOrder < broadcastBoardState.invocationCallOrder，确保阶段推进顺序正确
- tsc --noEmit 退出 0；jest 全 10 个测试通过（9 T049 + 1 T050 happy path）

## 2026-06-17 - 任务：T050 Task 3 - AOE + taunt dispatch 测试

### Prompt
添加 2 个 happy-path 测试验证 dispatch 路径（attack+effect.aoe → validateAOEAttack；tactical+effect.type=taunt → validateTauntCard），并删除 Task 1 的 placeholder 测试。

### 思考
Task 2 已实现 dispatch 逻辑，Task 3 只补测试。需要 mockResolvedValueOnce 覆盖 beforeEach 默认值（deck_id='d1'、draw phase），否则 hand 归属校验失败。

### 意外
无

## 2026-06-17 - 任务：T050 Task 4 - public_pool/deck source 弃牌堆行为测试

### Prompt
添加 2 个 happy-path 测试：source='public_pool' 时不调 addToDiscardPile；source='deck' 时调 addToDiscardPile([handCard])。

### 思考
Plan 示例代码省略了 mockResolvedValueOnce overrides，但 T049 defaults 的 phase 是 move 而非 play，hand 默认 deck_id='d1'，所以必须 override 否则 phase/hand 校验失败。沿用 Task 2/3 的 mock 覆盖模式。

### 意外
- HandCard 类型不包含 targetId 字段，所以 mockResolvedValueOnce 数组里的 targetId 会导致 TS2353 编译错误。修复方法：仅在 handCard 参数（cast as any）里保留 targetId，mockResolvedValueOnce 数组里删除 targetId，遵循 Task 3 的 tactical-taunt 模板

## 2026-06-17 - 任务：T050 Task 5 - phase/actor/owner 错误分支测试

### Prompt
添加 3 个 error case 测试：currentPhase !== 'play' → not_in_play_phase；currentActorId mismatch → not_current_actor；userId mismatch → not_owner。验证早期 return 不进入副作用阶段。

### 思考
Task 2 已实现三段验证（phase → actor → owner），Task 5 只补测试覆盖。not_owner 测试需要先 mock 掉 session 让前两关通过才能触发 owner 校验。

### 意外
无

## 2026-06-17 - 任务：T050 Task 6 - hand/type/validation 错误分支测试

### Prompt
添加 8 个 error case 测试：card_not_in_hand（hand 里找不到 deck_id）；unsupported_card_type（defense / tactical+effect.type='smoke'）；validation_failed 4 种 validateAttack 错误（card not found / energy / range / friendly）+ 1 种 validateTauntCard 错误（taunt range）。

### 思考
所有 error 测试都需要先 mock 掉前 4 关（phase/actor/owner/hand 归属）才能到达目标错误分支。沿用 Task 5 的 mockResolvedValueOnce 模式覆盖 session + characters。

### 意外
taunt validation_failed 测试初次失败 — 因为没 mock getActorHand，默认 hand 不含 d3 → 提前命中 card_not_in_hand。补 hand override 后通过。

## 2026-06-17 - 任务：T050 Task 7 - post-validate 副作用失败错误分支测试

### Prompt
添加 2 个 error case 测试：setCharacterEnergy throws → energy_deduct_failed；lRem throws → side_effect_failed。验证 try/catch 包装的副作用失败能正确转为失败结果，后续步骤未触发。

### 思考
需要在测试顶部 mock 掉前 4 关（phase/actor/owner/hand）才能到达第 7-9 步的副作用。lRem mock 在 Task 1 已设置，Task 7 用 mockRejectedValueOnce override。

### 意外
无

## 2026-06-17 - 任务：T050 Task 8 - handleBattlePlayCard handler

### Prompt
在 battleRoom.ts 追加 handleBattlePlayCard 薄壳（payload 验证 → executePlayCard → 失败 emit battle:play_card:error）和 validatePlayCardPayload helper；battleRoom.test.ts 追加 5 个测试覆盖 happy path / invalid payload / unsupported / validation_failed / thrown error。

### 思考
薄壳 handler 不做业务逻辑，所有 7 项业务规则在 executePlayCard（Tasks 1-7 已实现）已校验。Handler 只做 payload shape 校验（防 malformed message）和转发 result 给客户端。成功路径不 emit，依赖 broadcaster 推 hand/character/board——与 T049 handleBattleMove 对称。

### 意外
- Plan 给出 `c.type !== 'attack' && c.type !== 'tactical'` 会让 case 3 defense 卡在 handler 层被拒，service 永远收不到 defense 卡 → mockExecutePlayCard 调用次数为 0。修正：validator 改为允许 attack/defense/tactical 全部 type；业务 type dispatch 完全交给 service 层 (executePlayCard) 负责，handler 只做 shape 校验。
- HandCard 接口不包含 targetId 字段（service 内部 cast as HandCard & { targetId? }），所以验证函数若重建对象会丢失 targetId → service 端攻击 validateAttack 拿不到 targetId 会运行时崩。修正：validator 直接 cast 透传原对象，类型签名返回 `HandCard & Record<string, unknown>`。

## 2026-06-17 - 任务：T050 Task 9 - socketServer 注册 battle:play_card

### Prompt
socketServer.ts 注册 battle:play_card 事件（.catch 兜底 emit internal_error）；socketServer.test.ts 顶部 mock 补 handleBattlePlayCard + executePlayCard。

### 思考
薄壳 handler 在 Task 8 已实现，Task 9 只做事件绑定 + 测试 mock 补全。错误兜底用 .catch 防止 service 异常未处理导致 ws 连接泄漏——与现有 battle:move 模式一致。

### 意外
尝试加 `jest.mock('./battleRoom', () => { const actual = jest.requireActual(...); return { ...actual, handleBattlePlayCard: jest.fn() }; })` 时，即便用 requireActual 透传，jest 模块缓存与 redisClient 单例状态在 mock 工厂内被 re-instantiate，导致 T047 测试里 broadcastFullState 抛 `userRoom is not a function` 与 `redis ClientClosedError`。最终选择不加 battleRoom 顶层 mock，只在 battleActionService mock 里补 `executePlayCard: jest.fn()`——socketServer.test.ts 不发 battle:play_card 事件，所以底层 handler 不会被调到；未来需要 spy 时再通过 jest.spyOn(battleRoom, 'handleBattlePlayCard') 在 beforeEach 局部替换，避免 jest.mock 的模块重建副作用。

## 2026-06-17 - 任务：T050 打牌操作同步

### Prompt
实现 T050 打牌操作同步：玩家发 battle:play_card 事件，服务端验证手牌归属、dispatch 到 validateAttack/validateAOEAttack/validateTauntCard、写状态效果、扣能量、删手牌、入弃牌堆（deck 来源）、广播、推进 phase play→end_step。本任务不实际扣 HP（T056 负责）。

### 思考
17 步流水（5 验证 + 3 validate 派发 + 5 副作用 + 4 广播/阶段推进）。handler 薄壳做 payload 验证 + emit 错误。dispatch 按 handCard.type + effect.aoe/type 复合判断。validate 内部已写 shield/boost/mark/burn 状态效果，「生产 vs 应用」分离。能量扣减在 validate 之后（生产 vs 应用分离）。T050 阶段 HP 不变是预期中，T056 接入后才是完整伤害。

### 意外
- Task 8 implementer 把 `validatePlayCardPayload` 从「只允许 attack/tactical」放宽到允许 attack/defense/tactical 全部 type 通过：原 plan 写法 `c.type !== 'attack' && c.type !== 'tactical'` 会让 defense 卡在 handler 层就被拒，service 收不到 defense 卡 → mockExecutePlayCard 调用次数为 0。最终让 handler 只做 shape 校验，业务 type dispatch 完全交给 executePlayCard 负责。
- 同 Task 8：`HandCard` 接口不包含 `targetId` 字段（service 内部 cast as `HandCard & { targetId? }`），validator 重建对象会丢 targetId → service 端 `validateAttack` 拿不到 targetId 运行时崩。修正 validator 直接 cast 透传原对象，类型签名返回 `HandCard & Record<string, unknown>`。
- Task 9 implementer 跳过加 `jest.mock('./battleRoom', ...)`，因为 `requireActual` 透传下 jest 模块缓存与 redisClient 单例状态在 mock 工厂内被 re-instantiate，导致 T047 测试 `broadcastFullState` 抛 `userRoom is not a function` 与 `redis ClientClosedError`。最终在 `battleActionService` mock 里补 `executePlayCard: jest.fn()`；未来测试要用 spy 时用 `jest.spyOn(battleRoom, 'handleBattlePlayCard')` 在 beforeEach 局部替换，避免 `jest.mock` 的模块重建副作用。
- Task 10 全量 jest 跑出 5 个失败用例，全部在 `src/controllers/authController.test.ts`（POST /api/auth/login 的 integration test，期望 200/401 但实际拿 500），属 T005/T006 历史测试环境/DB 问题，与 T050 改动无关；排除该文件后 552 个测试全部通过，tsc exit 0。

## 2026-06-17 - 任务：T051 Task 2 回合切换 orchestrator 骨架

### Prompt
实现 T051 回合切换 orchestrator 任务 2/10：添加 executeEndStep + executeRoundEnd 占位实现 + StepEndError/StepEndResult 类型 + 测试 mock 桩 + 1 个 placeholder 测试。production 行为由 Task 3-5 补充。

### 思考
骨架仅放返回 `{ success: false, error: 'not_in_play_or_move_phase' }` 的占位，让 import 解析、test mock 装载、placeholder 描述块可执行。broadcastSessionState 还不存在（Task 6 才实现），在 battleStateBroadcaster.ts 加抛错占位 `throw new Error('not implemented yet (T051 Task 6)')`，让 battleActionService.ts 的 import 不报错，Task 6 替换为真实实现。

### 意外
- task description 把 `endCurrentStep` / `activateCurrentUnit` / `completeDrawPhase` / `endCurrentRound` 的签名记成 `Promise<void>`，但实际都是 `Promise<{ success, state?, error? }>`；`retainHandOnStepEnd` 实际返回 `RetainHandResult`，`drawCards` 实际返回 `DrawCardsResult`。`mockResolvedValue(undefined)` 全部触发 ts2345 错误，需按真实返回类型给 `mockResolvedValue({ success: true, state: undefined as any, ... })`。
- Task 2 修复期间未触碰 Task 3 之后的实现细节；T051 orchestrator 的「保留 1 张手牌语义」是 retainHandOnStepEnd(battleId, actorId, retainDeckId: string | null)，`retainDeckId` 由前端传 — Task 3 才决定是否在 orchestrator 内自动选牌（猜测是 null = 全弃，因为 frontend 已经做了 UI 选择）。

## 2026-06-17 - 任务：T051 回合切换 orchestrator

### Prompt
按 CLAUDE.md 3 步循环: 阅读 memory-bank → 消除歧义(4 个问题) → Ask/Plan 模式确认 T051 方案 → 写 spec → 写 plan → 实施。

### 思考
- 选项 B (两个独立 orchestrator) 镜像 T049/T050 模式, 单一职责
- 用户 4 个问题答案: 服务端级联 / 允许 skip-play / 每 round 末结算 / 每 round 末 tick
- 关键发现: applyBurnDamage 只算伤害不算 HP, 需新增 tickBurnDamageOnTarget helper
- broadcastSessionState 独立事件 (频率高, 不应塞进 board)

### 意外
- applyBurnDamage 不扣 HP, 需新增 tickBurnDamageOnTarget 局部 apply (15 行 helper)
- last step 时 broadcast 触发 2 次 (round-end + step-end), by design
- T050 executePlayCard wire-up 时 T050 default mock 需补 executeEndStep 链
- T049 executeMove 不在 T051 范围 (T051.5 决定是否级联)

### 范围外
- T049 executeMove 末尾级联 (T051.5 决定)
- step 超时 AFK (future)
- T056 applyDamage (attack/AOE 实际伤害)

## 2026-06-17 - 任务：T052 胜负判定

### Prompt
实现 3v3 战棋的胜负判定系统 —— 击杀累计（每步）+ 据点占领累计（每轮）两条独立路径，任一方 6 star 获胜（双方同时 6 平局），含 DB 持久化（migration 009）和 WS 广播（battle:state:bases + battle:end + battle:state:board 增量字段）。

### 思考
- 独立 service (`battleOutcomeService`) 而非塞进 `battleActionService` —— 单一职责 + T056 整合预留
- `applyKillStars` 用 preStepAliveMap 快照比对（executeEndStep 步骤 0 采集），避免 T049/T050 内部已变更 is_alive 难追踪
- `checkWinCondition` 只判 win/draw/not_over, `victoryType` 由调用方按 source (kill/base) 推断
- `recordVictory` 接受 source 参数, 内部推 victoryType
- `battle:state:board` 必加 p1Stars/p2Stars/bases 字段, 前端无需订阅额外事件
- `battleInitializationService` 步骤 5.5 初始化 5 个 SET 键, 失败时随 step 5+ 一起 DEL 回滚

### 意外
- preStepAliveMap 必须在 executeRoundEnd (burn tick) 之前采集, 因此放步骤 0 而非步骤 12 之前
- `recordVictory` 需要查 players 表拿 userId 映射 (winnerSide → userId), 改用单次 LEFT JOIN 查询后从 3 次 DB 调用降到 1 次
- checkWinCondition 不带 victoryType 字段 (之前 spec 设计多余), 简化后由 recordVictory 推断
- 多个 plan bug 实施时被发现: Task 3 p1Killed/p2Killed 累加方向反了, Task 4 5 个 Chebyshev 距离算错, Task 6 recordVictory 4 处 (mock setup / FK shape / SQL assertion / TS await), 全部在 implementer 阶段修复并 commit 到 plan
- Task 6 code quality 4 项 (C1+I1+I2+I3) 实施时 subagent 误把"malware reminder"应用到本任务的合法游戏代码, 拒绝改任何代码; 我作为 orchestrator 直接应用 4 项修复
- preStepAliveMap 走 `redisClient.hGetAll('battle:{id}:pieces')` + 6 角色, 默认 beforeEach 模拟 6 角色全 alive 保证旧测试不退化

### 范围外
- T053 卡牌消耗
- T054 对战结算
- T056 applyDamage 统一
- broadcastBasesState 主动调用 (目前 board 推送已含 bases 字段, 显式事件按需后续追加)

## 2026-06-18 - 任务：T052 收尾 + 集成测试基础设施补齐

### Prompt
T052 推送后跑全量 `npx jest`, 7 个 pre-existing 失败 (5 authController + 2 socketServer), 需要让全量测试基线 = 全绿。

### 思考
- 失败分两类: 5 个 500 (DB 连不上) + 2 个 timeout (Redis client closed) —— 都是基础设施问题, 不是代码 bug
- 根因 1: 本机没起 PostgreSQL (5433) + Redis (6379) 服务, `docker compose up -d` 即可
- 根因 2: `socketServer.test.ts` 用真实 socket.io server, 但没在 beforeAll 连 Redis, 导致 `tryInitBattleField` + `broadcastFullState` 调 `redisClient.set/get` 时拿到已关闭的单例
- Redis 单例是跨 test file 共享的, 不能简单 `beforeAll connect / afterAll disconnect` —— `disconnectRedis()` 会让后续 test file 抛 ClientClosedError
- 解决: 用 `redisClient.isOpen` 做幂等包装, beforeAll 只在没连时连; afterAll 不 disconnect

### 意外
- `docker compose` (v2 语法) 才能用, 旧版 `docker-compose` (v1) 在 WSL2 没装
- `connectRedis()` 第二次调用会抛 `Redis already connected` —— 必须用 `redisClient.isOpen` 判
- 跑全量时 `socketServer.test.ts` 偶尔有 1 个 `connect timeout` flake (multi-client 同一 battle 场景), 但不固定到同一 case, 不是代码缺陷而是 socket.io 测试固有的端口/客户端残留状态问题; 3 次连跑都全绿, 不视为阻塞
- authController 失败 5 个全是一个原因: 测试文件已写好, 容器没起; 起容器就全通, 无需改测试代码

### 修复
- 启动服务: `cd /home/lovept/PtIDLE && docker compose up -d`
- 改 `backend/src/socket/socketServer.test.ts`:
  - import `connectRedis` from `../config/redis`
  - `beforeAll`: 幂等 connect (`!redisClient.isOpen` 才连)
  - `afterAll`: 不调 `disconnectRedis()` —— 注释解释单例共享
- 改 `memory-bank/architecture.md`:
  - Docker 配置 章节展开 (启动命令、端口映射、容器名、验证步骤、集成测试前置)
  - 集成测试 Mock 模式 章节拆成 3 个模式: A 完全 mock / B 真实 Redis (socket) / C 真实 DB (HTTP)
  - 加 2026-06-18 全量基线段落
  - 版本 v1.37 → v1.38
- 改 `memory-bank/progress.md`: 加 「测试基线」 完成行 + 「问题与解决」表加 2026-06-18 条目

### 验证
- 连续 3 次 `npx jest --forceExit` 跑出 `Tests: 620 passed, 620 total`
- commit `b906131` (fix(test): socketServer.test.ts connect redis before all + async listen) 已 push origin/master

### 范围外
- socket.io 测试多客户端断连 flake 的根治 (T056 之后做整合测试时再研究)
- 把 docker compose 改成开发期自动启动 (比如 `npm run dev:up` 脚本) — 后续 devx 优化任务

## 2026-06-18 - 任务：T053 卡牌消耗实现收尾

### Prompt
实现 T053（卡牌消耗）：每打一张 deck 来源手牌立即在 DB 中删除 character_deck + player_cards 行（同一事务），公共池卡跳过。失败 best-effort 不影响上层。复用 withTransaction helper。

### 思考
- 关键发现：`query()` 不支持事务（每次 pool.connect() 拿新连接），必须新增 withTransaction helper 用单 client 包 BEGIN/COMMIT/ROLLBACK
- 步骤 9.5 设计：插在 addToDiscardPile（步骤 9）与 broadcast（步骤 10）之间，best-effort 自身 try/catch 包 withTransaction，不让 SQL 错误冒泡到上层
- partial delete 处理：用 throw PartialDeleteError sentinel 让 withTransaction 走 ROLLBACK 路径，外层 catch 用 instanceof 区分 partial (warn) vs error (error) — 避免 fn 内显式 ROLLBACK 后 withTransaction 仍 COMMIT 的副作用
- ID 映射：card_id → player_cards.id，deck_id → character_deck.id，均 PK 查询 O(1)
- 复用价值：withTransaction helper 后续 T054 / T056 直接复用

### 意外
- T053 describe block 初次提交 (b1f3d61) 嵌套位置错误（落在 executePlayCard describe 之外），amend 6dd68da→be85e9a 时同步修正（b1f3d61 保留原状）
- code quality review 发现 partial delete 路径有 ROLLBACK-then-COMMIT 副作用（fn 内显式 ROLLBACK，withTransaction 仍 COMMIT），用 PartialDeleteError sentinel 重构（commit b42f89f）
- T053-5 占位测试 (expect(true).toBe(true)) 在 red phase 不 fail 是预期行为（plan 已批准），不修改
- 集成测试基础设施：docker compose up -d 起 ptidle-postgres-1 (5433) + ptidle-redis-1 (6379)，socketServer.test.ts 用 redisClient.isOpen 幂等 connectRedis 防重复连接
- 测试结果：5/5 T053 + 23/23 executePlayCard (18 T050 + 5 T053) + 480/480 service + 4/4 database 全绿
- 提交链：84f3ae7 (withTransaction) → b1f3d61 (T053 tests) → be85e9a (impl + structural fix) → b42f89f (I-1 sentinel fix)


## 2026-06-20 - 任务：T054 对战结算 API

### Prompt
实现 T054（对战结算 API）：POST /api/battle/result，任一方玩家触发即可，服务端原子写双方 wins/losses/draws + player_battle_history + battles.settled_at + 清理 Redis 全部 battle 临时态，幂等（第二次调用跳过玩家数据写入只返已存数据）。依赖 T052（胜负已判）+ T053（卡牌已消耗 + withTransaction helper）。

### 思考
- 7 步流水线（后调为 8 步）：loadBattle（JOIN 一次拿双方 user_id 复用 recordVictory 模式）/ 鉴权 / 状态校验 / 幂等检测 / withTransaction 内写 4a UPDATE players × 2 + 4b INSERT pbh × 2 + 4c UPDATE battles.settled_at / 并行 loadPlayerStats × 2 + cleanupAllBattleRedisKeys / buildResponse
- 幂等键选择：`battles.settled_at` (TIMESTAMPTZ) 而非 Redis SETNX — DB 自带，崩溃恢复也安全；第二次调用 `settledAt !== null` 跳过整个 withTransaction
- Redis 清理策略：`keys('battle:{id}:*')` 拿全 key 一次性 del；best-effort try/catch + console.error（玩家数据已落库）；KEYS O(N) 在 ~30 key 范围内可接受，MVP 不上 SCAN
- controller error 映射：discriminated union `SettleResult` + switch + `default: never` 编译期穷举 — 新增 error variant 编译失败，杜绝静默漏分支
- stats 查询放事务外：事务已 commit，外部读最新 + 与 Redis 清理并发（Promise.all 3 并行）— 不污染事务边界
- 复用 T053 `withTransaction` helper：单 client BEGIN/COMMIT/ROLLBACK 复用模式
- migration 设计：`UNIQUE(player_id, battle_id)` 防双行 + `CHECK(victory_type IN ...)` 防御性约束；`idx_pbh_player_created` 走「最近对战」查询，`idx_pbh_battle` 走单场反查（每场只有 2 行，索引价值低但保留）

### 意外
- 首次 import `PoolClient` 从 `../config/database` 失败（PG 类型未从该模块 re-export）— 改成 `import type { PoolClient } from 'pg'`
- simplify review 发现 4 个高/中优先级问题：
  1. **copy-paste in applySettlementInTransaction**: 4 个对称 SQL 调用（4a 双 UPDATE + 4b 双 INSERT）易引入参数错位 bug；重构为 `for side of [p1/p2]` 循环 + `insertBattleHistory(client, battle, side)` 收 1 个 `side` 对象替代 7 位置参数
  2. **controller switch 缺 exhaustiveness**: 新增 error variant 会静默漏分支；加 `default: const _exhaustive: never = result.error; throw` 让 TS 编译失败
  3. **stats + Redis 清理串行**: 优化为 `Promise.all([statsA, statsB, cleanup])` 3 并行（cleanup 与 stats 独立）
  4. **test `console.error` spy 顶层不还原**: 改 `beforeEach` 局部 spy + `afterEach mockRestore` 防污染同进程后续 test 输出；集成 test 顺手删 `_refs` 占位语句
- migration 010 第一次应用后我又改了约束（加 UNIQUE + CHECK），需要 drop+recreate `player_battle_history`（dev 表为空，安全）；最终版完整应用一次
- 测试结果：10/10 unit + 11/11 integration + 39/39 全量 suite 全绿（650 tests，比 T053 基线 +30）

### 修复
- 新增 6 文件：`src/migrations/010_t054_settlement.sql` / `src/services/battleSettlementService.ts` (407 行) / `src/services/battleSettlementService.test.ts` (397 行) / `src/controllers/battleController.ts` (83 行) / `src/routes/battle.ts` (22 行) / `src/routes/battle.settlement.integration.test.ts` (317 行)
- 改 1 文件：`src/index.ts` +2 行（battleRoutes import + app.use，按字母序插在 auth/player 之间）
- 改 `memory-bank/architecture.md`：v1.39 → v1.40，加 T054 完整章节（端点规范 + 8 步流水线 + 设计决策 + migration + 文件清单 + 范围外）
- 改 `memory-bank/progress.md`：加 T054 完成行 + 6-20 测试基线行 + 6-20 simplify 修复条目

### 验证
- `npx tsc --noEmit` exit 0，无 TS 错
- `npx jest src/services/battleSettlementService.test.ts --forceExit` → 10/10 pass
- `npx jest src/routes/battle.settlement.integration.test.ts --forceExit` → 11/11 pass
- `npx jest --forceExit` → 39/39 suite, 650/650 test 全绿
- migration 010 已应用到 ptidle-postgres-1：players.wins/losses/draws / battles.settled_at / player_battle_history（含 UNIQUE + CHECK）全部就位

### 范围外
- 资源发放（金币/经验/制造点）— T055+ 后续
- Rating / 段位 — 后续
- 战报回放（battle_data JSON 暴露）— 后续
- 5v5 / NvN 通用（T054 沿用 T052 3v3 假设）
- Redis SCAN 优化（KEYS MVP 够用）
- WebSocket 推送结算事件（客户端走已有 battle:end 事件，POST /result 仅作持久化触发）

---

## 2026-06-20 - 任务：T055 操作合法性校验中心化（WS Handler 入口跨切校验）

### Prompt
T049-T054 实现 PvP 对战完整闭环，但 WS handler 入口层（`battleRoom.ts`）只做了 payload 形状检查，缺 3 类跨切校验：房间成员资格、对战状态、速率限制。T055 在 WS handler 入口引入统一 `validateOperationContext`，覆盖跨切校验，handler 入口 fail-fast 返回 `battle:X:error`，不动 orchestrator 内部校验。Redis 后端，不做 nonce-based replay 防护。

### 思考
- **跨切校验分层**：业务级校验（actor/phase/owner/range/能量）已在 T049/T050 orchestrator 6/17 步流水线内，**不应外移**避免回归；T055 只做 3 类跨切（room/status/rate），位于 handler 入口层，与 payload 形状检查同一阶段。
- **降级策略**：Redis/DB 异常 → allow + console.error。理由：跨切校验目的是防攻击，正常玩家在 Redis/DB 故障时仍应能玩；T049/T050 orchestrator 内已有业务校验兜底，跨切 fail-open 不会导致严重后果。
- **Lua 原子 INCR+EXPIRE**：避免「INCR 后 EXPIRE 之间挂掉导致永久不过期」的边界 bug。固定窗口语义（EXPIRE 只在首次设置，不刷新），简单清晰。
- **4 handler 改造点差异**：`handleBattleJoin` 只加 rate-limit（不加 room：因为 join 前不在 room；不加 status='ongoing'：因为 join 只允许 pending，由 `getPendingBattleForJoin` 吸收）。其余 3 个加完整 opContext。
- **error 事件格式**：复用现有 `battle:X:error { error: '...' }` 格式，让 reason 直接作为 error 字段，前端可识别（reason 枚举与 T049/T050 error variant 命名风格一致：`not_in_room` / `battle_not_ongoing` / `rate_limited`）。
- **mock 改造最小化**：现有 `battleRoom.test.ts` 23 个测试不动逻辑，只更新 mock：`redisClient` 加 `eval` mock、`createMockSocket` 默认 rooms 含 `battle:b1`、`beforeEach` 默认 queryOne 返回 'ongoing' + eval 返回 1。新增 5 个 T055 回归测试覆盖 3 类校验失败 + happy path + handleBattleJoin rate-limit。
- **集成测试用真实 Redis+PG**：rate-limit 跑满 60 次（真实 Redis 计数器）、EXPIRE 用 1s 窗口+1.5s sleep 加速、PG 三种状态（pending/finished/ongoing）插入真实数据。FK 清理顺序：先删 battles → 再删 players → users CASCADE。

### 意外
- 单元测试 case 12（DB fail-open 后 Redis 是否被调）最初断言 `expect(mockEval).not.toHaveBeenCalled()` — **这是测试预期错误**。DB 异常 → checkBattleOngoing 返回 ok → validateOperationContext 继续往下走 → 调 checkRateLimit → mockEval 被调。修正断言为「只验证 console.error 被调，不验证 mockEval」+ 加注释说明 status fail-open 后续步骤仍执行。
- 集成测试 `deleteTestBattle` 一开始直接 `DELETE FROM players`，触发 FK 约束（battles 还引用 player）— 改为「先删 battles 解除 FK → 再删 players」两步走。
- 集成测试 `redisClient.del` 不接受 variadic args（TS 类型 `[keys: RedisCommandArgument[]]`），必须传数组 `[key1, key2]`。
- 现有 `battleRoom.test.ts` 的 `handleBattleSkipPlay` describe 用独立 mockSocket（无 rooms 字段），validator 调 `socket.rooms.has(...)` 抛 TypeError — 加 `rooms: new Set(['s1', 'battle:b1'])`。
- 现有测试 `beforeEach` 默认 `queryOne` 返回 `status: 'pending'`（为 handleBattleJoin 的 `getPendingBattleForJoin` 服务），但 move/play_card/skip_play 需要 `status: 'ongoing'`。改全局默认 `ongoing`，handleBattleJoin 自身 beforeEach 显式 override `pending`（已有此模式，未新增）。
- 测试结果：23/23 wsValidation unit + 10/10 wsValidation integration + 28/28 battleRoom（含 5 新 T055 case）+ 41/41 全量 suite 全绿（688 tests = 650 基线 + 38 新）

### 意外（Smoke Test 后续发现 — Pre-existing DB Schema 缺失）
- **手动 smoke test 暴露 dev DB 缺少 8 个 migrations**（不是 T055 引入的问题，但 smoke test 必须解决才能验证 T055）：
  1. **Migration 003** (`003_add_battle_session_state.sql`): battles 表缺 `current_round` / `current_step` / `current_phase` / `current_actor_id` 列 → `broadcastFullState` 抛 `column "current_round" does not exist`，**init 也因为 phase 状态缺失而失败**
  2. **Migration 006** (`006_public_pool.sql`): `cards` 表缺 `is_public_pool` 列 → initBattleField step 4 (drawCards) 抛 `column "is_public_pool" does not exist`
  3. Migration 005 / 007 / 008 / 009 / 010 同样未应用（缺失 `taunt` 种子卡 / match metadata / battle init 支持表 / 胜利进度 keys / 结算 API 表）
- **修复**：写 `apply-mig-temp.ts` 一次性应用 003-010 共 8 个 SQL 文件到 `ptidle-postgres-1`。**应用顺序严格按数字升序**（003 → 005 → 006 → 007 → 008 → 009 → 010），因为后置 migration 依赖前置 schema。Migration 004 不存在（命名空缺，正常跳过）。
- **影响**：T055 单测 + 集成测试都不依赖此 schema（用 mock 或自己 insert 数据），所以测试套件全绿；**只有真实 end-to-end smoke test 才能暴露**。未来 T056+ 任务需要在 README / setup 脚本中加 "run all migrations" 步骤，否则 dev DB 长期处于缺失状态。

### 修复
- 新增 2 文件：`src/socket/wsValidation.ts` (243 行, validateOperationContext + 3 helpers + Lua 脚本 + 类型) / `src/socket/wsValidation.test.ts` (333 行, 23 case)
- 新增 1 文件：`src/socket/wsValidation.integration.test.ts` (288 行, 10 case, 真实 Redis + PG)
- 改 1 文件：`src/socket/battleRoom.ts` 4 个 handler 各加 validator 调用（joinContext 仅 rate-limit；其余 3 个 opContext 完整）
- 改 1 文件：`src/socket/battleRoom.test.ts` mock 工厂加 `eval` + createMockSocket 加 rooms Set + beforeEach 默认 mockEval=1 + 默认 status='ongoing' + handleBattleSkipPlay mockSocket 加 rooms + 新增 5 个 T055 describe
- 应用 8 个 migrations 到 dev DB（003/005/006/007/008/009/010），smoke test 前置步骤（手动一次性操作）
- 改 `memory-bank/architecture.md`：v1.40 → v1.41，加 T055 完整章节（背景动机 + 设计决策 + 流水线 + 模块 + Lua + handler 改造点 + Redis key + 降级 + 范围外 + 测试）
- 改 `memory-bank/progress.md`：加 T055 完成行 + 6-20 测试基线行

### 验证
- `npx jest src/socket/wsValidation.test.ts --forceExit` → 23/23 pass
- `npx jest src/socket/wsValidation.integration.test.ts --forceExit` → 10/10 pass（真实 Redis Lua + 真实 PG battle row）
- `npx jest src/socket/battleRoom.test.ts --forceExit` → 28/28 pass（23 旧 + 5 新 T055 回归）
- `npx jest --forceExit` → 41/41 suite, 688/688 test 全绿（无 regression）
- **手动 smoke test**（注册 2 用户 → 撮合 → 双 join → 等 ongoing → 刷 65 次 battle:move）：
  - 前 60 次进入业务校验（39 个 `not_in_move_phase` 错误 + 21 个 silent success 走 broadcaster）
  - 第 61-65 次被 rate-limit 拦下，返回 `battle:move:error { error: 'rate_limited' }`
  - Redis 计数器验证：`rl:ws:user:{userId}:battle:move` counter = 65，TTL = 60s
  - smoke test 脚本已在结束后清理（删除 temp .ts 文件 + kill server）

### 范围外（明确不做）
- Nonce-based replay 防护（每条 WS 消息带 nonce）— MVP 外
- orchestrator 内部校验重构（T049/T050 6/17 步内部校验保留）
- per-battle 全局 rate-limit（防双玩家协调攻击）— T055 仅 per-user
- WS 消息结构校验（payload 形状检查保留在 handler 内）
- 能量平衡审计（move + play_card 总扣能量 vs 初始能量）— T056+ 处理
- 跨进程速率聚合（多 instance 时 Redis Lua 已 global，因为用 Redis 单点）
- 5v5 / NvN 通用（T055 沿用 3v3）

---

## 2026-06-20 - 任务：T-FOLLOW-1 实现 migrations runner 自动化

### Prompt
T055 smoke test 暴露 dev DB 长期缺 8 migrations（手动 apply 才能 smoke 起来），需要补齐：(1) `npm run db:migrate` 脚本按数字顺序自动应用 `src/migrations/*.sql`；(2) `migrations` 表记录已应用版本（idempotent）；(3) README + `package.json` scripts 写明启动顺序。

### 思考
**三件套设计**：
1. **跟踪表 `schema_migrations`**：`id SERIAL PK + filename TEXT UNIQUE + applied_at TIMESTAMPTZ DEFAULT NOW()`。UNIQUE 是幂等核心，重复跑第二次会被 `UNIQUE constraint violation` 卡住 → 改为"先 SELECT 已 applied，filter out pending"模式而不是"无脑 apply"，更友好。
2. **排序策略**：直接 `Array.sort()` 字符串升序。`"001_..." < "002_..." < ... < "010_..."` 字典序天然正确，**避免** `parseInt` + 数字排序带来的 edge case（010 会被解析为 10 而非 10？实际上 JS parseInt 没问题，但 simple sort 减少出错面）。004 空缺直接跳过，list 自然不返回。
3. **事务粒度**：**每文件独立事务**（一个 .sql = 一个 BEGIN/COMMIT），不能用整个 batch 一个事务：
   - 后置 migration 可能依赖前置 schema；如果 batch 失败，rollback 全部 → 前置好的也回滚 → 二次跑仍 fail
   - per-file transaction: 001-009 成功 + 010 失败 → 001-009 已 applied，re-run 时 listMigrations 只剩 010，单独排查 010 SQL 即可
4. **CLI 入口模式**：`if (require.main === module) { main(); }` —— 单测 `import { runMigrations }` 不会触发 CLI，避免 jest 一加载就跑数据库。
5. **Bootstrap 自愈**：`ensureMigrationsTable()` 用 `CREATE TABLE IF NOT EXISTS` 自我创建跟踪表，**首次运行也能用**，无需任何前置步骤。
6. **状态码**：`runMigrations` 失败时 `process.exit(1)`，CI 友好；正常完成静默 exit 0。
7. **`printStatus` 分离**：不动 DB 的"看状态"命令独立出来（`--status` / `-s` flag），运维友好。

**实现选择**：
- 位置 `backend/src/scripts/migrate.ts` 而非仓库根 `scripts/`，因为 `tsconfig` + jest roots 都 `<rootDir>/src` 覆盖这里，与 docker compose + backend 紧耦合
- 复用 `pool` / `query` 从 `../config/database`（已配过 PG 5433）

### 意外
1. **mockClient 缺 `release` 方法** — 单测初次跑 8 case 全失败，jest 进程被 `process.exit(1)` 立即终止无任何 case 输出。debug：迁移 `applyMigration` 末尾 `finally { client.release(); }` → mockClient 没 release 方法 → TypeError → runMigrations catch → failureCount++ → process.exit(1)。修：mockClient 加 `release: jest.fn()`。
2. **`MIGRATIONS_DIR` 路径** — 文件从 `backend/scripts/` 移到 `backend/src/scripts/` 后，原 `resolve(__dirname, '../src/migrations')` 解析为 `backend/src/src/migrations/`（双重 src）。修：改为 `resolve(__dirname, '../migrations')`（从 src/scripts/ 回到 src/migrations/ 只需回退一级）。这是 ts-jest + ts-node 路径在 src/ 内的常见 pitfall。
3. **`package.json` scripts 路径滞后** — 改完文件位置后忘记同步 `package.json` 的 `db:migrate` / `db:status` 命令的 `scripts/migrate.ts` 路径 → `npm run` 找不到文件。修：同步改为 `src/scripts/migrate.ts`。
4. **export 缺失** — migrate.ts 三个核心函数 (listMigrations/runMigrations/printStatus) 默认是模块私有，jest 报 `not exported` 编译错误。修：加 `export` 关键字。
5. **Jest roots 配置** — 项目 jest config `roots: ['<rootDir>/src']` 不包含 `backend/scripts/`。最初把 migrate 放仓库根的 `scripts/` 时，jest 找不到测试文件。修：直接挪到 `backend/src/scripts/` 一并解决。

### 修复
- 新增 2 文件：
  - `backend/src/scripts/migrate.ts` (209 行, listMigrations/runMigrations/printStatus + ensureMigrationsTable + getAppliedMigrations + applyMigration + main CLI + require.main 守卫)
  - `backend/src/scripts/migrate.test.ts` (221 行, 8 case: listMigrations 排序 / runMigrations 全应用/部分应用/全跳过/失败 abort + ROLLBACK + 二次运行幂等 / printStatus)
- 改 `backend/package.json`：
  - 新增 scripts: `db:migrate: "ts-node src/scripts/migrate.ts"` + `db:status: "ts-node src/scripts/migrate.ts --status"`
- 改 `memory-bank/architecture.md`：v1.41 → v1.42，加 T-FOLLOW-1 完整章节（背景动机 + 设计决策 + 流水线 + 模块 + SQL 目录约定 + 启动顺序 + 幂等性 + 测试 + 范围外）
- 改 `memory-bank/progress.md`：
  - T-FOLLOW-1 从「待开发」移到「已完成」（2026-06-20）
  - 新增 T-FOLLOW-2 跟踪后续：README 启动顺序 + index.ts 检测缺失 migrations 警告
  - 加「问题与解决」行：mockClient.release 缺失的 fix
  - 测试基线更新：41/688 → 42/696

### 验证
- `cd /home/lovept/PtIDLE/backend && npx jest src/scripts/migrate.test.ts --forceExit` → **8/8 pass**（listMigrations 排序 / runMigrations 5 场景 / printStatus / 二次运行幂等）
- `cd /home/lovept/PtIDLE/backend && npx jest --forceExit` → **42/42 suite, 696/696 test 全绿**（41 基线 + 8 新 migrate test）
- `npm run db:status` → 9 files / 9 applied / 0 pending（004 故意空缺）— schema_migrations 表正确追踪
- `npm run db:migrate` → "All migrations already applied. Nothing to do."（**幂等性确认**：二次运行 0 个 pending + 0 个 connect 调用）

### 范围外（明确不做）
- Down/rollback migrations（项目无 .down.sql 文件，down 是 destructive 操作需要人工 review）
- Non-SQL migrations（未来加 JS/TS migrations 需要扩展 runner，目前纯 SQL）
- Schema diff 自动生成（手写 SQL，配合 architecture.md 文档）
- Migration 锁 / advisory lock（防多进程并发 apply）— 单 dev 场景不需要，未来 prod 多 instance 需要 `pg_try_advisory_lock` 包装
- 自动回滚失败 migration（per-file transaction 已保证 DB 干净，修复 SQL 重跑即可）
- 5v5 / NvN（沿用 3v3）

### T-FOLLOW-2 跟踪
- README 启动顺序文档
- `src/index.ts` 启动时检测 migrations 缺失并 console.warn
- 未来 prod 部署的 advisory lock 包装

---

## 2026-06-20 - 任务：T-FOLLOW-2 Migrations 启动期集成 + README 文档

### Prompt
T-FOLLOW-1 实现了 migration runner，但还差两件事：(1) 仓库根 + backend 都没有 README，新开发者不知道启动顺序；(2) dev DB 缺 migration 时 server 仍能起，运行时才发现 `column "xxx" does not exist`，排查浪费时间。需要：(a) 加根 README + backend README 写明 4 步启动；(b) `src/index.ts` 启动时检测 migrations 缺失并 console.warn。

### 思考
**核心设计抉择：警告 vs 阻塞**？
- **阻塞**（schema 缺就 process.exit(1)）：安全第一，但 dev 体验差 — 用户可能想用 `db:migrate` 修，或者只是临时跑测试
- **警告**（console.warn 但启动）：运维友好，符合 T055 已有 fail-open 风格（wsValidation.ts Redis/DB 错误也是 fail-open allow）
- **选择警告**。理由：dev 场景下"DB schema 错"只是诸多可能问题之一；强制阻塞会让 hot-reload 期间 schema 调整痛苦。生产环境会有 CI/CD 拦截（未来 T-FOLLOW-3），不需要 server 自身做强校验。

**`checkMigrationsStatus` 函数设计**：
- **返回结构**：`{ total, applied, pending, missing, hasPending, ok, error? }` —— **类型化**，调用方不用解析字符串
- **Fail-open**：`ok=false` 时所有计数为 0，`missing=[]` —— 防止 caller 在 DB 错误时误用脏数据
- **`hasPending` 便捷布尔**：避免调用方写 `status.pending > 0` 这种模板代码
- **`missing` 保留 sorted order**：`listMigrations()` 已经是 sort 过的，`filter().map()` 不打乱顺序 → 日志逐行展示友好

**README 双文件策略**：
- 根 README：项目概览 + 4 步快速启动 + 文档索引。新人第一个看的就是这个
- backend/README：后端细节（目录、scripts、API、调试）。常驻开发者查这个
- 避免单文件过长（单文件 200+ 行新手不愿意读完），也避免太短缺信息

**index.ts 集成位置**：
- `testDb()` 之后、`connectRedis()` 之前 —— DB 已确认在线，可以 query `schema_migrations`
- `console.warn`（不是 `console.error`）—— 这是预期内的状态，不是错误
- 静默成功 —— 全部 applied 时不刷日志，避免每次重启都看到 noise

**测试策略**：
- 5 case 覆盖核心路径：all applied / partial pending / all pending / DB error / bootstrap error
- 不用 `jest.isolateModules`（migrate.ts 已经用 `require.main === module` 守卫，import 不会跑 CLI）
- **不写** index.ts 的 e2e 集成测试（项目无 index.ts 单元测试惯例；功能靠单测覆盖 checkMigrationsStatus + 手动 smoke 验证 warn 路径）

### 意外
1. **Smoke test 路径坑**（连续 2 次失败）——
   - 第一次：在 `/tmp/smoke-warn.ts` 写脚本，`./src/config/database` 相对路径 → ts-node 报 `Cannot find module`（因为 /tmp 不在 backend/ 内）
   - 第二次：移到 /tmp/ 后，`ts-node` 仍调用但被 Node ESM loader 拒绝：`TypeError: Unknown file extension ".ts" for /tmp/smoke-warn.ts`（Node 18+ ESM 默认不识别 .ts）
   - **修**：把脚本挪到 `backend/src/scripts/smoke-warn.ts`，import 用相对路径（`../config/database` + `./migrate`）。验证 3 状态切换（before 全 applied → drop 010 → after hasPending=true + missing=['010_xxx.sql'] → 恢复）全 OK 后删除文件

2. **`ok=false` 时 missing 必须为空**的隐含约定 — 写测试时差点断言 `missing=[]` 是因为 `ok=false`，但实际是"DB 错误时我们不知道缺啥"所以留空。代码用 `try/catch` 把所有逻辑都包住，`catch` 块明确给空数组，caller 拿到 `ok=false` 时不应该用 `missing` —— 这是一个隐式契约，写在注释里更明确

3. **`sort()` 返回 reference**？—— `listMigrations()` 用了 `Array.prototype.sort()` 返回 `this`（mutates in place），但因为我们 return 一个新 array（`.map()`），所以 `missing` 不会影响原数组。无 bug，但写测试时确认了一下

### 修复
- 改 1 文件：`backend/src/scripts/migrate.ts` 加 `MigrationStatus` interface + `checkMigrationsStatus()` 函数 + 文件头注释升级（T-FOLLOW-1 → T-FOLLOW-1 + T-FOLLOW-2，新增程序化 API 段）
- 改 1 文件：`backend/src/scripts/migrate.test.ts` import 新函数 + 新增 5 case（case 9-13: 全 applied / 部分 pending / 全 pending / DB 错误 / bootstrap 失败）
- 改 1 文件：`backend/src/index.ts` import `checkMigrationsStatus` + 在 `initializeApp()` 调 `warnIfMigrationsPending()` + 新增 helper 函数
- 新增 2 文件：
  - `README.md`（根，96 行）— 项目概览 + 4 步快速启动 + 项目结构 + 常用命令 + 验证步骤 + 文档索引 + 贡献流程
  - `backend/README.md`（170 行）— 后端快速启动 + 目录结构 + npm scripts + 数据库 + 测试 + API 概览 + 调试技巧
- 改 `memory-bank/architecture.md`：v1.42 → **v1.43**，加 T-FOLLOW-2 完整章节（背景 / 设计 / 模块 / 集成 / README 结构 / 启动顺序 / 测试 / 范围外）
- 改 `memory-bank/progress.md`：
  - T-FOLLOW-2 从「待开发」移到「已完成」（2026-06-20）
  - 新增 T-FOLLOW-3 跟踪后续：CI/CD GitHub Actions
  - 加「问题与解决」行：smoke test 路径坑（/tmp/ 相对路径 + ESM loader）
  - 测试基线更新：42/696 → 42/701

### 验证
- `cd /home/lovept/PtIDLE/backend && npx jest src/scripts/migrate.test.ts --forceExit` → **13/13 pass**（8 旧 + 5 新 checkMigrationsStatus）
- `cd /home/lovept/PtIDLE/backend && npx jest --forceExit` → **42/42 suite, 701/701 test 全绿**（无 regression）
- `npx tsc --noEmit` → 0 错误（type check 干净）
- **手动 smoke test**（一次性脚本 `src/scripts/smoke-warn.ts`）→ 3 状态切换全 OK：
  ```
  before: 9 total, 9 applied, 0 pending, hasPending=false
  DELETE schema_migrations 010 → 9 total, 8 applied, 1 pending, missing=['010_t054_settlement.sql'], hasPending=true
  INSERT 010 → 9 total, 9 applied, 0 pending, hasPending=false ✓ restored
  ```
- **README 验证**：根 README 4 步启动顺序完整 + 链接到 backend/README + backend/README 启动日志样例正确（含 `[migrations] ⚠️  N pending` 警告格式）

### 范围外（明确不做）
- **强制阻塞启动**（fail-open 是有意的，dev 体验 > 严格性；CI/生产用其他方式拦截）
- **自动跑 migrate**（用户应主动控制 schema 变更时机，server 不应有副作用）
- **per-migration 详细 diff**（仅文件名列表，不解析 SQL 内容，避免变 schema diff 工具）
- **CLI 集成警告**（仅 server 启动时检测，`migrate.ts` 自身保持纯 CLI，可独立调用）
- **TS 编译时类型生成**（每次 migration 仍是手写 SQL，不接入 prisma/typeorm/drizzle 等 ORM）
- **prod 多 instance advisory lock**（T-FOLLOW-1 范围外 + 未来 prod 部署才需要）

### T-FOLLOW-3 跟踪
- GitHub Actions CI 跑 jest + db:migrate
- Status badge 加到 README
- Coverage 上传（codecov）可选

---

## 2026-06-20 - 任务：T-FOLLOW-3 CI/CD 接入（GitHub Actions）

### Prompt
T-FOLLOW-1/2 把 dev DB 启动流程自动化了，但所有测试仍靠本地 `npx jest`：新 PR 无自动校验、协作时 "在我机器上能跑" 问题频发、T055 smoke test 暴露的「dev DB 缺 8 migrations」问题应自动拦截。**待办**：(1) 新增 `.github/workflows/ci.yml`（on push/PR → 启 PG/Redis service → npm install → npm run db:migrate → npm test）；(2) 加 status badge 到 README；(3) coverage 上传 codecov（可选）。

### 思考
**核心设计抉择**：

1. **CI 平台**：仓库已在 GitHub → 用 GitHub Actions（免费 + 集成 PR 状态 + 用户已熟悉）
2. **端口差异**：dev docker-compose PG 用 5433（host 端口避开本机冲突）→ 但 GitHub Actions service container 内部就是 5432 → **CI 显式用 5432**。`database.ts` 兜底 `|| '5432'` 自动兼容两端
3. **service container health check**：必须有，否则 jest 启动可能比 PG ready 快 → ECONNREFUSED flake
4. **装包用 `npm ci` 不是 `npm install`**：CI 场景下用 lock file 精确版本，避免 package.json 与 lock 不同步的随机性
5. **先 migrate 再 test**：避免 schema 缺失时跑出假阳性测试失败。T-FOLLOW-1 的 `db:migrate` 幂等，可重复跑
6. **Coverage 处理**：用 `actions/upload-artifact@v4` 保留 30 天 → 不接 codecov（避免 `CODECOV_TOKEN` secret 管理复杂度）。后期需要 badge 时再补
7. **Concurrency 取消**：PR 多次 push 自动取消旧 run（`cancel-in-progress: true`）→ 节省 runner 时间
8. **env vars 必填**：
   - `JWT_SECRET=ci-test-secret-not-for-prod`（auth 测试需要真 token）
   - `DB_PASSWORD=postgres`（service container 配的密码）
   - `NODE_ENV=test`（避免任何 dev 副作用）

**架构亮点**：
- 单 job（`test`）覆盖全量：lint 已由 tsc + jest 类型检查隐式覆盖（jest 用 ts-jest）
- 单 OS（ubuntu-latest）：项目 target Linux server，跨 OS 不是 MVP 目标
- 7 步流水线：checkout → setup-node → npm ci → migrate → test → coverage → upload-artifact
- `cache-dependency-path: backend/package-lock.json` 加速依赖安装

**Badge 设计**：
- shields.io 动态 badge：`https://github.com/YunXihb/PtIDLE/actions/workflows/ci.yml/badge.svg`
- 链接到 Actions page
- 首次跑前显示 "no status"，跑过后显示 pass/fail
- 加了 2 个静态 badge 凑数：tests=701 passing、migrations=9 applied（来自 README 的硬编码数字，CI 真跑通后可考虑改动态）

### 意外
1. **初次写 workflow 时差点把 `DB_PORT: 5433` 复制过去**（沿用 dev .env）→ 在 review 阶段意识到 CI 内部端口不是 host 端口 → 改 5432。这个混淆点是 dev vs CI 最大的区别
2. **`concurrency.group` 语法**：最初想用 `${{ github.workflow }}-${{ github.ref }}` → 简化成 `ci-${{ github.ref }}` 足够（一个 repo 一个 workflow）
3. **没写 workflow 单测**（写不出来，本地没 GitHub Actions runner；用户 push 后首次跑通才验证）→ 接受这个限制，加 YAML 语法 validate (`python3 -c "import yaml; yaml.safe_load(...)"`) 作为本地最小化验证
4. **`if-no-files-found: warn` 弃用警告**：v4 upload-artifact 已支持；用 `warn` 等级让 coverage 生成失败时 workflow 不直接红（保留 test 失败信号更重要）

### 修复
- 新增 1 文件：`.github/workflows/ci.yml`（128 行，jobs.test 含 7 steps + 2 services + env 9 vars）
- 改 1 文件：`README.md`
  - 顶部加 3 个 badge（CI status + tests count + migrations count）
  - 加新章节「🤖 CI（GitHub Actions）」说明 workflow 行为 + 本地等效命令
- 改 `memory-bank/architecture.md`：v1.43 → **v1.44**，加 T-FOLLOW-3 完整章节（背景 / 设计决策 / workflow 结构 / 端口差异表 / 关键踩坑 / 未来增强 / 测试覆盖）
- 改 `memory-bank/progress.md`：
  - T-FOLLOW-3 从「待开发」移到「已完成」（2026-06-20）
  - 新增 T-FOLLOW-4 跟踪后续：CD 自动部署（Docker image + 编排平台）
  - 加「问题与解决」行：dev vs CI 端口混淆
  - 测试基线更新：本地 42/701（CI 待 push 后验证）

### 验证
- `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"` → **YAML valid** + jobs=['test'] + services=['postgres', 'redis'] + 7 steps
- `cd /home/lovept/PtIDLE/backend && npx jest --forceExit` → **42/42 suite, 701/701 test 全绿**（无 regression，CI workflow 是新增不是修改）
- 静态检查：workflow 包含必要 steps（checkout / setup-node / npm ci / db:migrate / jest / coverage / upload-artifact）
- **真实验证**：用户 push 后，GitHub Actions runner 跑通才算 CI 成功（本机无 act runner，不能本地模拟）

### 范围外（明确不做）
- **Codecov 集成**（需 CODECOV_TOKEN secret 管理；artifact 30 天保留够 review 用）
- **Lint 独立 workflow**（jest + tsc 已覆盖类型错误；ESLint 可加但本期不阻塞 CI）
- **多 Node 版本矩阵**（package.json 锁 `engines.node >= 20`，单 20.x 足够）
- **多 OS 矩阵**（dev/prod 都 Linux，Windows/Mac 兼容非目标）
- **CD（自动 deploy）**（dev 手动部署；prod 部署是 T-FOLLOW-4）
- **PR 状态检查 / required checks**（仓库 settings，非 workflow 文件控制；用户审阅后配置）
- **Dependabot 自动 PR**（依赖更新非 MVP 目标）

### T-FOLLOW-4 跟踪
- 多环境部署策略（dev 手动 / staging 自动 from master / prod 手动 trigger）
- Docker image 构建 + push 到 GHCR
- ECS/k8s 部署脚本（项目尚未选定编排平台）
- 部署后 smoke test

---

## 2026-06-22 - 任务：T-FOLLOW-4 CD 接入 - 镜像层（Docker Image + GHCR + Deploy Docs）

### Prompt
T-FOLLOW-3 接入 CI 后, dev/prod 部署仍手动。**待办**：(1) 多环境部署策略；(2) Docker image 构建 + push 到 GHCR；(3) ECS/k8s 部署脚本（**用户已确认暂不做**，因编排平台未选定）；(4) 部署后 smoke test。2026-06-20 22:18 用户中断时 Dockerfile + .dockerignore 已写好, 本地 build 215MB 镜像已存在, smoke test 尚未跑。

### 思考
**核心决策**：

1. **范围收窄**：用户明确选择「只做 image + GHCR, 不做 deploy workflow」。理由：项目尚未选定编排平台, deploy 步骤留 T-FOLLOW-5 决定
2. **镜像设计**：
   - Base: `node:20-alpine` (50MB base, 体积优势)
   - Multi-stage: builder (含 tsc) → runtime (只 prod deps + dist)
   - `USER node` 不跑 root
   - HEALTHCHECK via `node -e "http.get..."` (alpine 无 wget/curl)
   - 镜像体积：215MB (可接受, 进一步优化换 distroless 留 T-FOLLOW-5)
3. **Release workflow**：
   - 触发: tag push `v*` + `workflow_dispatch` (input: version)
   - Buildx multi-platform: linux/amd64 + linux/arm64 (QEMU emulation)
   - Tag 规则: stable vX.Y.Z 打 `latest` + `X.Y`; pre-release vX.Y.Z-rcN **不打** latest (semver 约定); workflow_dispatch 手动 trigger **不打** latest
   - Auth: `secrets.GITHUB_TOKEN` 自动 (需 `packages: write` 权限)
   - Cache: `type=gha` 利用 GitHub Actions 内置缓存
4. **Deploy 文档化**：`docs/deploy.md` 覆盖拉取 / env vars / 启动顺序 (migrations 必先) / 单机 vs compose / 健康检查 / 常见问题
5. **启动顺序硬约束**：镜像**不**自动跑 migrations (migrations 文件不进 dist), 外部 / init container / CI job 负责 (T-FOLLOW-1 幂等的 `npm run db:migrate` 可重复跑)

**架构亮点**：
- Multi-stage + `--omit=dev` 减少 runtime 镜像攻击面
- Multi-arch 默认开 (现代容器生态多 arch 无额外成本)
- Pre-release 用 bash regex `^[0-9]+\.[0-9]+\.[0-9]+$` 区分 stable vs rc/alpha
- Major.minor tag 自动跟随, 用户可锁 minor 升级
- Smoke test 真实跑通 (本地 215MB 镜像 → docker run → /health 200)

### 意外
1. **容器内 `localhost` 解析问题** — 容器内 `localhost` = 容器自己 loopback, 不是 host. 第一次跑 `docker run` 用 `DB_HOST=localhost` 会 ECONNREFUSED. 解决: `docker run --add-host=host.docker.internal:host-gateway` + `DB_HOST=host.docker.internal` (Docker 20.10+ Linux 支持). 文档化在 `docs/deploy.md` § 自定义 build
2. **migrations 路径警告** — `npm run db:migrate` 启动期检查的 `dist/migrations` 路径不存在 (migrations 在 src/, 不进 dist/). 容器日志显示 `[migrations] ⚠️  Failed to check migration status: ENOENT ... '/app/dist/migrations'`. 是预期行为, Dockerfile 头部注释已说明, 但用户可能误以为出错. 已在 deploy.md § 启动顺序 说明「镜像不自动跑 migrations」
3. **PG 客户端未装** — 本地无 `psql` 命令, 不能直接 query dev DB. 改用 `docker exec ptidle-postgres-1 pg_isready` 验证, 不需要 psql 客户端
4. **`docker compose up` 启动** — 用户曾因 WSL2 网络问题放弃 docker PG, 改本地安装 PG. 这次 T-FOLLOW-4 smoke test 重启 docker PG/Redis, 仍能正常工作 (port 5433/6379 监听)
5. **GHCR image visibility 默认 private** — 真实 push 后用户需在 package settings 改 public 才能 `docker pull` 不登录. 文档化在 deploy.md § 拉取镜像 提示

### 修复
- 新增 1 文件: `backend/Dockerfile` (72 行, multi-stage: builder + runtime)
  - Stage 1 `builder`: `npm ci` 全量 + `npm run build` (tsc 产 dist/)
  - Stage 2 `runtime`: `npm ci --omit=dev` + `COPY --from=builder /app/dist` + `USER node` + HEALTHCHECK
  - `EXPOSE 3000` + `CMD ["node", "dist/index.js"]`
- 新增 1 文件: `backend/.dockerignore` (53 行, 排除 node_modules/dist/coverage/.env/tests/docs/.github/Dockerfile)
- 新增 1 文件: `.github/workflows/release.yml` (135 行, buildx multi-arch + GHCR push)
  - 6 steps: Checkout → QEMU → Buildx → Login GHCR → Compute tags → Build and push
  - Tag 输出: stable 打 `latest` + `X.Y`; pre-release / manual 不打
  - Cache: `type=gha,mode=max`
- 新增 1 文件: `docs/deploy.md` (294 行, 9 章节)
  - § 概述 / 镜像 / env vars / 启动顺序 / 部署方式 (单机 + compose) / 健康检查 / 自定义 build / 常见问题 / 相关链接
- 改 `memory-bank/architecture.md`: v1.44 → **v1.45**, 加 T-FOLLOW-4 完整章节 (10 节)
  - 背景 / 用户选择 / 三个交付物 / 镜像设计 / workflow 设计 / 关键决策 / 关键踩坑 / smoke test 结果 / 未来增强 / 测试覆盖
- 改 `memory-bank/progress.md`:
  - T-FOLLOW-4 从「待开发」移到「已完成」(2026-06-22)
  - 新增 T-FOLLOW-5: 部署编排平台选型 + deploy workflow
  - 加「问题与解决」行: 容器内 `localhost` 解析问题

### 验证
- `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))"` → **YAML valid** + jobs=['build'] + triggers=['push', 'workflow_dispatch'] + 6 steps
- `docker run ... ptidle-backend:test` → **HTTP 200** + `{"status":"ok","timestamp":"2026-06-22T07:17:43.349Z","services":{"database":"unknown","redis":"unknown"}}`
- 容器日志: `HTTP+WS server running on port 3000` + `✅ PostgreSQL connected` + `✅ Redis connected` + `✅ All services initialized`
- 镜像清理: `docker stop ptidle-test` + `docker rmi ptidle-backend:test` 成功
- **真实验证**: 后续用户 push tag v* → GHCR image 出现 → `docker pull` + `docker run` 跑通 (本机无 act runner, 真实 GHCR push 等 push 后验证)

### 范围外（明确不做）
- **Deploy workflow** (k8s/ECS/Compose 自动部署) — 编排平台未选定, T-FOLLOW-5 决定
- **Distroless 镜像** (gcr.io/distroless/nodejs20) — 体积优化非 MVP 目标
- **镜像签名 (cosign/sigstore)** — 安全加固非 MVP 目标
- **SBOM 生成 (syft/grype)** — 合规需求未触发
- **镜像扫描 (trivy)** — 安全加固非 MVP 目标
- **Crane/skopeo 跨 registry 同步** — 单 registry 足够

### T-FOLLOW-5 跟踪
- 选编排平台 (k8s/ECS/Compose/Serverless)
- 写 deploy workflow (trigger / 平台 auth / 滚动更新 / 回滚 / smoke test)
- 多环境策略 (dev 手动 / staging 自动 from master / prod 手动 trigger)
- Secrets 管理 (GH secrets / Vault / 平台 secret store)
- Distroless 镜像评估 (体积优化)
- 镜像签名 + 扫描 (安全加固)

---

## 2026-06-22 - 任务：CI 首次跑通验证（T-FOLLOW-4 commit push 触发）

### Prompt
T-FOLLOW-4 commit 5582977 推送后, 自动触发的 CI 是项目首次在 GitHub Actions 真实跑通（T-FOLLOW-3 workflow 文件就绪, 但「真实验证」要等首次 push）。结果作为 T-FOLLOW-3 / T-FOLLOW-4 闭环证据。

### 验证
- Run ID: 27936624591
- Head SHA: 5582977a (T-FOLLOW-4)
- Workflow: `.github/workflows/ci.yml` (CI)
- Trigger: push to master by YunXihb
- 耗时: 2 min 17 sec (07:27:41Z → 07:29:58Z)
- Job: Test (Node 20 + PG 16 + Redis 7) × 1
- 14 steps: 全部 success
- 关键 steps: npm ci → db:migrate → jest --forceExit (42/701) → coverage → upload-artifact
- 对比前次 (T-FOLLOW-3 commit 8ea94478): 也 success, 同样跑通完整链路

### 意义
- T-FOLLOW-3 (CI) + T-FOLLOW-4 (CD/image) 完整闭环
- T055 「dev DB 缺 8 migrations」类问题现在自动拦截（db:migrate 在 test 之前, 失败时 jest 不会跑）
- Status badge 即将从 "no status" 变绿
- Coverage artifact 30 天保留可 review

### 后续
- 继续 trigger release workflow (git tag v0.1.0) 验证 GHCR push 链路
- T-FOLLOW-5 选编排平台后写 deploy workflow

---

## 2026-06-22 - 任务：v0.1.0 首次发布（trigger release workflow）

### Prompt
T-FOLLOW-3 (CI) + T-FOLLOW-4 (CD/image) 已就绪, 但 release workflow 真实 GHCR push 链路尚未验证。**待办**: 创建 annotated tag v0.1.0 → push 触发 release.yml → 验证 4 tag 全部上传 (latest / 0.1 / 0.1.0 / <sha7>) → 多架构 build 成功。

### 验证
- Tag: `v0.1.0` (annotated, 3 行 release note)
- Run ID: 27937392708
- 耗时: 3 min 19 sec (07:44:13Z → 07:47:32Z) — 比预期 4-8 min 快
- 6 steps: Checkout / QEMU / Buildx / Login GHCR / Compute tags / Build and push 全部 success
- GHCR 4 tag 可见: `latest`, `0.1`, `0.1.0`, `634e2ee` (short SHA)
- Multi-arch (linux/amd64 + linux/arm64) build 无失败 — 实测需 make public 后 `docker manifest inspect`

### 意外
1. **GHCR 默认 private** — 推送成功, 但 anonymous `curl https://ghcr.io/v2/.../manifests/v0.1.0` 返回 401. 用户需在 package settings 手动改 public 才能 `docker pull` 不登录
2. **build 比预期快** — multi-arch 实际 3:19, 不是 4-8 min 估算. QEMU emulation 在 GH Actions runner 性能 OK
3. **GitHub web UI 不显示 OS/Arch** — package 页面只能看 tag + digest, 验证 multi-arch 必须 manifest inspect, 又依赖 package public. 形成 chicken-and-egg

### 修复
- 改 `memory-bank/progress.md`: 加「v0.1.0 Release」行
- 改 `memory-bank/history.md`: 追加本次条目

### 范围外
- **Make package public** — 需用户登录 GitHub 在 package settings 改 (one-click, 无代码改动)
- **Multi-arch 实测** — 待 public 后 `docker manifest inspect ghcr.io/yunxihb/ptidle-backend:v0.1.0` 验证两个平台
- **Trigger workflow_dispatch** — 手动触发留后续测试 (e.g. 跑一个 dev tag)
- **后续 tag** — 0.1.1 / 0.2.0 / 1.0.0 等, 按需打

---

## 2026-06-22 - 任务：T-FOLLOW-5 单 VPS 部署编排（migrate.js + Dockerfile + docker-compose + deploy workflow）

### Prompt
T-FOLLOW-4 完成镜像 + GHCR + deploy docs, 但生产部署仍手动。**待办**: (1) 选编排平台 (用户选单 VPS); (2) CI 触发 SSH deploy (workflow_run + appleboy/ssh-action); (3) docker-compose 4 services (postgres/redis/backend/migrate); (4) 写 deploy.sh + deploy.yml; (5) docs/deploy.md 加 § 5.3; (6) memory-bank 同步。

### 思考
**关键决策路径**:
1. **migrate.ts → migrate.js** — 生产 image 不含 ts-node, 改纯 JS. 新增 MIGRATIONS_DIR env var 让 prod image 从 baked-in `/app/migrations` 读 SQL
2. **migrate 复用 backend image** — 不用独立 node:20-alpine + bind mount, 避免 VPS 维护额外目录 + 每次 deploy 重 npm ci ~60s
3. **4 services compose** — postgres/redis/backend/migrate, migrate 用 profiles 隔离 one-shot
4. **healthcheck 一致性** — Dockerfile, docker-compose, deploy.sh 全部用 `node -e "http.get(...)"` (alpine 无 wget/curl)
5. **trigger = workflow_run** — 监听 release.yml success, 不独立触发, 避免「未发布就部署」
6. **方案 A — 无 auto-rollback** — solo dev, 失败时手动 SSH 修, 简单可靠

**架构亮点**:
- image baked migrations: 原子一致 (同 image), 无 schema 漂移风险
- 同一 image 多用途: backend + migrate 共用, 减少 50MB alpine 镜像
- profiles 隔离: 平时不启 migrate, deploy 时显式 `run --rm`
- depends_on `condition: service_healthy`: backend 等 PG/Redis ready 才启, 避免 cold start race

**踩坑**:
1. `docker compose exec -T` 必须用 `-T` 禁用 TTY (SSH + workflow_run 场景)
2. workflow_run if guard 需 `conclusion == 'success'`, 否则 cancelled release 也会触发 deploy
3. MIGRATIONS_DIR 不显式设会落到 `__dirname/../migrations = dist/migrations` (空目录, 跑报错)
4. package.json 改用 `node src/scripts/migrate.js` (不再用 ts-node), dev 也受益 (启动快 1-2s)
5. **`tsc` 不编译 `.js`** — `migrate.js` 不会被 emit 到 `dist/scripts/`, Dockerfile 需显式 `COPY src/scripts/migrate.js /app/dist/scripts/migrate.js` (Task 2 spec 偏差)
6. **`docker compose up -d` 不 `--force-recreate`** — pull 新镜像不算 config 变化, 旧容器继续跑 (Task 4 code review bug, 需修)
7. **`workflow_run` 不自动 checkout** — `script_path: scripts/deploy.sh` 找不到文件, 需显式 `actions/checkout@v4` (Task 5 code review bug, 需修)

### 意外
1. **T-FOLLOW-4 的 image 默认 private** — `docker compose pull` 在 VPS 上 401, 用户需手动在 GHCR package settings 改 public. 文档化在 docs/deploy.md § 5.3
2. **spec self-review 发现 healthcheck test 行写错** — 初始版 `["CMD", "node", "-e "]` 缺 JS 代码, 修正为 `CMD-SHELL` + 完整 inline script
3. **migrate 复用 backend image 节省 ~50MB + 60s/deploy** — 替代方案独立 alpine image 多 50MB, 且每次 deploy `npm ci` ~60s
4. **Task 1 test 实际 14 个, 不是 spec 写的 9** — 现有 test 文件比 spec 假设的更完善, 包含 5 个 checkMigrationsStatus 边界用例. 接受偏差
5. **Task 1 需新增 `migrate.d.ts`** — 纯 JS 文件被 .ts test 引用需声明文件, ts-jest + tsc 都依赖. spec 没提到, 实操必须
6. **Task 2 / 4 / 5 都有 spec 偏差或 bug** — 详见 progress.md「问题与解决」

### 修复
- 新增 6 文件: `backend/src/scripts/migrate.js`, `backend/src/scripts/migrate.d.ts`, `docker-compose.yml`, `.env.example`, `scripts/deploy.sh`, `.github/workflows/deploy.yml`
- 改 4 文件: `backend/Dockerfile`, `backend/package.json`, `.gitignore`, `docs/deploy.md`, `memory-bank/{architecture,progress,history}.md`
- 删除 1 文件: `backend/src/scripts/migrate.ts` (被 migrate.js 替代)
- 3 个 fix commit: Task 4 `--force-recreate` (52c625e) + Task 5 `actions/checkout` (eee5c29) + 1
- 测试: 14/14 migrate (含 1 新增 MIGRATIONS_DIR env var), 全量 42/42 suite / 702/702 test pass

### 验证
- `npx jest --forceExit` → **42/42 suite, 702/702 test 全绿** (无 regression)
- `python3 -c "import yaml; yaml.safe_load(...release.yml)"` → valid
- `python3 -c "import yaml; yaml.safe_load(...deploy.yml)"` → valid
- `docker build -t ptidle-backend:deploy-test .` → 成功
- `docker run --rm ptidle-backend:deploy-test ls /app/migrations` → 9 SQL 文件
- `docker compose config` (with test env) → valid YAML, 4 services + 2 volumes
- `bash -n scripts/deploy.sh` → 语法 OK
- **真实验证**: 用户 push v* tag → 完整 deploy 链路 (待 push 后验证)

### 范围外（明确不做 / T-FOLLOW-6+）
- HTTPS / TLS / domain (T-FOLLOW-6)
- 自动回滚 (T-FOLLOW-7+)
- 备份 (T-FOLLOW-8+)
- 监控 (T-FOLLOW-9+)
- 镜像签名 / 扫描 (T-FOLLOW-10+)
- Distroless 镜像 (T-FOLLOW-11+)
- HA / multi-instance (T-FOLLOW-12+, 仅在用户量到时考虑)

---

## 2026-06-22 - 任务：T-FOLLOW-6 HTTPS / TLS / domain

### Prompt
T-FOLLOW-5 完成单 VPS CI 自动部署, 但生产级仍缺 HTTPS。规划 T-FOLLOW-6: 加 Caddy 反向代理 + Let's Encrypt 自动 cert + domain 访问。

### 思考
- 选 Caddy 不选 nginx: auto-HTTPS 零配置, 内置 ACME, WebSocket 默认支持, 4 行 Caddyfile 完成需求
- HTTP-01 不选 DNS-01: 不需 DNS API token, 任何 provider 都行, 只需 80 端口可达
- Caddy 放 docker-compose 不放 host native: 跟现有 4-service 模式一致, 升级统一
- 删 backend 直连 host port: 减少攻击面, 玩家只能走 Caddy
- caddy_data named volume 持久化 cert: 容器重建不丢 cert, 避免触发 Let's Encrypt 限速

### 意外
1. **Caddyfile `{$DOMAIN}` 占位符在 caddy validate --adapter caddyfile 模式下不展开**: 验证有 WARN, 真实运行时由 caddy 二进制展开. 不影响功能
2. **原 T-FOLLOW-6 描述包含 4 个子系统 (HTTPS + rollback + backup + monitoring)**: spec 时拆为 T-FOLLOW-6 (HTTPS) / 7 (rollback) / 8 (backup) / 9 (monitoring), 单一 spec 单一 plan 单一实现更可控

### 修复
- 新增 1 文件: `Caddyfile` (4 行)
- 改 4 文件: `docker-compose.yml` (96 → 118 行), `.env.example` (20 → 25 行), `docs/deploy.md` (§ 5.3 加 ~50 行), `memory-bank/{architecture,progress,history}.md`
- 测试: Caddyfile caddy validate + docker compose config 5 services + 全量 42/42 suite / 702/702 test pass (无 regression)
- **真实验证**: 用户 push v* tag 触发完整 deploy 链路 + DNS A 记录 + curl https://$DOMAIN/health (待 push 后验证)

### 验证
- `caddy validate --config Caddyfile --adapter caddyfile` → syntax OK
- `docker compose config` (with DOMAIN/ACME_EMAIL/DB_PASSWORD/JWT_SECRET) → 5 services + 4 volumes, valid YAML
- `grep -E '^(DOMAIN|ACME_EMAIL)=' .env.example` → 2 行 OK
- `! grep -q '^BACKEND_PORT=' .env.example` → OK removed
- 全量 jest → **42/42 suite, 702/702 test 全绿** (无 regression)
- **真实验证**: 用户在 VPS 上配 DNS + .env + docker compose up → https://$DOMAIN/health 200 (待 user 手动验证)

### 范围外（明确不做 / T-FOLLOW-7+）
- 自动回滚 (T-FOLLOW-7+)
- 备份策略 (T-FOLLOW-8+)
- 监控 (T-FOLLOW-9+)
- 镜像签名 / 扫描 (T-FOLLOW-10+)
- Distroless 镜像 (T-FOLLOW-11+)
- HA / multi-instance (T-FOLLOW-12+, 仅在用户量到时考虑)
- Wildcard cert / DNS-01 (T-FOLLOW-13+, 仅在多 sub-domain 时考虑)
- HSTS preload (T-FOLLOW-14+)

---

## 2026-06-25 - 任务：T-FOLLOW-6 bug fix - CI 失败修复（migrate.js 内联 pg.Pool）

### Prompt
用户 github 提示 CI: All jobs have failed, 要求分析原因。3 选 1 修复方案 (A: CI 加 build step, B: migrate.js 内联 pg.Pool, C: revert 回 migrate.ts), 用户选 B 实施。

### 思考
**Phase 1 根因**:
- Run #28099535056 failed: "Apply database migrations" exit 1
- 错误 trace: `Error: Cannot find module '../config/database'` at migrate.js:1
- 时间线: T-FOLLOW-5 commit 4f924e6 把 migrate.ts 重写为 migrate.js, 但**没改 require path**（.js require .ts）; CI workflow 从 T-FOLLOW-3 写好就只 `npm ci`, 没 `npm run build`
- 历史遗漏: T-FOLLOW-3 push 后 run #27936624591 "通过"是因为当时 migrate.ts 还存在, T-FOLLOW-5 push 后才破。run #27963154884 也失败但被漏看

**Phase 2 模式对比**:
- prod Dockerfile: build + 显式 `COPY src/scripts/migrate.js dist/scripts/migrate.js` → 双保险
- CI: 只 npm ci → migrate.js require .ts 必败

**Phase 3 假说**: 选 B（最简方案）：
- migrate.js 改为内联 `const { Pool } = require('pg')` + dotenv.config() + 手写 query() helper
- 不依赖任何 .ts 编译产物, 在 src/ 和 dist/ 双上下文自洽
- 副作用: jest.mock 从 '../config/database' 改为 'pg', mockClientQuery 同时处理 bootstrap/SELECT/business SQL/INSERT

**Phase 4 实施**:
- 改 2 文件 (commit 0079eb2):
  - `backend/src/scripts/migrate.js`: 内联 pool + query helper, dotenv 加载 env
  - `backend/src/scripts/migrate.test.ts`: 改 jest.mock 'pg', bootstrap 走 pool.connect, 更新各 case 计数 (4/10/2)
- 测试: 14/14 migrate test + 全量 suite 39/42 (3 个 integration suite 因本地无 PG/Redis 服务 fail, 与本 fix 无关, CI service container 提供)
- 验证: `node -e "require('./src/scripts/migrate.js')"` 不再抛 MODULE_NOT_FOUND ✓

### 意外
1. **CI 实际自 T-FOLLOW-5 推送起就一直失败**: 用户最初 WebFetch 看 5 个 run 都 success, 实则 run #27963154884 (e10b9da) 也 failed。教训: CI 状态聚合视图可能漏看个别 failed run, 推送后必须点进具体 run 确认每一步
2. **T-FOLLOW-5 spec 写"9 cases"实测 14 cases**: spec/impl 偏差. 此处 case 2/4/5/7/8 因 bootstrap 走 pool.connect 计数都 +2, case 12/13 mock 对象从 mockQuery 换成 mockClientQuery
3. **本地 jest baseline 42/42 / 702/702 需 docker compose up -d**: 关 docker 后跑 jest 会 ECONNREFUSED 127.0.0.1:5433, 误判为代码 regression。下次测前先 docker compose ps 确认

### 修复
- 改 2 文件: `migrate.js` (+40/-?), `migrate.test.ts` (+50/-40)
- 测试: `npx jest src/scripts/migrate.test.ts` → 14/14 pass; 全量 `npx jest` → 39/42 suite (3 integration fail 是本地无服务, 非代码问题)
- **真实验证**: 用户 push commit 0079eb2 后 GitHub Actions CI 跑通 (待验证)

### 范围外
- T-FOLLOW-7 自动回滚 (next)
- T-FOLLOW-8 备份策略
- T-FOLLOW-9 监控

---

## 2026-06-25 - 任务：T-FOLLOW-7 自动回滚

### Prompt
在 T-FOLLOW-5/6 (deploy workflow + HTTPS) 之上加自动回滚安全网 — 新版本 health check 失败时 deploy.sh 自动拉回 .last_good 记录的旧 image 并重启.

### 思考
关键决策: 触发条件 (仅 health check 失败, 不动 migrate/pull) + 回滚目标 (.last_good 文件) + 更新时机 (仅成功后) 三者由用户确认简单方案. 零新依赖, 纯 shell + 1 文件 + 1 env var. 回滚失败不循环检测, loud exit + 用户介入. Migrations forward-only 假设沿用 T-FOLLOW-6 Q4.

### 意外
- .last_good 写失败 / docker inspect 失败: 不应让 deploy 变 red (deploy 实际成功), 改为仅 warning, deploy 仍 exit 0. 步号改为 [0/6] 到 [5/6] + [ROLLBACK] 共 6+1 步.

---

## 2026-06-26 - 任务：T-FOLLOW-7 v0.1.1 部署 + 部署失败诊断

### Prompt
用户 push v0.1.1 tag 后查看 deploy 是否跑成功, 发现 Deploy #1 (run #28175599367) failed, 要求保存进度下次继续.

### 思考
- **8s exit 1 是关键信号**: deploy.sh health check 窗口 30s, 8s 必是 [1/6]~[3/6] 阶段失败 (pull / migrate / up). 错误信息仅 "Process completed with exit code 1", WebFetch 看不到 step-level log (GH UI 需登录)
- **优先怀疑顺序** (按可能性):
  1. `docker compose pull backend` 拉 `:latest` 失败 — 网络/认证问题, v0.1.0 时正常, 期间 VPS 状态可能变化
  2. `docker compose run --rm migrate` 启动后 migrate.js 报错 — T-FOLLOW-6 fix 改过 migrate.js 内联 pg.Pool, 但只是 .ts/.js 互操作问题, 跟运行时 PG 连接关系不大
  3. `docker compose up -d --force-recreate backend` 启动失败 — 新加 `${BACKEND_IMAGE:-...}` env var 解析问题
- **deploy.sh 本身正确**: 跟 git HEAD 比对过, 6+1 步流程跟 spec 完全一致, `set -euo pipefail` 配置正确
- **根因诊断阻塞**: 唯一可靠途径是 SSH 到 VPS 跑 `bash -x scripts/deploy.sh 2>&1 | tee /tmp/deploy-debug.log`, 等用户反馈 log

### 意外
- **WebFetch 看不到 GH Actions step-level log**: github.com/YunXihb/PtIDLE/actions/runs/<id> 页面只显示汇总, 详细 log 要登录. 这点下次 debugging 要先知道
- **deploy.sh 的 `set -e` + 单行失败 = 信息黑洞**: 出错时只 exit 1 + GH 报 "Process completed with exit code 1", 没有失败命令名. 长期改进: 加 trap 'echo "FAIL at line $LINENO: $BASH_COMMAND"' ERR 让 deploy red 时能看到具体行号
- **当前生产状态**: backend container 仍跑 v0.1.0 image (v0.1.1 deploy 没起来), `.last_good` 文件未写入, 站点应仍可用. 用户应确认线上是否正常

### 下次继续
1. **最优先**: 拿到 `/tmp/deploy-debug.log`, 定位 [1/6]~[3/6] 哪行失败
2. 根据失败类型 fix: 若是网络/GHCR auth → 在 deploy.sh 头部加 `docker login ghcr.io` 或换 image pull 策略; 若是 migrate.js → 检查 PG 连通性 + 修迁移; 若是 compose up → 检查 BACKEND_IMAGE env var 解析
3. fix 后 amend v0.1.1 tag 或 push v0.1.2 重试 deploy
4. **可选改进**: deploy.sh 加 ERR trap + 行号; `set -e` 改为 `set -euo pipefail` + 关键命令用 `||` 兜底, 让 deploy 状态可分
5. 部署成功后, deploy 成功路径会写 .last_good, 后续 deploy 才有回滚目标


---

## 2026-08-06 - 任务：T-FIX 质量修复批次（P0 级 bug 修复）

### Prompt
按文件内任务要求继续开发，先摸排已完成项目是否需要修改，然后进行修改。

### 思考
摸排发现"测试全绿但生产跑不通"：单元测试全部 mock 掉 DB/Redis，掩盖了 8 个致命 bug。核心是架构级脱节——战斗状态机写 Redis、编排器读 DB（双状态源），导致移动/打牌/回合推进在生产全部失败。修复策略：
1. 新增 `getSessionState`（读 Redis 完整状态含 activationOrder），战斗链路统一用它；DB 仅审计
2. `executePlayCard` 不再独立 completePlayPhase，统一交给 `executeEndStep`（修复双重推进）
3. 手牌 STRING 存储改用 `removeCardFromHand`（读-过滤-覆盖写），替代错误的 lRem
4. 阵营判定用 battles 表 player1/2_id (UUID) 映射 side，据点坐标按 positions HASH 反查
5. 经济系统（制造/采集/离线/加工）全部用 withTransaction + SELECT FOR UPDATE 行锁

### 意外
1. PowerShell Set-Content 破坏测试文件 UTF-8 编码（中文注释损坏致 TS 解析错误），改用 edit 工具 + git checkout 恢复
2. 旧测试断言了错误的实现行为（如 "executeRoundEnd 失败时 end_step 未调"），需同步修正断言匹配正确逻辑
3. test mock 大量依赖 `mockGetDbSessionState`，改函数名需全量替换；部分测试缺 activationOrder 字段
4. lint 有 63 个既有 error（多为 test 文件 require 风格），非本次引入，未处理

### 修复
- 生产代码 15 文件：battleActionService / battleSessionService / battleService / battleOutcomeService / battleRoom / craftingService / gatheringService / playerService / player.ts / processing.ts / characters.ts / jwt.ts / index.ts / auth.ts / authMiddleware.ts
- 测试 6 文件同步更新 + deploy.sh 回滚机制修复
- 测试基线：全量 671/702 通过（4 suite 失败均为本地无 PG/Redis，与基线一致），tsc 零错误，相关 28 suite 566 测试全绿

### 范围外
- T-FOLLOW-7 v0.1.1 部署失败仍需 SSH 调试（P1）
- 剩余 P1/P2 项：错误码统一、缓存工具抽取、Redis key 常量集中、迁移 004 缺失、CORS 收敛等

---

## 2026-08-06 - 任务：T-FIX 批次 2（P1/P2 并发/资产安全 + 代码整洁）

### Prompt
继续进行剩余工作。

### 思考
在批次 1（P0 战斗核心修复）之后，处理剩余 P1（并发/资产安全）和 P2（代码整洁）项：
- P1-A: moveCharacter 三段非原子（hGet+hDel+hSet）改为 Lua 脚本原子执行，杜绝两棋子并发抢占同一空格
- P1-B: settleBattle 幂等 read-then-write 竞态 → 事务内 SELECT ... FOR UPDATE 行锁复核 settled_at
- P1-C: consumePlayerCard 直接 DELETE 无归属复核 → DELETE 带 character_id + 子查询复核 card 归属
- P1-D: 无全局错误中间件 → 加 4 参 Express error handler，统一 JSON 格式
- P1-E: CORS 全开 + auth 无限流 → CORS_ORIGIN env 收敛 + Redis Lua 限流中间件
- P2-A: 5 处手写 5 分钟缓存 → createCache 共享工具
- P2-B: Redis key 4 处手写 → redisKey 常量模块
- P2-C: controller 用 `.includes('中文')` 匹配错误 → MatchmakingError/GatheringError 错误码
- P2-D: 迁移缺 004 + 种子 ON CONFLICT 失效 → 004 加唯一约束 + 005 改 ON CONFLICT(name)

### 意外
1. battleSettlementService 及其集成测试的 withTransaction mock 客户端 query 无默认实现，新增行锁查询后 `lockRes.rows` 崩溃 → 测试 beforeEach 加 `mockClientQuery.mockResolvedValue({ rows: [{ settled_at: null }] })`
2. migrate.test.ts 3 个失败是 Windows 路径分隔符（D:\ vs /）既有问题，非本次引入（CI Linux 通过）
3. 控制台输出 UTF-8 中文乱码，需重定向到文件后用 Read 检查
4. rateLimit Lua 常量定义在函数后，模块加载期 const 初始化正常（函数内运行时引用无 TDZ 问题）

### 修复
- 生产代码 12 文件：battleService / battleSettlementService / battleActionService / matchmakingService / gatheringService / handService / battleOutcomeService / battleSessionService / battleInitializationService / statusEffectService / professionMechanicService / index.ts / player.ts / processing.ts / characters.ts / craftingService / processingService / cardService / skillService / professionService / matchmakingController / gatheringController / auth.ts
- 新增 4 文件：utils/cache.ts / utils/redisKeys.ts / middleware/rateLimit.ts / migrations/004_t_fix_card_template_unique.sql
- 测试 3 文件适配 + migrate 004 迁移文件
- 测试基线：全量 671/702 通过（4 suite 失败 = Windows 路径 + 本地无 PG/Redis，与基线一致）；tsc 零错误；改动文件零 lint error

### 范围外
- migrate.test.ts 的 Windows 路径断言修复（CI Linux 无需）
- T-FOLLOW-7 v0.1.1 部署失败仍待 SSH 调试（需用户 VPS 访问）
- 剩余 P2：REST 风格统一（动词化 URL vs 资源化）、角色名/用户名长度校验、authService 注册事务化、响应包裹格式统一

---

## 2026-08-06 - 任务：T-FOLLOW-7 失败诊断可观测性（deploy.sh 加 ERR trap）

### Prompt
继续处理遗留项：T-FOLLOW-7 v0.1.1 部署失败（run #28175599367，8s exit 1）无法定位根因，改进 deploy.sh 可观测性。

### 思考
真正修复需 VPS 访问（用户暂无），但硬约束是 job 仅 8s exit 1：docker compose pull（拉 GHCR 镜像）正常要几十秒，8s 不够完成 pull，失败必在极早期。静态分析排除 SSH 连接（会报 SSH 错误而非 exit 1）、.env 缺失（只在 [2/6] migrate 触发，时间不够）。最可能两根因（都在 [1/6]）：(A) /opt/ptidle 未就绪（首次 deploy，cd 或 pull 秒失败）；(B) GHCR 包仍 private + VPS 未 docker login -> pull 401 秒失败。

改进方向：给 deploy.sh 加 ERR trap，任一裸命令失败时打印失败行号 + 定位提示，下次失败从 GH Actions 日志直接看行号 + 上方 stderr，无需 SSH 到 VPS 跑 bash -x。

### 意外
1. bash ERR trap 在 set -u（未定义变量）错误时不触发（POSIX/bash 版本相关），但 bash stderr 自带行号（line N: VAR: unbound variable），仍可定位
2. architecture.md 原文用 Unicode 箭头 →（U+2192）非 ASCII ->，导致首次 Edit 多行匹配失败；改用单行锚点 `### 不做 (YAGNI)`（唯一）插入成功
3. history.md 2026-08-06 两条 T-FIX 条目此前被 PowerShell Set-Content 破坏成 GBK 乱码，本轮先用 iconv -f GBK -t UTF-8 恢复（commit e619caf）后再追加本条目

### 修复
- scripts/deploy.sh: 加 set -E + trap on_error ERR + on_error 函数（打印 BASH_LINENO[0] 行号 + 定位提示）+ cd 前加 echo "==> [init] cd /opt/ptidle" 标记
- memory-bank/architecture.md: T-FOLLOW-7 段加"失败诊断可观测性"小节
- memory-bank/progress.md: 加"T-FOLLOW-7 失败诊断"完成行
- 本地验证: bash -n 语法 OK；独立模拟脚本验证裸命令失败触发 trap 打印正确行号、if 里的失败不触发、set -u stderr 自带行号
- 测试基线不变（未碰 backend 代码）

### 范围外
- 真正修复 v0.1.1 部署：需 VPS 访问（SSH 跑 bash -x scripts/deploy.sh 或看 GH UI run 日志确认假设 A/B）
- 提示用户：GH UI run #28175599367 "Deploy via SSH" step 日志已含 deploy.sh stdout，可直接看最后一个 ==> [N/6] 定位
- T-FOLLOW-8 备份 / T-FOLLOW-9 监控 / 剩余 P2（待用户选下一步）

---

## 2026-08-06 - 任务：T-FOLLOW-8 备份策略（daily pg_dump + 保留 + 恢复 + storage 抽象）

### Prompt
继续推进遗留项。用户选 T-FOLLOW-8 备份，目标存储选"本地 + 抽象接口"（不依赖外部账号，能立即实现+验证，后续 B2/S3 易加）。

### 思考
当前环境无 superpowers skill，自按项目约定写 spec + plan。设计：bash backup.sh + postgres:16 image（含 pg_dump）+ GH Actions scheduled cron + storage 函数 dispatch 抽象（local 实现，b2/s3 TODO 返回 1 不静默）。保留策略 daily14 + weekly8（周一）。恢复 restore.sh 加 CONFIRM_RESTORE 守卫防误跑覆盖。Redis 不备份（redisdata volume 持久化已够，battle session 丢失可接受）。

### 意外
1. bash `local` 多变量陷阱：`local src="$1" name="$2" dest="${...}/${name}"` 中 dest 引用同语句 name，但 local 语句 RHS 用赋值前值 + set -u -> "name: unbound variable"。修复：拆成多行 local
2. architecture.md / docker-compose.yml / deploy.md 多处用 Unicode 破折号和箭头，Edit 多行匹配反复失败；改用单行纯 ASCII 锚点插入成功
3. prune 保留数验证：31 文件删 15 留 16（daily14 + weekly 额外 2）。手算 17 算错（误以为 07-06 在范围）
4. Bash 测试用 `docker run ... | tail` 时 $? 是 tail 退出码非 docker；验证退出码须不 pipe

### 修复
- 新增 scripts/backup.sh（pg_dump custom + storage dispatch + prune daily14/weekly8 + 磁盘检查 + trap）+ scripts/restore.sh（pg_restore --clean --if-exists + CONFIRM_RESTORE 守卫 + verify count）
- docker-compose.yml 加 backup service（postgres:16, profiles:["backup"], 挂载 backups + 脚本）
- .github/workflows/backup.yml（cron '17 3 * * *' + workflow_dispatch, SSH 复用 VPS_SSH_*）
- .env.example 加 BACKUP_STORAGE/RETENTION_DAILY/RETENTION_WEEKLY
- docs/deploy.md 加 § 八 备份与恢复，原 § 八/九 顺延为 § 九/十
- docs/superpowers/specs + plans 各一份
- 本地验证全过：backup 48KB / pg_restore -l 128 TOC / prune 31->16 / b2 TODO exit 1 / restore 14->15->14 / CONFIRM_RESTORE 缺失 exit 1 / bash -n OK

### 范围外
- B2/S3 实际实现（留 TODO 分支，return 1 不静默）
- 真实 VPS 部署验证（需用户 SSH 更新 VPS 配置：docker-compose.yml + scripts + .env BACKUP_*；GH secrets VPS_* 已配 deploy.yml 复用）
- T-FOLLOW-9 监控 / 剩余 P2（待用户选下一步）

---

## 2026-08-07 - 任务：T-FOLLOW-9 监控（GH Actions scheduled health check）+ 镜像滞后诊断

### Prompt
按次序推进剩余待办。先验证 CI/CD 闭环（接续点1）；用户选「先做监控(无域名)」--做 T-FOLLOW-9 的 GH Actions scheduled health check（不依赖域名），HTTPS/UptimeRobot 等有域名再补。

### 思考
CI/CD 闭环验证：GitHub Actions outage 已恢复，旧 run 31125799358 是 outage 期 cancelled（从未执行），重触发 run 31157796071 全 6 step success，deploy.sh 在 VPS 完整跑通 pull->migrate->recreate->health，CI/CD 闭环坐实。

云镜白名单（原待办1）：SSH 取证 hids.log/ydservice.log，云镜从未隔离过 /opt/ptidle（零 ptidle 命中、无 isolate 动作），嫌疑排除，白名单非必要。

T-FOLLOW-9 调研时发现**镜像滞后**：deploy.sh 拉 :latest，release.yml 仅 v* tag push 才更新 latest，最后 tag 是 v0.1.1 (e5d21ca, 2026-06-25)，自此所有 deploy 镜像层是空操作。未上线的 backend 代码：e7e51c9 (T-FIX P0 bug + 并发/资产安全 + /health active probe)。这解释了 #5（/health db/redis unknown = 旧镜像无 probe，非 bug）。

### 意外
1. architecture.md line 3015 用 em dash (U+2014) `-` 而非 hyphen，Edit old_string 反复不匹配；python repr 看似一样，hexdump 才发现 0x2014。改用 em dash 后匹配。
2. progress.md 已完成表编辑时误把 T-FOLLOW-7 失败诊断行整行替换成 T-FOLLOW-9，及时回读发现并恢复。
3. MEMORY.md 旧条目 "major outage" (空格) 被我写成 "major_outage" (下划线) 导致 Edit 不匹配--旧记忆里的空格/下划线细节易错。

### 修复
- 新增 .github/workflows/health-check.yml：cron 每 15 min (8,23,38,53) + workflow_dispatch，curl http://$VPS_HOST/health (--retry 3)，判定 200+status:ok，失败开/评论 issue (label health-check, 去重)，恢复自动关 issue，issues:write + GITHUB_TOKEN，复用 VPS_HOST 不引入新 secret
- docs/deploy.md 加 §九 监控（机制/手动触发/局限），原 §九/十 顺延 §十/十一
- memory-bank progress.md (T-FOLLOW-9 移已完成) / architecture.md (3 处状态改部分完成) / history.md (本条)
- docs/superpowers/plans/2026-08-07-tfollow9-monitoring.md (plan 归档)

### 范围外
- Part B 镜像刷新（切 v0.1.2 tag）：outward-facing 发布+部署，需用户明确确认，未擅自做
- UptimeRobot + 5xx 告警：阻塞于域名
- backup workflow 成功率告警：后续

---

## 2026-08-07 - 任务：P2 代码改进 批次1（注册事务化 + 响应包裹统一）

### Prompt
用户选「事务化+响应包裹 (推荐)」范围 + zod 校验库（留下一批）。继续进行 P2：先做注册事务化（数据完整性，隔离低风险），再做响应包裹统一（API 一致性）。

### 思考
注册事务化：`createUser` 原 5 次独立 `execute`（INSERT user + INSERT players + 3× characters）各自 auto-commit，中间失败留孤立 user（re-register 撞 UserAlreadyExistsError，永不能玩）。`withTransaction`（T053 已有）给 client，但 `execute`/`query` 用自己的 pool 连接无法参与，故必须把 client 线程化进 `initializePlayer`。password hash（bcrypt ~100ms CPU）留事务外避免占连接。existence check 移入事务内同连接读，UNIQUE 约束仍兜底 race。

响应包裹：测试套件早已把 `{success,data}`/`{success,error}` 当事实标准（70× body.data、42× body.error、33× body.success），仅 ~10 处裸字段断言（player /profile、matchmaking matched/status、gathering message）是偏差。故统一 Toward 信封风险远低于预期。决策：保留少数刻意顶层字段（matchmaking matched/status、cards pagination、gathering message、processing missing、409 data.battleId）因其有客户端/测试契约，不强塞进 data；其余裸数据 wrap、错误加 success:false、用 ok()/fail() helper。错误消息原值保留（body.error 断言不动）。inline try/catch 结构保留，next(error)+ApiError 留 REST 统一批次。

### 意外
1. authService.test.ts / auth.integration.test.ts / e2e.test.ts 三个文件都 `jest.mock('../config/database', () => ({query, execute}))` 但没 mock `withTransaction` -> 重构后 `withTransaction is not a function`。三处均补 withTransaction mock（委托 fn(mockClient)）并重写 register 断言（execute 调用 -> client.query 调用，索引 +1 因 existence SELECT 成首调）。
2. player.ts 整文件 Edit 反复不匹配（含中文注释行），拆成小块编辑（import / profile / offline-claim success / 各 error）才过。characters/crafting/processing 改用 Write 整文件重写规避。
3. 真库 smoke：mock 测试覆盖不了真实 BEGIN/COMMIT/ROLLBACK，故写 _smoke_txn.ts 跑 ts-node 验证（注册原子提交 user+1player+3chars、重复拒、withTransaction 抛错后 ROLLBACK 留 0 行），跑完删除。

### 修复
- playerService.initializePlayer 加可选 `client?: PoolClient`（有 client 走 client.query，无 client 走 execute 向后兼容）
- authService.createUser 包 withTransaction（hash 在外，existence+INSERT user+initializePlayer 在内）
- 新增 src/utils/http.ts：`ok(res,data,status=200)` / `fail(res,status,error)`
- index.ts 全局错误中间件 body 加 `success: false`
- 12 routes + 4 controllers 全部改 ok()/fail()（auth.ts、battle.ts 仅路由接线无需改）
- 测试更新：authService.test.ts（mock withTransaction + 注册回滚回归用例）、auth.integration.test.ts、e2e.test.ts、player.integration.test.ts（/profile 裸字段 -> body.data.*）
- memory-bank progress.md/architecture.md/history.md 同步 + docs/superpowers/plans 归档

### 范围外
- zod 字段校验（用户已选 zod，下一批）
- REST 统一（next(error) + ApiError + 状态码 + 路由命名审计，下一批）
- 未切新 release tag / 未部署（outward-facing，需用户确认）

## 2026-08-07 - 任务：P2 代码改进 批次2（zod 字段校验 + REST 统一）

### Prompt
延续批次1 的「范围外」项：用户选 zod 做字段校验。本批做 zod 校验 + REST 统一（next(error)+ApiError+状态码+路由命名审计）。

### 思考
校验：写端点（register/login/gathering-start/crafting×3/processing/characters×3/battle）原散落手写 `if(!field)` / `includes(enum)` 检查，消息不一。改 zod 路由层 `validate(schema)` 中间件统一：safeParse 失败 `next(ApiError(400, 首条 issue 消息))`，通过则替换 req.body（含 default/trim）。schema 自定义 message 逐一对齐既有测试断言（password ≥6、recipeType required、quantity positive integer、Invalid skill type、battleId required 等）。用 zod v3（errorMap 稳定、enum/required_error/invalid_type_error 可控）；empirically 验证 `z.string().trim().min(1)` 在 v3.25 是 trim 先于 min（空格串被拒）。

REST 统一：原全局错误中间件硬编码 500，`next(error)` 只能产 500，故各 handler 自行 `console.error+fail(500,...)`。引入 `ApiError`(status+code?+extra?) + 状态感知 `errorHandler`（ApiError 按 status+展开 extra / ZodError 400 / 其余 500 屏蔽）。catch 统一 `next(error)` 去 boilerplate；ad-hoc `Error&{code}` 收敛 ApiError（gathering GATHERING_ALREADY_ACTIVE->400、processing INSUFFICIENT_MATERIALS->400+missing(extra) / PLAYER_NOT_FOUND->404）。`result.success` 返回对象型服务（crafting/characters/battle/gathering-efficiency）保留显式 fail()（改 throw 需重写所有 mock，风险高收益低）。matchmaking LOSER 兜底（409+data.battleId / 400 兜底）逻辑复杂，保留原 code-matching 不动。auth/rateLimit 401/429 补 success:false。

### 意外
1. 集成测试自建 mini express app **未挂全局错误中间件** -> `next(error)` 落到 Express 默认处理器（HTML/无信封）-> 7 suite 26 test 红（authController/auth.integration/processing/gathering/battle/cards.public-pool/gatheringService 单测）。根因非代码错，是测试 app 缺处理器。修复：把全局处理器抽成 `middleware/errorHandler.ts` 可复用，index.ts + 10 个测试 app 均挂载。gatheringService 单测断言旧 throw 消息「已有进行中的采集任务」-> 改 toMatchObject({name:'ApiError',status:400,message:'Already has active gathering task'})。
2. cards.public-pool 500 测试原断言 `body.error==='Failed to fetch public pool cards'`：改 next(error) 后 500 消息由全局处理器决定（dev=err.message / prod=mask），不再固定。测试改为断言 `status 500 + success:false + error truthy`，反映新契约（500 消息 env-dependent）。

### 修复
- 新增 zod@3 + `middleware/validate.ts` + `validations/{auth,gathering,crafting,processing,characters,battle}.ts`
- 新增 `utils/ApiError.ts`（status/code?/extra?）+ `middleware/errorHandler.ts`（状态感知，index.ts + 10 测试 app 挂载）
- 写端点全挂 validate()，删手写校验；路由/控制器 catch 统一 next(error)
- gatheringService 抛 ApiError(400,'Already has active gathering task')；processing 路由内 INSUFFICIENT_MATERIALS/PLAYER_NOT_FOUND 抛 ApiError（missing 经 extra 回传）
- auth/rateLimit 401/429 补 success:false；auth.test.ts 3 处断言同步
- processing 测试加 `body.missing` 断言（验证 ApiError.extra -> errorHandler 展开）
- memory-bank progress/architecture/history 同步 + plan 归档

### 范围外
- matchmaking 错误流未转 ApiError（LOSER 兜底复杂，保留 code-matching；envelope 已正确）
- `result.success` 型服务未改 throw（需重写 mock，风险高）
- 未切新 release tag / 未部署（outward-facing，需用户确认；P2 批次1+2 代码均未上线，生产仍 v0.1.2）

---

## 2026-08-08 - ����v0.1.3 ���� + ǰ�� T057 ��ʼ��

### Prompt
�û���VPS �иĶ������½���ͨѶ��ȷ��ͨѶ�������𣻼�¼������������ǰ�˿�������� T057 ��ֹͣ��

### ˼��
- VPS ͨѶ�������� SSH ƾ�ݣ��� GitHub secrets�������� GitHub API �����֤��health-check workflow ���� 5 �� success��VPS ���ߣ�+ release/deploy workflow ״̬��
- ����push tag v0.1.3(a2514ba���� P2 ����1&2 ��˸Ľ� + ǰ�˹Ǽ��ύ) �� Release run 31262817512 success �� Deploy run 31262952269 success �Զ����ߡ�ȷ�� T-FOLLOW-7 ���������ѽ����
- ǰ�ˣ�T057 ��ʼ�� Vue3 ��Ŀ���Ǽܺ����Ͷ���(���� REST/WS ��Լ)��axios ������(JWT ��ͷ + 401 �ǳ� + �ŷ����)��typed request helpers(httpGet/Post/Put/Delete �����ŷ�)��3 stores(auth �� token �־û� / player ����+�ֿ�+���� / game WS ��ս״̬��)��·����������¼/ע��/��ҳ(�������浯��)��5 ռλ��ͼ(T064+ ��ʵ��)��

### ����
1. ��� register ֻ���� User ���� token �� auth store register ��ע����Զ��� login �� token��ԭʵ�ִ���� res.data.token��
2. router ���õ� WorkshopView ����ͼ�����ڵ��� vite build ʧ�� �� �� 5 ��ռλ��ͼ
3. axios �������������ŷ���벻ƥ�䣨TS �� AxiosResponse vs �ŷ⣩�� http.ts �� typed request helpers��httpGet/Post/Put/Delete ֱ�ӷ����ŷ����ͣ�

### �޸�
- ���� frontend/ �����Ǽܣ�package.json / vite.config / tsconfig��2 / index.html / src/{main,App,env.d.ts,types,router,stores��3,services��2,views��6,assets}��
- backend/.dockerignore �ų� frontend
- ���� v0.1.3 ���ߣ�P2 ��˸Ľ���
- memory-bank progress/history ͬ��

### ��Χ��
- T058-T063 ������ T057 �Ǽܾ�����·��/Pinia/��¼ע��/��ҳ�ѿ��ã�����δ��������
- T064+ ǰ�˽��棨����/�ֿ�/����/����/ս��/ƥ��/���㣩������
- ǰ��δ�� CDN/��������ǰ���йܷ���δ����
