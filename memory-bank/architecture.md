# PtIDLE 架构文档 (Architecture)

> 此文件将在项目开发过程中逐步填充
> 记录系统的架构设计、模块划分、技术决策等

---

## 后端项目结构 (backend/)

```
backend/
├── package.json              # 项目依赖配置
├── tsconfig.json            # TypeScript 编译配置
├── .env.example             # 环境变量示例
├── .eslintrc.json           # ESLint 代码规范配置
└── src/
    ├── index.ts             # 应用入口，启动 Express 服务器
    ├── config/              # 配置文件目录
    │   ├── database.ts      # PostgreSQL 数据库连接配置
    │   ├── redis.ts        # Redis 客户端配置
    │   └── env.ts          # 环境变量加载
    ├── controllers/         # 控制器目录（处理请求）
    ├── models/              # 数据模型目录（数据库表映射）
    ├── services/           # 业务逻辑目录
    ├── middleware/          # 中间件目录（JWT 认证等）
    ├── routes/             # 路由目录
    └── socket/             # WebSocket 处理器目录
```

---

## 文件说明

| 文件路径 | 作用 |
|----------|------|
| `package.json` | 定义项目依赖、脚本命令 |
| `tsconfig.json` | TypeScript 编译选项 |
| `.env.example` | 环境变量模板（供开发者参考） |
| `.eslintrc.json` | ESLint 代码规范配置 |
| `src/index.ts` | 应用入口，初始化 Express、加载中间件、启动 HTTP 服务器 |

---

## 数据库表结构

| 表名 | 说明 |
|------|------|
| `users` | 用户账户表 |
| `players` | 玩家数据（资源、材料、装备、挂机队列） |
| `characters` | 棋子（职业、属性、位置） |
| `card_templates` | 卡牌模板 |
| `player_cards` | 玩家卡牌 |
| `character_deck` | 棋子牌库分配 |
| `gathering_skills` | 采集技能 |
| `processing_recipes` | 加工配方 |
| `crafting_recipes` | 制造配方 |
| `professions` | 职业属性 |
| `battles` | 对战记录 |

## 配置文件说明

| 文件路径 | 作用 |
|----------|------|
| `src/config/database.ts` | PostgreSQL 连接池，封装 query/execute 方法 |
| `src/config/redis.ts` | Redis 客户端连接 |
| `src/index.ts` | 应用入口，初始化数据库/Redis 连接 |

## 认证模块

| 文件路径 | 作用 |
|----------|------|
| `src/services/authService.ts` | 用户注册/登录服务：验证输入、密码加密 (bcryptjs)、JWT token 生成、玩家初始化 |
| `src/services/playerService.ts` | 玩家服务：初始化玩家数据（创建玩家记录和棋子） |
| `src/services/offlineService.ts` | 离线收益计算服务：计算离线产出、应用仓储上限 |
| `src/controllers/authController.ts` | 认证控制器：处理注册/登录请求、错误响应 |
| `src/routes/auth.ts` | 认证路由：POST /api/auth/register, POST /api/auth/login |
| `src/routes/player.ts` | 玩家路由：GET /api/player/profile, POST /api/player/offline-claim |
| `src/middleware/auth.ts` | JWT 认证中间件：验证 token、解析用户信息到请求对象 |

## Docker 配置

| 文件 | 说明 |
|------|------|
| `docker-compose.yml` | PostgreSQL + Redis 容器编排 |

### 启动开发环境依赖

集成测试需要真实的 PostgreSQL + Redis 服务在跑。`docker-compose.yml` 启动两个容器：

```bash
# 在仓库根目录执行
docker compose up -d
```

启动后端口映射：

| 容器 | 容器端口 | 宿主机端口 | `.env` 对应字段 |
|------|----------|------------|-----------------|
| `ptidle-postgres-1` (postgres:16) | 5432 | **5433** | `DB_HOST=localhost` + `DB_PORT=5433` |
| `ptidle-redis-1` (redis:7-alpine) | 6379 | **6379** | `REDIS_HOST=localhost` + `REDIS_PORT=6379` |

容器名、镜像版本、PostgreSQL 凭据（`postgres/your_password`、DB 名 `ptidle`）都在 `docker-compose.yml` 里固定。

### 验证服务在线

```bash
# Postgres
docker exec -it ptidle-postgres-1 psql -U postgres -d ptidle -c '\dt'

# Redis
docker exec -it ptidle-redis-1 redis-cli ping   # PONG
```

### 集成测试前置条件

跑全量 `npx jest` 之前必须先 `docker compose up -d`，否则：
- `authController.test.ts` 等路由集成测试报 `connect ECONNREFUSED 127.0.0.1:5433`
- `socketServer.test.ts` 等 socket 集成测试报 `ClientClosedError: The client is closed`（虽然也能用 `connectRedis()` 救，但 DB 不可用）

完整流程：

```bash
docker compose up -d
cd backend
npx jest --forceExit
docker compose down   # 收工时关容器
```

## 当前状态

- T001, T002 已完成：项目初始化 + TypeScript + ESLint 配置
- T003, T004 已完成：数据库设计 + Redis 配置
- T005 已完成：用户注册 API（含单元测试和集成测试）
- T006 已完成：用户登录 API（含单元测试，JWT token 认证）
- T007 已完成：JWT 认证中间件（含单元测试，受保护路由示例）
- T008 已完成：玩家初始化逻辑（注册时自动创建玩家和棋子）
- T009 已完成：获取玩家数据 API（返回完整玩家资料）
- T010 已完成：离线收益计算服务（支持24小时最大离线时间）
- T011 已完成：离线收益结算 API（POST /api/player/offline-claim）
- T012 已完成：采集技能数据模型（从数据库读取技能配置）
- T013 已完成：采集 API（POST /api/gathering/start）
- T014 已完成：采集进度查询 API（GET /api/gathering/status）
- T015 已完成：采集完成与收益计算（含定时任务自动完成）

## 离线收益系统

### 资源产出速率

| 资源 | 速率（个/分钟） |
|------|----------------|
| iron_ore | 1 |
| coal | 0.5 |
| wood | 1 |
| sap | 0.5 |
| herb | 1 |
| mushroom | 0.5 |

### 配置参数

- 最大离线时间：24小时（1440分钟）
- 默认仓储上限：1000

### API 响应格式

统一信封（P2 代码改进 批次1/2 落实）：所有路由/控制器经 `src/utils/http.ts` 的 `ok(res, data, status=200)` / `fail(res, status, error)` 输出；未捕获错误经 `next(error)` 流向 `src/middleware/errorHandler.ts` 全局处理器，同样返回信封。

- 成功：`{ success: true, data }`（创建资源传 201）
- 失败：`{ success: false, error }`
- 少数端点保留额外顶层字段供客户端快速判定/定位：matchmaking 的 `matched`/`status`、cards `/my/list` 的 `pagination`、gathering status 空任务的 `message`、processing 缺料的 `missing`、matchmaking 409 的 `data.battleId`。

#### 请求校验（P2 批次2）

写端点经 `src/middleware/validate.ts` 的 `validate(schema)` 中间件做 zod 校验（schema 在 `src/validations/`）：校验失败 `next(ApiError(400, 首条 issue 消息))`，通过则用解析值（含 default/trim 转换）替换 `req.body`。schema 自定义 message 与既有契约对齐（如 `Password must be at least 6 characters`、`recipeType is required`、`Invalid skill type`）。

#### 错误处理（P2 批次2）

- `src/utils/ApiError.ts`：携带 `status` / `message` / `code?`(内部判别，不进响应) / `extra?`(展开进响应，如 `{ missing }`) 的应用错误。
- `src/middleware/errorHandler.ts`：状态感知全局处理器——`ApiError` 按 `status` 返回（+ `extra` 展开），`ZodError` 返回 400，其余 500（生产屏蔽内部详情）。index.ts 与各集成测试 app 均挂载此中间件。
- 路由/控制器 catch 统一 `next(error)`：ad-hoc `Error & {code}` 已收敛为 `ApiError`（gathering `GATHERING_ALREADY_ACTIVE`、processing `INSUFFICIENT_MATERIALS`/`PLAYER_NOT_FOUND`）；catch-all 500 不再各自 `console.error + fail(500,...)`，交由全局处理器。matchmaking 因 LOSER 兜底逻辑复杂暂保留原 code-matching 结构。authController 早已用 `next(error)`。`result.success` 返回对象型服务（crafting/characters/battle/gathering-efficiency）保留显式 `fail()` 映射。
- auth/rateLimit 中间件的 401/429 响应补 `success: false` 保持信封一致。

```typescript
// POST /api/player/offline-claim 响应
{
  success: true,
  data: {
    offlineTime: 120,           // 离线分钟数
    earned: { iron_ore: 60, ... }, // 原本应得
    stored: { iron_ore: 40, ... }, // 实际存入（考虑上限）
    overflowed: { iron_ore: 20, ... }, // 超仓储溢出
    lastOffline: "2026-03-11T10:00:00Z"
  }
}
```

### 注册事务化（P2 代码改进 批次1）

`authService.createUser` 将 existence check + INSERT user + `initializePlayer`（INSERT players + 3 characters）包进 `withTransaction`，password hash 留在事务外（CPU 密集）。`initializePlayer` 加可选 `client?: PoolClient` 参数：传入则写入走同一事务连接，不传则各自 `execute`（向后兼容）。修复此前 5 次独立 auto-commit 写入中间失败留孤立 user 的数据完整性 bug。真库 smoke 验证：注册原子提交（user+1 player+3 chars）、重复拒绝、`withTransaction` 真实 ROLLBACK 留 0 行。

## 采集系统

### 采集 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/gathering/start | 开始采集任务 |
| GET | /api/gathering/status | 查询采集状态 |
| POST | /api/gathering/complete | 手动完成采集（通常由定时任务调用） |
| POST | /api/gathering/cancel | 取消采集任务 |
| GET | /api/gathering/efficiency | 获取采集效率信息（含装备加成） |

### 职业 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/professions | 获取所有职业 |
| GET | /api/professions/:name | 获取单个职业 |

#### 职业配置

| 职业 | 基础血量 | 基础移动 | 基础能量 | 描述 |
|------|---------|---------|---------|------|
| warrior | 20 | 2 | 3 | 战士 - 高血量，近战坦克 |
| ranger | 15 | 3 | 3 | 弓手 - 中等血量，远程单体 |
| mage | 12 | 2 | 3 | 法师 - 低血量，远程AOE |

### 棋子 API

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| POST | /api/characters | JWT | 创建新棋子 |
| GET | /api/characters | JWT | 获取玩家所有棋子 |
| PUT | /api/characters/:id/name | JWT | 更新棋子名称 |
| GET | /api/characters/:id/deck | JWT | 获取棋子牌库卡牌 |
| PUT | /api/characters/:id/deck | JWT | 分配/移除卡牌 |

#### 棋子牌库规则

- 每棋子卡牌上限：**10张**（预设5张 + 灵活5张）
- 分配/移除通过 `action` 参数区分：`assign` | `remove`
- 卡牌归属玩家，不因分配而转移所有权

#### 棋子创建请求/响应

```typescript
// POST /api/characters 请求
{
  name: "新棋子",
  profession: "warrior"  // warrior | ranger | mage
}

// POST /api/characters 响应
{
  success: true,
  data: {
    id: "uuid",
    name: "新棋子",
    profession: "warrior",
    health: 20,
    max_health: 20,
    movement: 2,
    energy: 3,
    max_energy: 3,
    is_alive: true
  }
}

// PUT /api/characters/:id/deck 请求
{
  "cardId": "uuid",           // 玩家卡牌 ID
  "action": "assign"         // "assign" | "remove"
}

// PUT /api/characters/:id/deck 响应
{
  "success": true,
  "data": {
    "character_deck_id": "uuid"  // 分配时返回
  }
}

// GET /api/characters/:id/deck 响应
{
  "success": true,
  "data": [
    {
      "deck_id": "uuid",
      "card_id": "uuid",
      "name": "轻击",
      "type": "attack",
      "cost": 1,
      "effect": { "damage": 2 },
      "template_no": 1,
      "card_sequence": 1,
      "assigned_at": "2026-03-19T12:00:00Z"
    }
  ]
}
```

### 技能 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/skills/gathering | 获取所有采集技能 |
| GET | /api/skills/gathering/:type | 获取单个采集技能 |

### 采集技能配置

| 技能 | 主产物 | 基础产出 | 副产物概率 |
|------|--------|---------|-----------|
| mining | iron_ore | 1/分钟 | coal: 30% |
| woodcutting | wood | 1/分钟 | sap: 20% |
| herbalism | herb | 1/分钟 | mushroom: 30% |

### 产出计算公式

```
实际产出 = 基础产出 × (1 + 装备加成)
装备加成 = sum(各装备.bonus)
最大产出 = min(实际产出, 仓储上限 - 当前资源)
溢出 = max(0, 实际产出 - 最大产出)
```

### 定时任务

- 服务器启动时自动运行采集任务检查器
- 每10秒检查一次 Redis 队列中的到期任务
- 使用 Redis Sorted Set 实现工作队列，支持分布式处理
- 任务到期后自动计算产出并更新玩家资源

### API 请求/响应示例

```typescript
// POST /api/gathering/start 请求
{
  skillType: "mining",  // 或 "woodcutting" | "herbalism"
  characterId?: "uuid"  // 可选，用于装备加成
}

// POST /api/gathering/start 响应
{
  success: true,
  data: {
    id: "gathering_123456789_abc",
    skillType: "mining",
    startedAt: "2026-03-11T12:00:00Z",
    duration: 60,
    status: "active"
  }
}

// GET /api/gathering/status 响应
{
  success: true,
  data: {
    id: "gathering_123456789_abc",
    skillType: "mining",
    startedAt: "2026-03-11T12:00:00Z",
    duration: 60,
    status: "active",
    progress: 0.5,
    elapsedSeconds: 30
  }
}

// GET /api/gathering/efficiency 响应
{
  success: true,
  data: {
    efficiency: [
      {
        skillType: "mining",
        baseYield: 1,
        gearBonus: 0.5,
        effectiveYield: 1.5,
        primaryResource: "iron_ore",
        byproduct: "coal",
        byproductChance: 0.3
      },
      {
        skillType: "woodcutting",
        baseYield: 1,
        gearBonus: 0.5,
        effectiveYield: 1.5,
        primaryResource: "wood",
        byproduct: "sap",
        byproductChance: 0.2
      },
      {
        skillType: "herbalism",
        baseYield: 1,
        gearBonus: 0.3,
        effectiveYield: 1.3,
        primaryResource: "herb",
        byproduct: "mushroom",
        byproductChance: 0.3
      }
    ],
    totalBonus: 1.3
  }
}
```

---

### 技能服务

采集技能配置现在从 `gathering_skills` 数据库表读取，包含 5 分钟内存缓存：

| 文件 | 说明 |
|------|------|
| `src/services/skillService.ts` | 技能查询服务（从数据库读取） |
| `src/services/gatheringService.ts` | 修改为使用数据库配置 |

---

### 加工系统

加工配方从 `processing_recipes` 数据库表读取，包含 5 分钟内存缓存：

| 文件 | 说明 |
|------|------|
| `src/services/processingService.ts` | 加工配方查询服务 |
| `src/routes/processing.ts` | 加工 API 路由 |

#### 加工 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/processing/recipes | 获取所有加工配方 |
| GET | /api/processing/recipes/:type | 获取单个配方 |
| POST | /api/processing/process | 执行加工操作 |

#### 加工配方配置

| 类型 | 名称 | 输入 | 输出 | 效率 |
|------|------|------|------|------|
| smelting | 冶炼 | iron_ore:2, coal:1 | iron_ingot:1 | 1.0 |
| carpentry | 木工 | wood:2 | plank:1 | 1.0 |
| grinding | 研磨 | herb:2 | herb_powder:1 | 1.0 |

#### API 响应示例

```typescript
// GET /api/processing/recipes 响应
{
  success: true,
  data: [
    { id: "...", name: "冶炼", type: "smelting", input: {...}, output: {...}, efficiency: 1.0 },
    { id: "...", name: "木工", type: "carpentry", input: {...}, output: {...}, efficiency: 1.0 },
    { id: "...", name: "研磨", type: "grinding", input: {...}, output: {...}, efficiency: 1.0 }
  ]
}

// POST /api/processing/process 请求
{
  recipeType: "smelting",  // 必填：smelting | carpentry | grinding
  quantity: 1              // 可选：默认1
}

// POST /api/processing/process 响应
{
  success: true,
  data: {
    recipe: "冶炼",
    type: "smelting",
    quantity: 1,
    input: { iron_ore: 2, coal: 1 },
    output: { iron_ingot: 1 },
    materials: { iron_ore: 0, coal: 0, iron_ingot: 1, ... }
  }
}
```

---

### 仓库系统

| 文件 | 说明 |
|------|------|
| `src/services/warehouseService.ts` | 仓库数据查询服务 |
| `src/routes/warehouse.ts` | 仓库 API 路由 |

#### 仓库 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/warehouse | 获取玩家仓库数据 |

#### API 响应示例

```typescript
// GET /api/warehouse 响应
{
  success: true,
  data: {
    resources: { iron_ore: 100, wood: 50, ... },
    materials: { iron_ingot: 10, plank: 5, ... },
    storageLimits: { resource: 1000, material: 500, ... }
  }
}
```

---

### 制造系统 (Crafting)

制造配方从 `crafting_recipes` 数据库表读取，包含 5 分钟内存缓存：

| 文件 | 说明 |
|------|------|
| `src/services/craftingService.ts` | 制造配方查询服务 + 执行制造逻辑 |
| `src/routes/crafting.ts` | 制造 API 路由 |

#### 制造 API

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| GET | /api/crafting/recipes | 否 | 获取所有制造配方 |
| GET | /api/crafting/recipes/:category | 否 | 按分类获取配方 |
| POST | /api/crafting/card | JWT | 执行卡牌制造 |
| POST | /api/crafting/gear | JWT | 执行装备制造 |
| POST | /api/crafting/consumable | JWT | 执行消耗品制造 |

#### 制造配方配置

| 配方 | 分类 | 输入材料 | 输出 | 效果 |
|------|------|----------|------|------|
| 矿镐 | gear | iron_ingot×5, plank×2 | 矿镐×1 | mining_bonus +0.5 |
| 伐木斧 | gear | iron_ingot×3, plank×3 | 伐木斧×1 | woodcutting_bonus +0.5 |
| 采集手套 | gear | plank×5 | 采集手套×1 | herbalism_bonus +0.3 |

#### 装备加成映射

```
矿镐 → mining_bonus
伐木斧 → woodcutting_bonus
采集手套 → herbalism_bonus
```

#### API 响应示例

```typescript
// POST /api/crafting/gear 请求
{
  recipeId: "gear-recipe-uuid",
  quantity: 1
}

// POST /api/crafting/gear 响应
{
  success: true,
  data: {
    gearName: "矿镐",
    bonus: 0.5,
    materialsUsed: { iron_ingot: 5, plank: 2 }
  }
}
```

#### 消耗品配方配置

| 配方 | 分类 | 输入材料 | 输出 | 效果 |
|------|------|----------|------|------|
| 回血药 | consumable | iron_ingot×1 或 plank×1 | 回血药×1 | heal +5 |

#### 消耗品 API

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| POST | /api/crafting/consumable | JWT | 执行消耗品制造 |

#### 消耗品响应示例

```typescript
// POST /api/crafting/consumable 请求
{
  recipeId: "consumable-recipe-uuid",
  quantity: 1
}

// POST /api/crafting/consumable 响应
{
  success: true,
  data: {
    consumableName: "回血药",
    quantity: 1,
    effect: { heal: 5 },
    materialsUsed: { iron_ingot: 1 },
    playerConsumableId: "uuid"
  }
}
```

---

### 当前状态

- T001-T016 已完成
- T017 已完成：加工 API
- **T018 已完成**：仓库资源查询 API (GET /api/warehouse)
- T019 已完成：仓储上限管理
- T020 已完成：制造配方数据模型
- T021 已完成：卡牌制造 API (POST /api/crafting/card)
- T022 已完成：装备制造 API (POST /api/crafting/gear)
- T023 已完成：消耗品制造 API (POST /api/crafting/consumable)
- T024 已完成：生产装备效率计算 (GET /api/gathering/efficiency)
- T025 已完成：周期性挂机收益计算（Redis 工作队列）
- T026 已完成：职业数据模型服务层 (GET /api/professions)
- T027 已完成：棋子创建 API (POST /api/characters)
- T028 已完成：棋子查询 API (GET /api/characters)
- T029 已完成：棋子命名 API (PUT /api/characters/:id/name)
- T030 已完成：基础卡牌数据模型 (GET /api/cards)
- **T031 已完成**：卡牌库查询 API (GET /api/cards/my/list)
- **T032 已完成**：卡牌分配 API (PUT /api/characters/:id/deck)
- **T033 已完成**：棋盘初始化逻辑 (9x9 棋盘)
- **T034 已完成**：移动判定逻辑 (BFS 路径检查)
- **T035 已完成**：攻击判定逻辑（射程验证 + 伤害计算 + AOE 范围检索）
- **T036 已完成**：回合流程控制（状态机 + 蛇形激活顺序 + 阶段转换）

---

### 卡牌 API

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| GET | /api/cards | 否 | 获取所有卡牌模板 |
| GET | /api/cards/:id | 否 | 获取单个卡牌模板 |
| GET | /api/cards/my/list | JWT | 获取玩家拥有的卡牌（分页） |

#### 卡牌模板配置

| 卡牌 | 类型 | 费用 | 效果 | 职业限制 | No. | 上限 |
|------|------|------|------|----------|-----|------|
| 轻击 | attack | 1 | damage: 2 | common | 1 | 5 |
| 移动 | tactical | 0 | movement: 1 | common | 2 | 5 |
| 重击 | attack | 2 | damage: 4 | warrior | 3 | 5 |
| 精准射击 | attack | 1 | damage: 3, range: 3 | ranger | 4 | 5 |
| 火球术 | attack | 2 | damage: 3, aoe: true | mage | 5 | 5 |
| 防御 | defense | 1 | shield: 3 | common | 6 | 5 |
| 治疗 | tactical | 1 | heal: 3 | common | 7 | 5 |
| 挑战 | tactical | 1 | type: taunt, range: 3, duration: 1 | warrior | 8 | 5 |

#### 卡牌自动排列

玩家卡牌按以下规则自动排列：
- **template_no**：卡牌种类固定编码（1-7），同种卡牌聚在一起
- **card_sequence**：该玩家拥有该种卡牌的序号（递增）
- **排序**：`ORDER BY template_no ASC, card_sequence ASC`

#### 卡牌数量上限

- 每种卡牌默认上限为 5 张（max_quantity）
- 超出上限时制造返回错误：`Card quantity would exceed limit`
- 溢出处理方案见 T1000-deferred.md

#### 玩家卡牌响应示例

```typescript
// GET /api/cards/my/list?page=1&pageSize=50
{
  success: true,
  data: [
    {
      id: "uuid",
      player_id: "uuid",
      card_template_id: "uuid",
      template_no: 1,        // 轻击
      card_sequence: 1,       // 第1张轻击
      name: "轻击",
      type: "attack",
      cost: 1,
      effect: { damage: 2 },
      quantity: 1,
      created_at: "2026-03-19T12:00:00Z"
    }
  ],
  pagination: {
    page: 1,
    pageSize: 50,
    total: 6,
    totalPages: 1
  }
}
```

---

### 战棋服务 (Battle Service)

| 文件 | 说明 |
|------|------|
| `src/services/battleService.ts` | 棋盘初始化、位置管理、棋子移动、攻击判定 |

#### 棋盘常量

| 常量 | 值 | 说明 |
|------|-----|------|
| BOARD_SIZE | 9 | 9×9 棋盘 |
| MAX_COORDINATE | 8 | 最大坐标值 |
| MIN_COORDINATE | 0 | 最小坐标值 |

#### 坐标系统

- 使用 `(x, y)` 坐标，x 为列(0-8)，y 为行(0-8)
- 字符串 key 格式：`"x,y"`（如 `"3,4"` 表示第3列第4行）

#### 核心函数

| 函数 | 说明 |
|------|------|
| `initializeBoard(battleId)` | 初始化空棋盘（Redis） |
| `placeCharacter(battleId, charId, x, y)` | 放置棋子到位置（原子性） |
| `moveCharacter(battleId, charId, fromX, fromY, toX, toY)` | 移动棋子 |
| `isPositionAvailable(battleId, x, y)` | 检查位置是否可用 |
| `getCharacterIdAtPosition(battleId, x, y)` | 获取指定位置的棋子 |
| `getAllBoardPositions(battleId)` | 获取棋盘所有位置状态 |
| `getCharacterPosition(battleId, charId)` | 获取指定棋子的位置 |
| `isValidCoordinate(x, y)` | 验证坐标是否在范围内 |
| `manhattanDistance(p1, p2)` | 计算曼哈顿距离（移动判定） |
| `euclideanDistance(p1, p2)` | 计算直线距离（远程攻击判定） |
| `validateMovement(battleId, charId, toX, toY)` | 验证移动是否合法（BFS路径检查） |
| `getReachablePositions(battleId, charId)` | 获取棋子可到达的所有位置（供UI高亮） |
| `validateAttack(battleId, attackerId, cardId, targetId)` | 验证单体攻击（射程/能量/阵营/卡牌归属/死亡） |
| `validateAOEAttack(battleId, attackerId, cardId)` | 验证 AOE 攻击（圆形范围检索所有敌方目标） |
| `calculateDamage(cardEffect, profession?)` | 计算伤害（当前 = `cardEffect.damage ?? 0`） |

#### 攻击判定范围规则

- **近战**：`euclideanDistance ≤ 1.5`（卡牌 effect 无 `range` 字段或 `range === 1`）
- **远程**：`euclideanDistance ≤ card.effect.range`（AOE 默认 range=2）
- 距离使用欧几里得距离（圆形判定），不含对角线专属规则

#### 冲突规则

- 同一坐标点只能有 **1 枚棋子**
- 使用 Redis `HSETNX` 保证原子性放置

#### ⚠️ T035 范围说明（超范围实现 T055 局部内容）

实施 T035 时，`validateAttack` / `validateAOEAttack` **实际包含了 T055「操作合法性校验」计划范围内的部分内容**：

| T055 计划项 | 当前 T035 已实现 | 实施 T055 时是否重复 |
|-------------|----------------|-------------------|
| 卡牌归属验证（攻击者必须使用自己的卡牌） | ✅ `battleService.ts:702-705` | 跳过 |
| 能量检查（attacker.energy ≥ card.cost） | ✅ `battleService.ts:708-715` | 跳过 |
| 阵营检查（不能攻击友方单位） | ✅ `battleService.ts:728-731` | 跳过 |
| 死亡检查（攻击者/目标必须存活） | ✅ `battleService.ts:691-694, 723-726` | 跳过 |

**T055 实施时**，应聚焦于**尚未覆盖**的合法性校验项，例如：
- 卡牌是否在手牌中（未打出过 / 未弃牌）
- 棋子本回合是否已行动 / 已移动
- 卡牌职业限制（warrior/ranger/mage 专属）
- 攻击者/目标身上是否有沉默/眩晕/致盲等状态效果

> 遵循项目惯例：T033 实现时也提前包含了 T034 的部分内容（BFS 寻路）。后续任务开始时需检查 `battleService.ts` 现有实现，避免无意义重复。

---

### 战斗会话服务 (Battle Session Service)

| 文件 | 说明 |
|------|------|
| `src/services/battleSessionService.ts` | 回合流程状态机：初始化、阶段转换、步进、轮次切换 |
| `src/migrations/003_add_battle_session_state.sql` | battles 表新增 current_round, current_step, current_actor_id, current_phase 字段 |

#### 状态机

| 状态 | 含义 | 进入条件 | 退出 API |
|------|------|----------|----------|
| `idle` | 当前激活单位待激活 | 初始化 / `endCurrentStep` 切到下一位 | `activateCurrentUnit` |
| `draw` | 抽牌阶段（T037） | `activateCurrentUnit` | `completeDrawPhase` |
| `move` | 自由移动阶段 | `completeDrawPhase` | `completeMovePhase` |
| `play` | 打牌阶段 | `completeMovePhase` | `completePlayPhase` |
| `end_step` | 单位回合结束 | `completePlayPhase` | `endCurrentStep` |
| `end_round` | 本轮所有单位行动完毕 | `endCurrentStep` 命中最后一步 | `endCurrentRound` |
| `finished` | 战斗结束 | T052 胜负判定 | — |

#### 蛇形激活顺序 (Snake Draft)

- **3v3 简化为 ABABAB 6 步，每步 1 个单位**（已确认）
- `buildSnakeOrder(p1Chars, p2Chars)` 算法：2N 步，偶数索引取 p1，奇数索引取 p2
  - 1v1: `[p1[0], p2[0]]`
  - 2v2: `[p1[0], p2[0], p1[1], p2[1]]`
  - 3v3: `[p1[0], p2[0], p1[1], p2[1], p1[2], p2[2]]`
  - 4v4: `[p1[0], p2[0], p1[1], p2[1], p1[2], p2[2], p1[3], p2[3]]`
- **5v5 项目计划使用块状激活模式 (A-1, B-2, A-2, B-2, A-2, B-1)**，与当前 1-单位/步算法不同，留待未来扩展

#### 状态存储

- **Redis 临时状态**：`battle:{battleId}:session` 键存储 `BattleSessionState` JSON
- **PostgreSQL 持久化**：在 `initializeSession` / `endCurrentRound` / `finishSession` 时同步到 `battles` 表
- Redis 临时态为运行时主存，DB 为恢复与审计用

#### 公共 API

| 函数 | 说明 |
|------|------|
| `initializeSession(battleId, p1Chars, p2Chars)` | 初始化会话，生成蛇形顺序，actor=order[0]，phase=idle |
| `getCurrentState(battleId)` | 返回 `BattleSessionView`（包含 totalSteps, nextActorId, isLastStepInRound） |
| `activateCurrentUnit(battleId)` | idle → draw |
| `completeDrawPhase(battleId)` | draw → move |
| `completeMovePhase(battleId)` | move → play |
| `completePlayPhase(battleId)` | play → end_step |
| `endCurrentStep(battleId)` | 推进到下一位（end_step→idle）或 end_step→end_round（最后一步） |
| `endCurrentRound(battleId)` | end_round → idle，round+1，step=0，actor=order[0]（持久化到 DB） |
| `finishSession(battleId)` | 任意阶段 → finished，actor=null（持久化到 DB，T052 使用） |
| `deleteSession(battleId)` | 清理 Redis 临时态（测试 / 重置对战用） |

#### T036 范围说明

- ✅ **在 T036 范围内**：状态机本身、蛇形顺序生成、阶段转换、步进/轮次切换、临时状态管理
- ❌ **不在 T036 范围内**：
  - 抽牌逻辑 → T037
  - 手牌保留机制 → T038
  - 胜负判定 → T052
  - WebSocket 同步 → T045-T047
  - REST 路由 / WS 事件 → T051
  - 战场初始化（棋盘棋子放置） → T048

后续任务应聚焦在上述未覆盖的功能，不要在 T036 基础上添加新机制。

---

### 手牌服务 (Hand Service)

完整覆盖 **T037（抽牌）+ T038（手牌保留 + 弃牌堆）** 的纯服务层。不依赖也不调用 `battleSessionService`——状态机阶段切换由上层 orchestrator（T051 WS 路由）按时序串联：`drawCards → completeDrawPhase → ... → retainHandOnStepEnd → endCurrentStep`。

#### 文件

| 文件 | 说明 |
|------|------|
| `src/services/handService.ts` | 手牌全生命周期：抽牌、读取、保留、弃牌、清理 |
| `src/services/handService.test.ts` | 44 个单元测试（drawCards 15、getActorHand 4、clearActorHand 2、retainHandOnStepEnd 10、getDiscardPile 4、addToDiscardPile 3、clearDiscardPile 2、drawCards+retained 4） |

#### Redis 键设计（session 生命周期内有效）

| 键 | 类型 | 用途 |
|----|------|------|
| `battle:{battleId}:hand:{characterId}` | STRING (JSON HandCard[]) | 当前回合的手牌（每次抽牌覆盖写入） |
| `battle:{battleId}:retained:{characterId}` | STRING (JSON 单张 HandCard) | 跨回合保留的 1 张牌（下次 `drawCards` 时读取并 DEL） |
| `battle:{battleId}:discard:{characterId}` | LIST (JSON HandCard 元素) | 弃牌堆（RPUSH 追加保留时序） |

#### HandCard 结构

```ts
interface HandCard {
  deck_id: string;          // character_deck.id，手牌唯一标识
  card_id: string;          // player_card.id
  name: string;
  type: 'attack' | 'defense' | 'tactical';
  cost: number;
  effect: Record<string, unknown>;
  template_no: number;      // 卡牌种类编号（UI 排序）
}
```

#### 公共 API

| 函数 | 说明 |
|------|------|
| `drawCards(battleId, characterId, count=3)` | T037：消费上回合 retained → 查询 character_deck → Fisher-Yates 洗牌 → 抽 N 张 → 合并 retained 到手牌顶部 → 写 hand key。返回 `DrawCardsResult { success, cards, drawn_count, deck_size, retained_from_previous? }`（`drawn_count` 只算新抽的牌） |
| `getActorHand(battleId, characterId)` | 读取当前手牌；不存在或损坏 JSON 返回 `[]` |
| `clearActorHand(battleId, characterId)` | DEL hand key |
| `retainHandOnStepEnd(battleId, characterId, retainDeckId)` | T038：三路径分支——`null` 全弃 / 命中保留 + 其余弃 / 未命中全弃 + error。空 hand no-op |
| `addToDiscardPile(battleId, characterId, cards)` | RPUSH 多张牌进弃牌堆。空数组 early return（不发 Redis 命令） |
| `getDiscardPile(battleId, characterId)` | LRANGE 0 -1，损坏 JSON 静默过滤 |
| `clearDiscardPile(battleId, characterId)` | DEL discard key |

#### 标准时序（一个单位的完整回合）

```
[N-1 回合 end_step] retainHandOnStepEnd(battleId, charId, 'd2')
                  └─ retained key: {d2 的牌}
                  └─ discard list: append 其余手牌
                  └─ hand key: DEL

[N 回合 draw 阶段] drawCards(battleId, charId, 3)
                  └─ retained key 读到 + DEL → retainedCard = {d2}
                  └─ 查 deck → 抽 3 张
                  └─ hand = [{d2}, ...3 张新抽]
                  └─ 返回 { drawn_count: 3, retained_from_previous: {d2} }

[N 回合 play 阶段] 上层据 getActorHand 验证打出
                  （T055 操作合法性校验）

[N 回合 end_step] retainHandOnStepEnd(...) ← 同上循环
```

#### T037 + T038 范围说明

- ✅ **在 T037/T038 范围内**：
  - 抽牌（含洗牌、count 校验、空牌库、超量抽取）
  - 手牌读 / 写 / 清
  - 回合结束保留 1 张（含未命中安全降级）
  - 弃牌堆 RPUSH / LRANGE / DEL
  - retained 跨回合合并到下次手牌顶部
- ❌ **不在 T037/T038 范围内**：
  - 弃牌堆 → 牌库回收 / 洗回（未来扩展，specs 未要求）
  - 手牌 → WebSocket 推送 / UI 序列化（T045-T047, T051）
  - "卡牌是否在手牌中" 的打牌合法性校验（T055）
  - 战斗结束时统一清理 hand / retained / discard key（T049 / T054）
  - 重连恢复时手牌可见性策略（specs 待定）

#### 测试 Mock 注意事项

- 使用 redis v4 camelCase API：`lRange`、`rPush`（不是 v3 的 `lrange`/`rpush`）
- in-memory 双 store：`stringStore`（hand + retained）和 `discardStore`（discard LIST）
- `del` mock 必须同时清两个 store，因为 `clearActorHand` 与 `clearDiscardPile` 共享同一个 `del` 调用路径

---

## 集成测试 Mock 模式

集成测试运行在独立的 Jest 进程，模块单例（`redisClient`、`pool`）不会自动连接。

### 已知问题：Redis 单例未连接

`src/config/redis.ts:8` 的 `redisClient` 是 `createClient()` 创建但**未调用 `.connect()`** 的单例。集成测试若不 mock 该模块且不显式调用 `connectRedis()`，任何 Redis 命令都会抛 `ClientClosedError: The client is closed`。

### 三种适用模式

#### 模式 A：完全 mock（最常用）

适用：业务逻辑复杂、Redis 调用多、但本测试只关注路由/HTTP 行为。

集成测试应在所有 imports 之前添加：

```ts
jest.mock('../config/redis', () => ({
  redisClient: {
    zAdd: jest.fn(),
    zRem: jest.fn(),
    zRangeByScore: jest.fn(),
    zRange: jest.fn(),
    zCard: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  },
  connectRedis: jest.fn(),
  disconnectRedis: jest.fn(),
}));
```

`jest.fn()` 默认返回 `undefined`，对 `await redisClient.zAdd(...)` 这类 void 操作足够。当 `idleQueueService` 引入新方法时，需同步加进 mock 对象。

适用范围：✅ `src/routes/gathering.integration.test.ts`（2026-06-10 修复）、`src/routes/matchmaking.integration.test.ts`、`src/socket/battleRoom.test.ts`、`src/socket/battleRoom.integration.test.ts`

#### 模式 B：用真实 Redis（socket 集成测试）

适用：`socketServer.test.ts` 这类需要真实 socket.io + Redis 状态广播链路联调的测试。

前置：`docker compose up -d`（Redis 容器在 6379 端口跑着）。

测试代码模板：

```ts
import { connectRedis } from '../config/redis';

beforeAll(async () => {
  // 幂等: 另一个测试文件可能已经连过, 此时 isOpen=true, 跳过
  const { redisClient } = await import('../config/redis');
  if (!redisClient.isOpen) {
    await connectRedis();
  }
  // ...启动 httpServer / io
});

afterAll(async () => {
  await io.close();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  // ⚠️ 不要 disconnectRedis() — redisClient 是单例, 被其他测试文件共享,
  //    关闭它会让后续 test file 全部抛 ClientClosedError
});
```

适用范围：✅ `src/socket/socketServer.test.ts`（2026-06-18 修复）

#### 模式 C：用真实 PostgreSQL（HTTP 集成测试）

适用：`authController.test.ts` 这类需要真实 DB 写入/查询的路由测试。

前置：`docker compose up -d`（PostgreSQL 容器在 5433 端口跑着）。

测试代码无需特殊 setup，直接 import + supertest 即可。容器就绪后 `npx jest src/controllers/authController.test.ts` 全通（15/15）。

适用范围：✅ `src/controllers/authController.test.ts`、`src/routes/{auth,player,characters,processing,cards,crafting,warehouse,professions,skills}*.integration.test.ts`、`src/routes/e2e.test.ts`

### T035/T036 history 误读澄清

T035/T036 history 提到「集成测试 8 个失败」是 PostgreSQL 5433 / Redis 6379 端口未启动的**基线连接错误**。环境拉起后，DB 相关全通；Redis 相关暴露真实缺陷——即上文单例未连接问题，**已修复**。

### 2026-06-18 全量集成测试基线

修复后 36 个 test suite，620 个 test 全部通过（连续 3 次 `npx jest --forceExit` 全绿）。基础设施：
- `ptidle-postgres-1` + `ptidle-redis-1` 通过 `docker compose up -d` 启动
- `socketServer.test.ts` 用模式 B（真实 Redis + 幂等 connect）
- 其他所有集成测试用模式 A（mock）或模式 C（真实 DB）

---

## T039 新增服务（T039）

### 状态效果服务 (Status Effect Service)

| 文件 | 说明 |
|------|------|
| `src/services/statusEffectService.ts` | 通用状态效果框架：apply/remove/tick/get/clear/loadAll |
| `src/services/statusEffectService.test.ts` | 17 个单测，覆盖 apply/remove/tick/clear/shield 累加 |

#### Redis Key 设计

| Key | 类型 | 用途 | 生命周期 |
|-----|------|------|----------|
| `battle:{battleId}:effects:{characterId}` | LIST (JSON StatusEffect) | 状态效果（warrior shield/taunt, future stun/blind/silence） | session |

#### 公共 API

```ts
applyEffect(battleId, characterId, effect) → StatusEffect
removeEffect(battleId, characterId, effectId) → boolean
removeEffectsByType(battleId, characterId, type) → number
getActiveEffects(battleId, characterId, currentRound) → StatusEffect[]  // 过滤 expire_round > currentRound
tickEffects(battleId, characterId, currentRound) → StatusEffect[]  // 清理过期
clearEffects(battleId, characterId) → void
sumActiveShield(battleId, characterId, currentRound) → number  // 累加所有 active shield.value
```

#### StatusEffect 类型

```ts
type StatusEffectType = 'shield' | 'taunt' | 'stun' | 'blind' | 'silence' | 'burn' | 'regen';
interface StatusEffect {
  type: StatusEffectType;
  value?: number;
  duration_rounds: number;
  source_id?: string;
  target_id?: string;
  expire_round: number;
  created_round: number;
  effect_id: string;  // UUID
}
```

### 职业机制服务 (Profession Mechanic Service)

| 文件 | 说明 |
|------|------|
| `src/services/professionMechanicService.ts` | 5 个权限 API + warrior 机制 1（攻击累计护盾）+ warrior 机制 2（嘲讽） |
| `src/services/professionMechanicService.test.ts` | 32 个单测 |

#### 权限 API

| 函数 | 用途 |
|------|------|
| `canUseProfession(charProf, cardProf)` | 纯函数：common → 任何职业；否则必须严格匹配 |
| `getCardProfession(playerCardId)` | JOIN card_templates 读 profession |
| `getCharacterProfession(characterId)` | 从 characters 表读 profession |
| `validateCardForDeckAssignment(charId, cardId)` | 牌组分配路径的权限校验 |
| `validateCardForCombat(charId, cardId)` | 战斗内出牌路径的权限校验（与 deck 等价，T040 拆分） |

#### Warrior 机制

| 函数 | 说明 |
|------|------|
| `onWarriorAttackCardPlayed(battleId, warriorId, cardCost, currentRound)` | 累加 counter + cost buffer；counter≥2 时触发 shield effect (duration 2) 并重置 |
| `applyWarriorTaunt(battleId, warriorId, targetId, range, currentRound, getPos, getPiece)` | range + alive + enemy 校验；写入 taunt effect (duration 1) |
| `getTauntRedirect(battleId, attackerId, intendedTargetId, currentRound)` | 从 target 的 effects 找 active taunt；返回 `mustRedirectTo` + `sourceId` |

#### Warrior 私有 Redis Key

| Key | 类型 | 用途 | 生命周期 |
|-----|------|------|----------|
| `battle:{battleId}:warrior_status:{warriorId}` | STRING (JSON) | warrior 私有计数器 `{attack_counter, attack_cost_buffer}` | session |

### 角色状态栏服务 (Character Status Service)

| 文件 | 说明 |
|------|------|
| `src/services/characterStatusService.ts` | 聚合 API：基础属性 + active effects + totalShield + isTaunted + taunting 列表 |
| `src/services/characterStatusService.test.ts` | 7 个单测 |

#### 单一入口

```ts
getCharacterStatus(battleId, characterId, currentRound) → CharacterStatus | null
```

#### CharacterStatus 字段

| 字段 | 来源 |
|------|------|
| characterId, name, profession, health, maxHealth, energy, maxEnergy, isAlive | `battle:{id}:pieces` (Redis) → 兜底 characters 表 |
| position | `battle:{id}:positions` 扫一遍 |
| effects | `statusEffectService.getActiveEffects()` |
| totalShield | 派生：sum of shield.value |
| isTaunted | 派生：has any active taunt |
| taunting | 派生：扫全场 effects 中 source_id === this_character_id 的 target 列表 |

#### 调用方

- T047 WS 路由在 round 推进、出牌后推送 CharacterStatus
- 当前无 WS 路由（T047 实施）

### T039 battleService 注入

| 改动点 | 文件:行 | 说明 |
|--------|---------|------|
| `getPlayerCard` JOIN | `battleService.ts:593-625` | 新增 `LEFT JOIN card_templates` 拿 `profession` + `type` |
| `validateAttack` profession 校验 | `battleService.ts:5 步` | canUseProfession 拦截；不匹配返回 `Character profession 'X' cannot use card profession 'Y'` |
| `validateAttack` 嘲讽读取 | `battleService.ts:10 步` | getTauntRedirect 命中时返回 `{valid:false, forcedTarget, error}` |
| `validateAttack` warrior 触发 | `battleService.ts:13 步` | warrior + attack card 调 onWarriorAttackCardPlayed；返回 `shieldGained` |
| `validateAOEAttack` profession 校验 | `battleService.ts:5 步` | 同上（AOE 不读 taunt） |
| `validateTauntCard` | `battleService.ts:855+` | 新函数：warrior 专属 + card effect.type='taunt' + range/alive/enemy 校验 + applyWarriorTaunt |

### T039 characterService 注入

| 改动点 | 文件:行 | 说明 |
|--------|---------|------|
| `assignCardToCharacter` profession 校验 | `characterService.ts:6 步` | 在 5 步（deck 已满）之后，调 validateCardForDeckAssignment |

### T039 路由层改动

| 改动点 | 文件:行 | 说明 |
|--------|---------|------|
| profession 错误映射 | `routes/characters.ts:180` | `error.includes('profession')` → 400 |
| 集成测试 | `routes/characters.deck.integration.test.ts` | 5 个用例（成功/profession 错/角色不存在/卡牌不存在/未授权） |

---

## T040 新增服务（T040）

### Ranger 机制 1：攻击累计增伤

#### 概述

- ranger 每打出 2 张攻击卡 → 写入 `damage_boost` 状态效果
- 下次攻击时消耗，对单体或 AOE 主体目标造成 1.5× 伤害（增伤 50%）
- 走 `statusEffectService` 通用框架（与 warrior 护盾同模式）
- 「生产」与「应用」分离：`validateAttack` 仅标记 `damageBoosted=true`；实际 LREM + 1.5× 应用在 T056 `applyDamage` 阶段

#### 公共 API

| 函数 | 用途 |
|------|------|
| `onRangerAttackCardPlayed(battleId, rangerId, currentRound)` | 累加 counter；counter≥2 时写入 damage_boost effect (value=0.5, duration=1) 并重置 counter |
| `getRangerDamageBoost(battleId, rangerId, currentRound)` | 读取 active damage_boost（不消耗），用于 validateAttack/validateAOEAttack 预览 |
| `consumeRangerDamageBoost(battleId, rangerId, currentRound)` | 读取并移除 damage_boost effect（T056 applyDamage 阶段调用） |
| `RANGER_DAMAGE_BOOST_VALUE` | 常量 `0.5`（即 1.5× 增伤） |

#### Ranger 私有 Redis Key

| Key | 类型 | 用途 | 生命周期 |
|-----|------|------|----------|
| `battle:{battleId}:ranger_status:{rangerId}` | STRING (JSON) | ranger 私有计数器 `{attack_counter}` | session |

> damage_boost effect 复用 `battle:{id}:effects:{ranger_id}` LIST key（与 warrior shield 共用 key 命名空间，但每角色独立）

#### T040 battleService 注入

| 改动点 | 文件:行 | 说明 |
|--------|---------|------|
| `AttackValidationResult` 扩展 | `battleService.ts:533-547` | 新增 `damageBoosted?` / `damageBoostValue?` / `primaryTargetId?` / `damagePerTarget?` |
| `validateAttack` ranger 触发 | `battleService.ts:14 步` | ranger + attack card + 非 public_pool → 调 onRangerAttackCardPlayed + getRangerDamageBoost；返回 `damageBoosted=true` / `damageBoostValue=0.5` / `primaryTargetId=targetId` |
| `validateAOEAttack` ranger 触发 | `battleService.ts:12-13 步` | 同上 + 计算 `damagePerTarget[0] = ceil(base * 1.5)`（主体目标），其他保持基础伤害 |

#### T040 失败路径保护

| 场景 | 行为 |
|------|------|
| attack 校验失败（能量/射程/职业）| 不触发累积（在所有校验通过后才累积）|
| attack 被 taunt 强制重定向（`forcedTarget`）| 不触发累积（attacker 出牌失败路径）|
| AOE 校验失败（无目标）| 不触发累积 |
| 公共池卡（source='public_pool'）| 不累积（与 warrior 一致）|

#### T040/T040.5 边界

- T040 仅实现 ranger 机制 1
- 不扩展 `characterStatusService`（用户选「仅机制 1」）
- 不动 warrior 既有 API
- 不动 mage（T041 处理）
- AOE 路径下 `currentRound=0` hardcode（T051 衔接时再补参数）
- `consumeRangerDamageBoost` 由 T056 `applyDamage` 阶段调用

### T040 StatusEffectType 扩展

| 类型 | 用途 |
|------|------|
| `damage_boost` | ranger 攻击累计增伤效果（value=0.5 表示 1.5×）|

## T041 新增服务（T041）

### Mage 机制 2：debuff/灼伤系统（fire mark + burn DoT）

**位置**：`backend/src/services/professionMechanicService.ts`（mageMechanic 命名空间）+ `backend/src/services/battleService.ts`（validateAttack / validateAOEAttack 注入点）

**数据流**：
```
mage 攻击命中 target
  → attachFireMark
  → RPUSH mark_fire effect (expire_round=99999)
  → getActiveEffects 读取 mark 数量
  → 若 mark ≥ 2：LREM 所有 mark_fire + applyEffect 1 个 burn (duration=2, value=1)
  → 返回 MageMarkResult { marksAdded, burnTriggered, currentMarkCount, currentBurnCount }

T051 orchestrator（ABABAB 行动完后）
  → applyBurnDamage(battleId, targetId, currentRound)
  → 返回 BurnDamageResult { totalDamage, burnCount, burnEffectIds }
  → call site 自行扣血（target.health -= totalDamage）+ 决定是否清理 burn
```

**设计要点**：
- mark_fire 无限持续（expire_round=99999），仅在 2 mark 触发 burn 时由 attachFireMark 显式 LREM 清除
- 2 mark 触发 burn：清除所有 mark + 加 1 burn (value=1, duration=2 round)
- target 已有 active burn 时新 mark 被忽略（强制语义）
- AOE 攻击：每个 target 获得 1 个 fire mark（独立计算 burn 触发）
- 公共池卡不附加 mark（`attachFireMark` 内 `source === 'public_pool'` 早退）
- 灼伤伤害结算 call site 在 T051 orchestrator（T041 仅提供 `applyBurnDamage` 函数，不调用）

#### 公共 API

| 函数 | 用途 |
|------|------|
| `attachFireMark(battleId, targetId, currentRound, source)` | mage 攻击命中 target 后调用 → 附加 fire mark；2 mark 触发 burn 转换 |
| `applyBurnDamage(battleId, targetId, currentRound)` | 灼伤伤害结算（T051 调用）；返回 damage + burn effect_ids，不修改 Redis |
| `getMageMarkState(battleId, targetId, currentRound)` | 读取 target 的 mark + burn 状态（调试 / 状态栏聚合用），不修改 Redis |

#### 常量定义

| 常量 | 值 | 用途 |
|------|-----|------|
| `MAGE_MARK_NEVER_EXPIRE_ROUND` | 99999 | mark_fire 无限持续占位 |
| `MAGE_BURN_DURATION_ROUNDS` | 2 | burn 持续 2 个完整 battle round |
| `MAGE_BURN_DAMAGE_PER_TICK` | 1 | burn 单次 tick 伤害 |
| `MAGE_MARK_BURN_THRESHOLD` | 2 | mark_fire 触发 burn 阈值 |

#### Redis Keys

- 复用 `battle:{battleId}:effects:{targetId}` LIST（与 warrior shield / ranger damage_boost 共用 key 命名空间）
- mark_fire：每个 effect = 1 list entry（不限数量叠加，触发 burn 时统一 LREM）
- burn：每个 effect = 1 list entry（duration=2 自然过期，expire_round = currentRound + 2）
- **T041 不新增私有 Redis key**

#### StatusEffectType 扩展

| 类型 | 用途 |
|------|------|
| `mark_fire` | mage 攻击附加的火球术标记（叠 2 触发 burn）|
| `burn` | mage 灼伤效果（value=1 表示 1 点/回合，duration=2 round）|

#### T041 battleService 注入

| 改动 | 位置 | 说明 |
|------|------|------|
| `AttackValidationResult` 扩展 | `battleService.ts:534-552` | 新增 `mageMarkApplied?` / `mageMarksApplied?` / `mageBurnTriggered?` |
| `validateAttack` mage 触发 | `battleService.ts:15 步` | mage + attack card + 非 public_pool → 调 attachFireMark；返回 `mageMarkApplied` / `mageBurnTriggered` |
| `validateAOEAttack` mage 触发 | `battleService.ts:14 步` | mage + AOE attack + 非 public_pool → 循环调 attachFireMark；返回 `mageMarksApplied`（被 burn 拦截的 target 不计）+ `mageBurnTriggered`（任一 target 触发即为 true） |

#### T041 失败路径保护

| 失败场景 | mage mark 行为 |
|---------|---------------|
| 能量不足 | **不**附加 mark（在所有校验通过后才附加）|
| 射程不足 | **不**附加 mark |
| 职业不匹配 | **不**附加 mark |
| target 被嘲讽强制重定向 | **不**附加 mark |
| target 不可达 / 友军 | **不**附加 mark |
| AOE 无目标 | **不**附加 mark |
| 公共池卡 | **不**附加 mark（`attachFireMark` 内 source 早退）|
| target 已有 active burn | **不**附加 mark（`attachFireMark` 内 burn 早退）|

#### T041/T041.5 边界

- T041 仅实现 mage 机制 2（debuff/灼伤系统）
- 不扩展 `characterStatusService`（用户选「仅机制 2」）
- 不动 warrior 既有 API（T039）
- 不动 ranger 既有 API（T040）
- 不引入 mage 私有计数器（mark 在 target 上，不在 mage 上）
- AOE 路径下 `currentRound=0` hardcode（T051 衔接时再补参数）
- `applyBurnDamage` call site 在 T051 orchestrator（T041 不调用）
- 不实现 mage 机制 1（T041.5 后续可做 AOE 增强 / 范围扩大 / cost reduction 等）

#### T041 多职业互不干扰

- 三个职业的私有状态 key 完全独立：`warrior_status` / `ranger_status`（mage 不需要）
- 三个职业的 effects 共享 key 命名空间 `effects:{char_id}`，但每角色独立
- profession check 已有，mage 触发代码只在 `attacker.profession === 'mage'` 分支
- 测试中 warrior/ranger 测试用例不会触发 attachFireMark（profession !== 'mage'）

#### T041 衔接任务（不实施）

- **T051 (WS 路由 orchestrator)**：AOE 路径补 currentRound 参数；ABABAB 行动完后调 `applyBurnDamage` 结算灼伤
- **T054 (对战结算)**：clearEffects 清理所有 effects key（含 mark_fire / burn）
- **T056 (伤害计算权威化)**：applyDamage 实现时读取 mark / burn 状态（如需 burn 减伤抗等）
- **T041.5**（如做）：mage 机制 1（AOE 增强 / 范围扩大 / cost reduction 等），characterStatusService 扩展 debuffCount 派生

### T041 StatusEffectType 扩展

| 类型 | 用途 |
|------|------|
| `mark_fire` | mage 攻击附加的火球术标记（叠 2 触发 burn）|
| `burn` | mage 灼伤效果（value=1 表示 1 点/回合）|

### T039/T055 边界说明

| T055 原计划项 | 当前 T039 已实现 | T055 实施时是否重复 |
|-------------|----------------|-------------------|
| 卡牌职业限制 | ✅ `professionMechanicService.validateCardForDeckAssignment/Combat` + `battleService.ts` 5 步 | **跳过**（T039 范围） |
| 嘲讽读取/重定向 | ✅ `professionMechanicService.getTauntRedirect` + `battleService.ts:10 步` | 跳过 |
| 攻击累计护盾触发 | ✅ `professionMechanicService.onWarriorAttackCardPlayed` + `battleService.ts:13 步` | 跳过 |

T055 范围缩小为：手牌归属、沉默/眩晕/致盲等状态效果检查、其他错误信息标准化。

### T039 卡牌：挑战（taunt）

| 字段 | 值 |
|------|-----|
| template_no | 8 |
| name | 挑战 |
| type | tactical |
| cost | 1 |
| effect | `{type:"taunt", range:3, duration:1, target:"single_enemy"}` |
| profession | warrior |
| max_quantity | 5 |

迁移：`src/migrations/005_seed_taunt_card.sql`

---

## T1001 新增服务：战棋公共池

> 详见 `T1000-deferred.md` 「T1001」章节。设计目标：避免棋子牌库抽空后整回合无操作的负体验。

### 公共池服务 (Public Pool Service)

**位置**：`src/services/publicPoolService.ts`

#### 公共 API

| API | 描述 | 返回 |
|-----|------|------|
| `drawFromPublicPool(need: number): Promise<HandCard[]>` | 从公共池抽 N 张「轻击」HandCard（source='public_pool'） | `HandCard[]` |
| `isPublicPoolDeckId(deckId: string): boolean` | 判断 deck_id 是否公共池卡（`'pool:'` 前缀） | `boolean` |

#### 实现细节

- 公共池卡走 `card_templates` 表（`is_public_pool = TRUE`），不入 `player_cards` 表
- 当前公共池仅含「轻击」（template_no=1）
- 抽 N 张时返回 N 份独立 `HandCard`（同 `deck_id='pool:1'`，同 `card_id`）
- 客户端打牌时按 `source='public_pool'` 路由到 `validateAttack` 公共池分支
- `isPublicPoolDeckId` 是前端/校验辅助函数

### 公共池 API 路由

**位置**：`src/routes/cards.ts`

| 路由 | 鉴权 | 描述 |
|------|------|------|
| `GET /api/cards/public-pool` | 无 | 返回公共池卡牌模板（公共资源） |
| `GET /api/cards/:id` | 无 | 单个卡牌模板（greedy 匹配；公共池路由必须在它之前定义） |

### 卡牌数据模型扩展

**位置**：`src/services/cardService.ts`

`CardTemplate` interface 新增 `is_public_pool: boolean` 字段。

```sql
ALTER TABLE card_templates
  ADD COLUMN IF NOT EXISTS is_public_pool BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_card_templates_public_pool
  ON card_templates(is_public_pool) WHERE is_public_pool = TRUE;
UPDATE card_templates SET is_public_pool = TRUE WHERE name = '轻击';
```

迁移：`src/migrations/006_public_pool.sql`

### HandCard 来源标识（T037 / T1001）

**位置**：`src/services/handService.ts`

`HandCard` interface 新增 `source: 'deck' | 'public_pool'` 字段：
- `source='deck'`：来自棋子的 `character_deck`（玩家私有）→ `deck_id` = `character_deck.id`
- `source='public_pool'`：来自战棋公共池（无限复用）→ `deck_id` = `pool:<template_no>`

`drawCards` 行为变化（T1001）：
- 牌库 ≥ count：行为不变（不调公共池）
- 牌库 < count：实际抽 `min(count, deckSize)` 张 deck 牌 + `count - actualFromDeck` 张公共池牌
- 牌库 = 0：整 `count` 张从公共池补
- `drawn_count = deck 牌数 + 公共池牌数`（不含 retained）

`retainHandOnStepEnd` 行为变化（T1001）：
- 命中公共池卡 → 强制全弃 + error `'public pool cards cannot be retained'`

### 攻击校验公共池路径（T035 / T1001）

**位置**：`src/services/battleService.ts`

`validateAttack` / `validateAOEAttack` 新增第 6 参数 `source: 'deck' | 'public_pool' = 'deck'`：
- `getPlayerCard(cardId, source)` 双 SQL 路径
  - `source='deck'`：原 SQL（`player_cards` LEFT JOIN `card_templates`）
  - `source='public_pool'`：新 SQL（`card_templates WHERE id=$1 AND is_public_pool=TRUE`），返回 `player_id: null`
- 「卡牌归属」校验：公共池卡 bypass `'Card does not belong to attacker'`
- warrior 攻击累计护盾触发：增加 `source !== 'public_pool'` 过滤（公共池卡不计入累计）

### Redis 状态

无新增 key。`HandCard` 在手牌 JSON 中自带 `source` 字段。

### 文件清单

| 路径 | 改动 |
|------|------|
| `src/services/publicPoolService.ts` | **新建**：drawFromPublicPool / isPublicPoolDeckId |
| `src/services/publicPoolService.test.ts` | **新建**：6 测试 |
| `src/services/cardService.ts` | `CardTemplate.is_public_pool` 字段 + `getPublicPoolCards()` |
| `src/services/handService.ts` | `HandCard.source` + `drawCards` 公共池补足 + retain 拒绝公共池 |
| `src/services/handService.test.ts` | 6 新测试 + 旧测试加 `source: 'deck'` 字段 |
| `src/services/battleService.ts` | `getPlayerCard(cardId, source)` 双路径 + `validateAttack/AOEAttack` 第 6 参 source + warrior 触发过滤 |
| `src/services/battleService.test.ts` | 6 新测试 |
| `src/routes/cards.ts` | `GET /api/cards/public-pool` 路由 |
| `src/routes/cards.public-pool.integration.test.ts` | **新建**：5 集成测试 |
| `src/migrations/006_public_pool.sql` | **新建**：`is_public_pool` 列 + 索引 + 标记「轻击」 |

---

## T042 + T043 + T044 新增服务：匹配系统（阶段 4.1）

### 匹配队列服务 (Matchmaking Service)

**位置**：`src/services/matchmakingService.ts`

PvP 对战入口的第一环。玩家认证后通过 `/api/match/queue` 加入全局匹配队列 / 查询状态 / 取消匹配 / 撮合对手。
- T042：实现 `POST /queue`（入队）
- T043：实现 `GET /queue`（查询状态）+ `DELETE /queue`（取消匹配）
- T044：实现 `tryMatch`（撮合两个等待者 + 创建 battles 行）+ LOSER 兜底查询 + 三个 handler 改造

#### Redis 键

| 键 | 类型 | 用途 | 生命周期 |
|----|------|------|----------|
| `idle:matchmaking:queue` | Sorted Set | 全局匹配队列（member = `JSON.stringify({userId, enqueuedAt})`，score = `enqueuedAt` ms） | 进程级 |
| `idle:matchmaking:lock:{userId}` | String | 单用户去重锁，值固定为 `1` | 600s TTL |
| `idle:matchmaking:lock:global` | String | 全局撮合锁，值 = `<uuid>` token | 5s TTL（T044 新增） |

`score = enqueuedAt` 兼作排序依据，T044 撮合时 `ZRANGE key 0 0` O(log N) 即可取最久等待者。

#### 关键顺序

**入队（`enqueueMatchmaking`）—— 先抢锁、后入队**：
1. `SET idle:matchmaking:lock:{userId} 1 NX EX 600` —— 原子去重
2. 返回非 `'OK'` → 抛 `Error('已在匹配队列中')`（中文子串，控制器映射为 400 `Already in matchmaking queue`）
3. 返回 `'OK'` → `ZADD idle:matchmaking:queue { score: enqueuedAt, value: JSON.stringify({userId, enqueuedAt}) }`
4. 返回 `MatchQueueEntry { userId, enqueuedAt }`

反向顺序会破坏并发场景下的去重保证。

**取消匹配（`leaveMatchmaking`）—— 先离队、后释锁**（T042「lock first → zAdd」的天然反序）：
1. `ZRANGE idle:matchmaking:queue 0 -1` 扫描找到 userId 的 entry（拿到完整 JSON 串，`ZREM` 需要）
2. 未找到 → 抛 `Error('不在匹配队列中')`（中文子串，控制器映射为 400 `Not in matchmaking queue`）
3. `ZREM idle:matchmaking:queue {完整 JSON 串}`
4. `DEL idle:matchmaking:lock:{userId}`（幂等 —— 即使锁已过期，DEL 也只是返回 0）
5. 返回 `MatchQueueEntry { userId, enqueuedAt }`（被移除的 entry，便于审计）

**为什么 ZREM 先、DEL lock 后**：若反过来「先释锁、后离队」，崩溃窗口期内用户可以再次入队成功（锁已释放）→ zAdd 写入新 entry → 紧接着的 zRem 删的还是旧 entry，导致队列残留新 entry + 用户认为已取消 → bug。当前顺序的崩溃窗口仅造成「队列已清、锁残留 ≤600s」，自然过期自愈。

#### 公共 API

| 函数 | 行为 |
|------|------|
| `enqueueMatchmaking(userId)` | 加入队列，重复抛错 |
| `isPlayerInQueue(userId)` | 扫描 zRange 全队列，查 userId 是否存在 |
| `getMatchmakingStatus(userId)` | 扫描 zRange 找到 userId 后返回 `MatchQueueStatus { userId, enqueuedAt, waitingSeconds }`（含等待秒数，时钟回拨 clamp 至 0）；不在队列返回 `null` |
| `leaveMatchmaking(userId)` | 离开队列 + 释放锁；不在队列抛 `'不在匹配队列中'` |
| `getMatchmakingQueueStats()` | `{pendingPlayers, oldestEnqueuedAt, newestEnqueuedAt}` |
| `clearMatchmakingQueue()` | 删除队列 key（测试用；不清理各玩家 lock keys） |
| `tryMatch(triggerUserId)` | T044 撮合：抢全局锁 → Lua 找候选 → alive 校验 → 防 dup → INSERT battles → cleanup。返 `TryMatchResult` discriminated union（matched:true 返 battleId+opponentUserId；matched:false 返 rejectionReason） |
| `getUserPendingBattle(userId)` | T044 LOSER 兜底：根据 userId 查 pending battle（用于 GET /queue 与 DELETE 409） |

### 撮合核心 `tryMatch`（T044）

**为什么用 Lua 脚本**：`node-redis` v4.6.10 支持 `eval` 脚本；Lua 在 Redis 单线程内原子执行，避免「SETNX EX 5s 过期但事务还在跑」的竞态。

**两个 Lua 脚本**（定义在 `matchmakingService.ts` 文件顶部）：

1. **LUA_PICK_CANDIDATE**（5 步原子）：
   - 验证 token 是当前锁持有者（`GET lock_key` 与 token 比对）
   - 续期全局锁（`EXPIRE lock_key ttl`，避免长 DB 调用期间过期）
   - `ZRANGE queue_key 0 max_scan-1` 找候选（解析 JSON `cjson.decode` 拿 userId）
   - 排除 self（`if user_id ~= self_user`）
   - 原子认领：`ZREM queue_key entry_str`（先于 DB 查询，避免重复处理）
   - 返 `{1, picked_userId, picked_entry_str}` 或 `{0, 'NO_CANDIDATE'}` / `{0, 'NOT_HOLDER'}`

2. **LUA_RELEASE_CLEANUP**（撮合成功 / dup 路径，一把梭）：
   - 验证 token
   - 兜底 ZREM self + ZREM picked（即使 LUA_PICK_CANDIDATE 已 ZREM，幂等）
   - `DEL self_lock_key` + `DEL picked_lock_key` + `DEL global_lock_key`
   - 返 `{1}` 或 `{0, 'NOT_HOLDER'}`

**整体 `tryMatch(triggerUserId)` 流程**：
1. `SETNX idle:matchmaking:lock:global <uuid_token> EX 5` → 失败返 `lock_failed`
2. `EVAL LUA_PICK_CANDIDATE` → 返 NO_CANDIDATE 时释放全局锁返 `no_candidate`
3. Lua 返 picked → 拿 self entry_str（`ZRANGE 0 -1` 扫一次）
4. 双 alive 校验：`getPlayerIdByUserId × 2` + `countAliveCharacters × 2`（任一 <3 → cleanup + 返 `self_not_eligible` / `opponent_not_eligible`）
5. 防 dup 预查询：DB `SELECT id FROM battles WHERE (p1=A AND p2=B) OR (p1=B AND p2=A) AND status='pending' LIMIT 1` → 命中返已有 battleId
6. `createPendingBattle(p1=picked, p2=trigger)` → INSERT ON CONFLICT (player1_id, player2_id) WHERE status='pending' DO NOTHING RETURNING id
7. 被 unique index 拦截时 dup 兜底查询返已有 id
8. `EVAL LUA_RELEASE_CLEANUP` 清 queue + lockA + lockB + global
9. 返 `matched:true { battleId, opponentUserId }`

**p1/p2 决定**：FIFO，先入队者为 p1（对应 pickedUserId），后入队者为 p2（对应 triggerUserId）。`createPendingBattle` 内部明确 `player1_id=picked, player2_id=trigger`。

**双层防 dup（defense in depth）**：
- (a) Lua 原子 ZREM 候选（抢到候选后立即从队列移除）
- (b) PostgreSQL partial unique index `idx_battles_pending_unique_p1p2 ON battles(player1_id, player2_id) WHERE status='pending'`（migration 007 新增）

### battles 表 T044 新增字段（migration 007）

| 字段 | 类型 | 默认 | 用途 |
|------|------|------|------|
| `matched_at` | TIMESTAMP WITH TIME ZONE | NULL（migration 回填 = `created_at`） | 撮合成功时间（T044 写入） |
| `started_at` | TIMESTAMP WITH TIME ZONE | NULL | 双方首次进入战场时间（T048 写入） |

**T044 写入 battles 行的最小字段集**（其他依赖 schema DEFAULT）：
- `player1_id, player2_id, status='pending', matched_at=NOW()`
- 其余字段（`current_round=1, current_step=0, current_actor_id=NULL, current_phase='idle', battle_data='{}', created_at=NOW(), started_at=NULL, winner_id=NULL, duration=0`）由 schema DEFAULT 兜底

**T048 战场初始化时**会 UPDATE `status='ongoing'` + `current_actor_id=<first char>` + `started_at=NOW()`。

### 三个 Handler 改造（T044）

**POST `/api/match/queue`**：入队 → 同步撮合 → 响应结构
- 撮合成功：`201 { success:true, matched:true, data:{ battleId, opponentUserId, userId, enqueuedAt } }`
- self alive<3：`400 { error:'Not enough alive characters (need ≥3)' }`（self 已 cleanup）
- 其他撮合失败（lock_failed / no_candidate / opponent_not_eligible）：`201 { success:true, matched:false, data:{ userId, enqueuedAt } }`（self 仍在队列）
- 重复入队：`400 'Already in matchmaking queue'`

**GET `/api/match/queue`**：查询 → LOSER 兜底
- 在队列：`200 { data:{ inQueue:true, userId, enqueuedAt, waitingSeconds } }`
- 不在队列但有 pending battle（LOSER 视角）：`200 { data:{ inQueue:false, matched:true, battleId, matchedAt: <ms> } }`
- 真不在：`200 { data:{ inQueue:false, matched:false } }`

**DELETE `/api/match/queue`**：离开 → LOSER 409
- 在队列：`200 { status:'left', data: entry }`
- LOSER 想取消（不在队列但有 pending battle）：`409 { error:'already_matched', data:{ battleId } }` —— HTTP 409 Conflict 语义最准
- 真不在：`400 'Not in matchmaking queue'`

### 匹配 API 路由

**位置**：`src/routes/matchmaking.ts` + `src/controllers/matchmakingController.ts`

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/match/queue` | 入队 + 撮合；201 / 400 多种 / 401 |
| GET | `/api/match/queue` | 查询 + LOSER 兜底；200 三种结构 / 401 |
| DELETE | `/api/match/queue` | 取消 + LOSER 409；200 / 409 / 400 / 401 |

`app.use('/api/match', matchmakingRoutes)` 在 `src/index.ts` 中按字母序插入 gathering 与 skills 之间。

### T044 边界（明确不做）

| # | 不做的内容 | 归属任务 |
|---|-----------|---------|
| 1 | 撮合超时（撮合后 N 分钟未进入 T048 → 强制退出） | T044+ |
| 2 | 撮合后通过 WS 实时通知 LOSER | T045 |
| 3 | 撮合后任一方不响应 → 胜者自动胜利 | T046+ |
| 4 | 撮合失败告警 / 监控 | T044+ |
| 5 | O(1) EXISTS 优化（替代 zRange 全扫） | T044+ |
| 6 | 撮合失败递归找下一个候选 | T044+（MVP 简化：不合格直接 return） |
| 7 | 撮合锁被占时 client 退避重试 | T044+ |
| 8 | orphan lock 自愈 cron | T044+ |

服务文件顶部以中文注释完整列出此清单，防止后续误抢跑。

### 并发场景

| 场景 | 行为 |
|------|------|
| 两个 DELETE 同时到达 | 两者都 zRange 找到 entry。一个 zRem 返回 1，另一个返回 0。两者都 del lock（幂等）。两者都返回 200。语义上「都成功取消」，无副作用。 |
| GET 与 DELETE 同时到达 | GET 读到 entry，DELETE 删除 entry。若 GET 早于 DELETE 完成 → 显示「等待 X 秒」；晚于 → 显示 null。前端可接受。 |
| 两个 POST /queue 同时到达 | 第一个抢到全局锁 → 撮合 picked → 写 battles → release。第二个 SETNX 失败 → 返 `lock_failed` → matched:false（仍在队列）。第二个下一次自然尝试撮合时（GET /queue 触发客户端重试）会成功。 |
| 撮合进行中玩家被 DELETE | tryMatch 流程期间无并发保护（因为 SETNX NX 已经在排队端去重了，撮合中不该再有 DELETE）。若发生，tryMatch 走 LUA_RELEASE_CLEANUP 一并清掉。 |
| T044 撮合后 LOSER 想 DELETE | T044 控制器层在 DELETE 抛「不在匹配队列中」后做 LOSER 兜底查询，命中 pending battle 返 409 + battleId。 |

### 文件清单

| 路径 | 改动 |
|------|------|
| `src/services/matchmakingService.ts` | T042 新建 + T043 扩展 + T044 大改：新增 `tryMatch` / `getUserPendingBattle` / 3 个内部辅助（`safeReleaseGlobalLock` / `findAndGetSelfEntryStr` / `cleanupFailedCandidate` / `releaseCleanup`）+ 2 个 Lua 脚本（LUA_PICK_CANDIDATE / LUA_RELEASE_CLEANUP）+ `TryMatchResult` 类型 + 更新 OOS 清单 |
| `src/services/matchmakingService.test.ts` | T042 5 + T043 7 + T044 8 = **20 用例**（含「Lua token 验证失败抛错」「unique index 触发」边界） |
| `src/services/battleService.ts` | T044 末尾新增 `createPendingBattle` / `getPendingBattleByPlayerId` + `PendingBattle` 接口 |
| `src/services/characterService.ts` | T044 新增 `countAliveCharacters` |
| `src/controllers/matchmakingController.ts` | T042 joinMatchmakingHandler + T043 getMatchmakingStatusHandler / leaveMatchmakingHandler + T044 三 handler 改造（POST 同步撮合 + GET LOSER 兜底 + DELETE LOSER 409） |
| `src/routes/matchmaking.ts` | T042 POST /queue + T043 GET /queue + DELETE /queue |
| `src/routes/matchmaking.integration.test.ts` | T042 2 + T043 4 + T044 5 = **11 用例**（POST: 4 + GET: 3 + DELETE: 3，删 1 加 4） |
| `src/migrations/007_add_match_metadata.sql` | **新建**：battles 表加 `matched_at` / `started_at` + 历史回填 + 3 索引（p1/p2 partial + unique partial） |
| `src/index.ts` | T042 import + `app.use('/api/match', matchmakingRoutes)` 各 1 行 |

---

## WebSocket 通道 (T045)

为 T046+ 实时推送建立底层连接通道。**T045 仅做"能连上、能鉴权、能断开"**，不订阅房间、不广播事件。

### 整合方式

- 挂载到**同一 HTTP server**（`http.createServer(app).listen()` + `new IOServer(httpServer, { cors: { origin: '*' } })`）
- 共享端口 + CORS 配置
- CORS `origin: '*'`：MVP 开发期允许任意前端；生产期改为环境变量

### 鉴权

- **位置**：`socket.handshake.auth.token`（socket.io v4 推荐方式，替代 v3 的 `query.token`）
- **时机**：`io.use(verifyClientToken)` 握手期
- **失败**：`next(new Error('...'))` → 客户端收到 `connect_error` 事件 + `error.message` 含原因
- **秘钥**：复用 `middleware/auth.ts:27` 的 `process.env.JWT_SECRET || 'your_jwt_secret_change_in_production'`，保持两个入口（REST + WS）共用同一常量
- **成功**：`socket.data.userId` / `socket.data.username` 写入，handler 可直接读

### socket.data 约定

| 字段 | 写入时机 | 读取方 |
|------|----------|--------|
| `userId: string` | 握手鉴权通过 | 当前 `connection` / `disconnect` handler；T046 房间管理基于此推送 |
| `username: string` | 握手鉴权通过 | 日志 / 调试；T046 推 `opponent_joined` 时随 payload 发出 |
| `battleId?: string` | **T046 客户端发 `battle:join` 验证通过后** | disconnect handler 推 `opponent_disconnected` 时；T047+ 房间广播 |

### 房间命名（T046）

| Room 名 | 加入方式 | 用途 |
|---------|----------|------|
| `user:{userId}` | 连接握手成功后**自动** `socket.join` | 个人推送通道（撮合成功 push、对手断线通知）。支持同 user 多端连接（多 socket 共享 user-room） |
| `battle:{battleId}` | 客户端发 `battle:join { battleId }` 验证通过后加入 | 对战房间广播（对手状态、操作同步） |

### 事件协议（T046）

| 方向 | 事件 | Payload | 触发方 |
|------|------|---------|--------|
| server → client | `battle:matched` | `{ battleId, opponentUserId }` | 撮合成功（matchmakingController 调 `io.to(user:{userId}).emit`） |
| client → server | `battle:join` | `{ battleId }` | 客户端收到 matched 后想入场 |
| server → client | `battle:join:ok` | `{ battleId, opponentInRoom }` | join 验证通过 + 已加入 room；`opponentInRoom` 表示对手是否已在 room |
| server → client | `battle:join:error` | `{ battleId?, error }` | join 失败（payload 缺 battleId / 非参与者 / battle 不存在） |
| server → room | `battle:opponent_joined` | `{ userId, username }` | 任一方 join 后,推给房间内另一方 |
| server → room | `battle:opponent_disconnected` | `{ userId, timestamp }` | 任一方 disconnect 时(socket.data.battleId 存在),推给房间内其他 socket |

### T045 / T046 / T047 范围

| 项 | T045 | T046 | T047 |
|----|------|------|------|
| 握手期鉴权 | ✅ | — | — |
| `socket.data.userId/username` | ✅ | — | — |
| 自动 `socket.join('user:{userId}')` | ❌ | ✅ | — |
| `io.to(user:{userId}).emit('battle:matched')` | ❌ | ✅ | — |
| `socket.data.battleId` 写入 | ❌ | ✅ | — |
| `socket.join('battle:{battleId}')` + DB 鉴权 | ❌ | ✅ | — |
| `battle:opponent_joined/disconnected` 广播 | ❌ | ✅ | — |
| 棋盘状态 / 手牌 / 能量广播 | ❌ | ❌ | ✅ |
| 重连 / heartbeat / 速率限制 | ❌ | ❌ | ❌（运维层） |
| Redis adapter（跨节点） | ❌ | ❌ | ❌（单体 MVP） |

### 文件清单

| 路径 | 改动 |
|------|------|
| `src/index.ts` | T045 改造：`app.listen` → `http.createServer(app)` + `new IOServer(httpServer, { cors: { origin: '*' } })` + `httpServer.listen(PORT)` 内调 `initializeSocketServer(io)` |
| `src/socket/socketServer.ts` | **新建** + T046 扩展：`initializeSocketServer(io)` + 导出 `getIO()` 单例（matchmakingController 调）+ 自动 `socket.join('user:{userId}')` + `battle:join` handler + disconnect 时 battleId 检测推 `opponent_disconnected` |
| `src/socket/authMiddleware.ts` | **新建**：`verifyClientToken(socket, next)` —— 读 `socket.handshake.auth.token` → `jwt.verify` → 写 `socket.data.userId/username` |
| `src/socket/battleRoom.ts` | **新建**（T046）：`handleBattleJoin(io, socket, payload)` + `broadcastOpponentDisconnected(io, battleId, userId)` + `userRoom(userId)` / `battleRoom(battleId)` room 名构造器 + `parseUserRoom` / `parseBattleRoom` 反解器 |
| `src/socket/socketServer.test.ts` | **新建** + T046 扩展：10 个集成测（3 T045 + 7 T046） |
| `src/services/battleService.ts` | T046 末尾新增 `getPendingBattleForJoin(battleId, userId)` —— DB 验证 user 是 battle 参与者且 status='pending' |
| `src/controllers/matchmakingController.ts` | T046 改造：tryMatch 撮合成功路径后通过 `getIO().to(userRoom).emit('battle:matched', ...)` 推双方；emit 失败 try-catch 不阻塞 REST 响应 |
| `src/config/jwt.ts` | **新建**（T045 simplify pass）：集中导出 `JWT_SECRET` / `JWT_EXPIRES_IN`，消除 `process.env.JWT_SECRET || '...'` 重复 3 处 |
| `src/middleware/auth.ts` | 改 1 行：改用 `import { JWT_SECRET } from '../config/jwt'` |
| `src/middleware/auth.test.ts` | 改 1 行：改用 `JWT_SECRET` 常量 |
| `src/services/authService.ts` | 改 3 行：改用 `JWT_SECRET` / `JWT_EXPIRES_IN` 常量 |
| `backend/package.json` | devDep 新增 `socket.io-client@^4.7.2`（与 server 端 socket.io 4.7.x 同号） |

---

## 实时状态广播 (T047)

T047 把"对战进行中的棋盘 / 手牌 / 角色状态"接到 WS 通道上,作为 T049 移动 / T050 出牌 / T051 回合切换的承载层。**T047 本身只提供 broadcaster 函数库 + battle:join 初期推**,不与战斗 action API 联动(那些由后续任务 wire)。

### 事件协议

| 方向 | 事件 | Payload | 推送通道 | 触发方 |
|------|------|---------|----------|--------|
| server → client | `battle:state:full` | `{ battleId, board: BoardStateEvent, ownHand: Record<characterId, HandCard[]> }` | `user:{userId}` | `handleBattleJoin` 成功路径(本任务) |
| server → room | `battle:state:board` | `BoardStateEvent` | `battle:{battleId}` | T051 回合切换 / 整盘变化时调 `broadcastBoardState`(本任务 wire 函数,调用由后续任务) |
| server → client | `battle:state:hand` | `{ battleId, characterId, hand: HandCard[] }` | `user:{userId}` | T050 出牌后调 `broadcastHandState`(本任务 wire 函数) |
| server → room | `battle:state:character` | `{ battleId, character: CharacterStatus }` | `battle:{battleId}` | T049 移动 / T050 出牌后调 `broadcastCharacterStatus`(本任务 wire 函数) |

#### Payload 类型

```ts
interface BoardStateEvent {
  battleId: string;
  currentRound: number;
  currentStep: number;
  currentPhase: string;
  currentActorId: string | null;
  characters: CharacterStatus[];  // 复用 characterStatusService 的聚合
}

interface HandStateEvent { battleId: string; characterId: string; hand: HandCard[]; }
interface CharacterStatusEvent { battleId: string; character: CharacterStatus; }
interface FullStateEvent {
  battleId: string;
  board: BoardStateEvent;
  ownHand: Record<string, HandCard[]>;  // characterId → 手牌;3v3 时 3 个 key
}
```

### 隐私边界

| 事件 | 隐私 | 走哪 | 理由 |
|------|------|------|------|
| `battle:state:full` | 含 ownHand → self-only | `user:{userId}` | 手牌是隐私,不能 room-wide |
| `battle:state:hand` | self-only | `user:{userId}` | 单角色手牌仅本人可见 |
| `battle:state:board` | 双方都看 | `battle:{battleId}` | 棋盘 / 状态效果 / 能量均无隐私 |
| `battle:state:character` | 双方都看 | `battle:{battleId}` | 角色状态双方都需要(承伤 / 嘲讽目标判定) |

### 复用已有服务

| 函数 | 路径 | 用途 |
|------|------|------|
| `getCharacterStatus` | `services/characterStatusService.ts:46` | 角色状态聚合(health/effects/shield/taunt) |
| `getActorHand` | `services/handService.ts:269` | 单角色手牌读取 |
| `getDbSessionState` | `services/battleSessionService.ts:437` | battle 元数据(currentRound 等) |
| `userRoom` / `battleRoom` | `socket/battleRoom.ts:24-25` | 房间命名 |
| `listCharactersInBattle`(T047 新增) | `services/battleService.ts` | 单次 SQL JOIN 拿双边 character + userId,供 broadcaster 多次使用 |

### 设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 事件粒度 | 1 个 mega event (`full`) + 3 个 granular | `full` 走 join 后首屏,granular 走增量 |
| broadcaster 接口 | 只接 `io`,不接 `socket` | 跟 controller 层 `io.to(...).emit` 模式一致;不依赖具体 socket 实例 |
| `getCharacterStatus` 复用 | 复用,不另写聚合 | T039 已有完整聚合(health/effects/shield/taunt),T047 不重写 |
| 失败处理 | `try/catch` 内 `console.error`,不抛 | emit 失败不阻断 join 流程(battle:join:error 是用户错误,emit 失败是基础设施问题) |
| `listCharactersInBattle` 位置 | 放 `battleService.ts` | 单次 SQL 拿全角色 + userId,供 broadcaster 多次使用 |
| 多角色手牌 | `ownHand: Record<characterId, HandCard[]>` | 3v3 时每玩家 3 个角色,各有手牌;以 characterId 为 key |

### 失败语义(房间已加入 vs 首屏拉取失败)

- `broadcastFullState` 在 `handleBattleJoin` 成功路径后调,**用独立 `.catch`**(不进 socketServer.ts:55 的统一 try/catch)
- 理由:统一 try/catch 会发 `join:error`,但这里希望 join 仍算成功,只是首屏状态拉取失败 —— 前端可重试(reconnect 后重发 `battle:join` 即可触发)

### T047 范围外(留给后续)

- ✅ T049 移动后调 `broadcastBoardState`（移动改整盘位置，不用 character 单播）—— T049 已实现
- ❌ T050 出牌后调 `broadcastHandState` + `broadcastCharacterStatus` —— T050 实现时再 wire
- ❌ T051 回合切换调 `broadcastBoardState` —— T051 实现时再 wire
- ❌ 单独的 `battle:state:session` 事件(round/step/actor 变化)—— T051 设计
- ❌ 对手断线后的状态冻结 / 自动判胜 —— 业务层
- ❌ 跨节点 socket.io adapter(Redis adapter)—— 单体 MVP 不做
- ❌ 增量差分(只推变化字段)—— T047 直接推全量,前端用 shallow equal 即可
- ❌ 手牌张数提示("对手剩 3 张")—— 隐私设计禁止

### 文件清单(T047)

| 路径 | 改动 |
|------|------|
| `src/socket/battleStateBroadcaster.ts` | **新建** —— broadcaster 函数库 + 5 个导出(buildBoardState / broadcastBoardState / broadcastHandState / broadcastCharacterStatus / broadcastFullState)+ 4 个事件类型 |
| `src/socket/battleStateBroadcaster.test.ts` | **新建** —— 7 个单元测(各函数 happy path / 边界 / 异常) |
| `src/services/battleService.ts` | 末尾新增 `listCharactersInBattle(battleId)` —— 单次 SQL JOIN 拿双边 character + userId |
| `src/socket/battleRoom.ts` | `handleBattleJoin` 成功路径后插入 `broadcastFullState(io, battleId, userId)` 调用(独立 `.catch`) |
| `src/socket/socketServer.test.ts` | 顶部 mock 补全(`listCharactersInBattle` / `getDbSessionState` / `getCharacterStatus` / `getActorHand`)+ 新增 3 个 T047 集成测(后加入者收 full + ownHand 隔离 / 同一 socket 收 join:ok + full / broadcaster 异常时仍 join:ok 不发 join:error) |

---

*文档版本：v1.30*
*最后更新：2026-06-11*

---

*文档版本：v1.31*
*最后更新：2026-06-11*

---
*文档版本：v1.32*

---

## T048 战场初始化 (Battle Initialization)

### 触发时机
双方都 `battle:join` 成功后自动触发，由 `tryInitBattleField` 在 SETNX 锁内执行。

### 模块
| 文件 | 角色 |
|------|------|
| `src/services/battleInitializationService.ts` | `initBattleField` 7 步流水 + `cleanupPartialInit` 阶梯清理 |
| `src/socket/battleRoom.ts` | `tryInitBattleField` 锁 + 双 join 检测 |
| `src/migrations/008_t048_battle_init.sql` | `characters.battle_id` + `deck_position` + 索引 |

### 7 步流水
1. `initializeBoard` — 9×9 空棋盘
2. `placeCharacter × 6` — 双方各 3 个棋子到默认位置（P1 `(6,0)(7,0)(8,0)`, P2 `(0,8)(1,8)(2,8)`）
3. `setCharacterEnergy × 6` — 满能量 3
4. `drawCards × 6` — 各抽 3 张初始手牌
5. `initializeSession` — 蛇形 ABABAB 顺序 + phase=idle
6. `UPDATE battles SET status='ongoing'` — pending → ongoing
7. `broadcastFullState × 2` — 双方各一份（ownHand 隔离）

### 失败处理
- 步骤 1-6 失败 → `cleanupPartialInit(lastStep)` 阶梯反向 DEL + 回滚 battles.status='pending'
- 步骤 7 失败 → **不回滚**（PG 已固化），console.error，依赖客户端重 join 触发重 broadcast
- `cleanupPartialInit` 自身失败 → 吞错 console.error（best-effort）

### 并发保护
- Redis `SETNX battle:{id}:init_lock EX 30`
- SETNX 输者 sleep 100ms + 读 status 决定 broadcast / wait
- `battles.status='pending'` 二次检查保证幂等

### 棋子选取策略
按 `characters.created_at ASC LIMIT 3` 取每方前 3 个 alive 棋子（每个玩家独立）。T008 注册时已建 1 warrior + 1 ranger + 1 mage → 默认平衡。后续 T048.5 可扩展「玩家手动选 3 个棋子」。

### 数据库改动 (Migration 008)
- `characters.battle_id UUID` — 软绑定，NULL 表示未入战
- `characters.deck_position INTEGER` — 3v3 位序（预留未来）
- `idx_characters_battle_id` + `idx_battles_started_at` — 查询加速

### 设计决策
| 决策 | 选择 | 理由 |
|------|------|------|
| 棋子默认位置 | 硬编码 P1 右下角 / P2 左上角 | T048 仅做自动初始化，预留 T048.5 让玩家自选 |
| 错误传播 | `initBattleField` 失败时 catch 调 cleanupPartialInit 并返回 failure result | 调用方 handleBattleJoin 不感知内部步骤失败 |
| 调用方保护 | handleBattleJoin 用 try/catch 包 tryInitBattleField | 即使 init 抛错也不发 join:error 给前端（房间已加入） |
| mock 模式 | socketServer 集成测试顶部 mock queryOne + battleInitializationService | 集成测试不走真实 PG/Redis |

### 文件清单(T048)
| 路径 | 改动 |
|------|------|
| `src/migrations/008_t048_battle_init.sql` | **新建** — `characters.battle_id` + `deck_position` + 2 索引（带 IF NOT EXISTS 幂等保护） |
| `src/services/battleInitializationService.ts` | **新建** — `initBattleField` 7 步 orchestrator + `loadBattleCharacters` JOIN 查询 + `cleanupPartialInit` 阶梯清理 |
| `src/services/battleInitializationService.test.ts` | **新建** — 11 单测（1 happy + 2 insufficient chars + 6 cleanup ladder + 2 failure paths） |
| `src/services/battleService.ts` | 末尾新增 `setCharacterEnergy(battleId, characterId, energy)` — read-modify-write 复用 pieces HASH |
| `src/services/battleService.test.ts` | 末尾新增 3 个 setCharacterEnergy 单测 |
| `src/socket/battleRoom.ts` | 新增 `tryInitBattleField` + `isOtherPlayerInRoom` + `getBattleStatus`；handleBattleJoin 末尾 wire 调用（带独立 try/catch 保护） |
| `src/socket/battleRoom.test.ts` | **新建** — 5 单测（first join no init / second join init / status=ongoing 跳过 / init throw 仍 release lock / SETNX 失败 100ms 重查） |
| `src/socket/battleRoom.integration.test.ts` | **新建** — 骨架（占位 test，详细端到端验证由开发者手动跑） |
| `src/socket/socketServer.test.ts` | 顶部 mock 补全 `../config/database` (queryOne 返回 `{status:'pending'}`) + `../services/battleInitializationService` |

---

*文档版本：v1.33*
*最后更新：2026-06-15*
*最后更新：2026-06-11*

---

## T049 移动操作同步 (Movement Sync)

### 范围
玩家发 `battle:move` 事件 → 服务端 6 步验证合法性 → 执行棋子移动 → 广播棋盘状态 → 自动推进 phase `move` → `play`。

### 模块

| 文件 | 角色 |
|------|------|
| `src/services/battleActionService.ts` | **新建** —— `executeMove(io, battleId, characterId, toX, toY, userId)` 6 步验证 + 2 步副作用；`MoveError` 联合类型 |
| `src/socket/battleRoom.ts` | `handleBattleMove` handler —— payload 结构验证 + 转发 `executeMove` + emit `battle:move:error` |
| `src/socket/socketServer.ts` | 注册 `socket.on('battle:move', ...)` |

### `executeMove` 签名

```typescript
executeMove(
  io: IOServer,
  battleId: string,
  characterId: string,
  toX: number,
  toY: number,
  userId: string
): Promise<MoveResult>
```

`MoveResult` 为 `{ success: true }` 或 `{ success: false, error: MoveError }`。

### `MoveError` 联合类型
`not_in_move_phase` | `not_current_actor` | `not_owner` | `invalid_path` | `move_failed`

### WS 事件

| 方向 | 事件 | Payload | 触发 |
|------|------|---------|------|
| client → server | `battle:move` | `{ battleId, characterId, toX, toY }` | 玩家发起移动 |
| server → client | `battle:move:error` | `{ error: 'invalid_payload' \| MoveError \| 'internal_error' }` | 失败回执（仅失败时） |
| server → room | `battle:state:board` | `BoardStateEvent`（T047 已定义） | 成功后 broadcaster 自动推 |

成功路径无回执，依赖 `broadcastBoardState` room-wide 推送。

### 6 步验证流水（`executeMove` 内部）

1. `getDbSessionState(battleId)` — null 抛 `Error`（异常路径，由 socketServer `.catch` 转为 `internal_error`）
2. `session.currentPhase !== 'move'` → `not_in_move_phase`
3. `session.currentActorId !== characterId` → `not_current_actor`
4. `character.userId !== userId` → `not_owner`（防同房间对手冒充）
5. `validateMovement(...)` 返回 `!valid` → `invalid_path`
6. `getCharacterPosition(...)` 为 null **或** `moveCharacter(...)` 返回 false → `move_failed`（含并发占用防御）

### 成功副作用（按顺序执行）

1. `broadcastBoardState(io, battleId)` —— 客户端先看到新棋盘
2. `completeMovePhase(battleId)` —— session 切到 `play` 阶段

> 顺序在测试中显式断言：先 broadcast，再 phase 推进。

### 架构决策

| 决策 | 选择 | 理由 |
|------|------|------|
| Broadcaster 选择 | 仅 `broadcastBoardState`（不调 `broadcastCharacterStatus`） | 移动改整盘位置，全量 board 推送；character 单播冗余 |
| Phase 推进责任 | T049 在 `executeMove` 内部调 `completeMovePhase` | 防「move 阶段可重复走棋」race；handler 不持有 phase 知识 |
| Session 广播 | T049 不调 session 推送 | session 推送是 T051 范围，解耦 |
| executeMove 签名 | 6 参数（spec 原 5 参数 + `io`） | `broadcastBoardState` 必传 `io`，handler 从 socket 拿 |
| 错误广播范围 | `battle:move:error` 仅发给当前 socket | 错误是用户行为结果，无须 room-wide |
| Handler 薄壳 | `handleBattleMove` 只做 payload 结构验证 + emit 错误 | 业务逻辑全部下沉到 `executeMove` |

### `handleBattleMove` 责任

1. payload 结构验证：`battleId`/`characterId` 是 string，`toX`/`toY` 是有限 number
2. 失败 → emit `battle:move:error` `{ error: 'invalid_payload' }`
3. 调 `executeMove(...)` → 业务失败转发对应 `MoveError`
4. 成功 → 不 emit（依赖 broadcaster room-wide 推送）

### 文件清单 (T049)

| 路径 | 改动 |
|------|------|
| `src/services/battleActionService.ts` | **新建** —— `executeMove` 6 步验证 + 2 步副作用 + `MoveError` 类型 |
| `src/services/battleActionService.test.ts` | **新建** —— 8 单测（2 happy + 6 error branches） |
| `src/socket/battleRoom.ts` | 新增 `handleBattleMove` handler（47 行），导出供 socketServer wire |
| `src/socket/battleRoom.test.ts` | 末尾追加 7 个 `handleBattleMove` 单测（happy / 4 invalid_payload / 2 business error） |
| `src/socket/socketServer.ts` | 注册 `socket.on('battle:move', handleBattleMove)` |
| `src/socket/socketServer.test.ts` | 顶部 `jest.mock` 补全 `../services/battleActionService`（无新增测，复用 T047 集成测试） |

---

---

## T050 打牌操作同步

### 概述
T050 扩展既有 `battleActionService` 新增 `executePlayCard` 17 步流水；`battleRoom.ts` 追加 `handleBattlePlayCard` handler；`socketServer.ts` 注册 `battle:play_card` 事件。

### 业务规则
1. session.current_phase === 'play'
2. session.current_actor_id === characterId
3. character.userId === userId（防同房间对手冒充）
4. handCard.deck_id 在 actor hand LIST 中
5. card.type 是 'attack'（AOE/单体）或 'tactical'+'taunt'，其他 → `unsupported_card_type`
6. validate* 返回 valid

### 副作用顺序（成功时）
1. 读 pieces HASH → currentEnergy
2. setCharacterEnergy(attackerId, currentEnergy - energyCost)
3. redisClient.lRem(hand LIST, 1, JSON.stringify(handCard))
4. addToDiscardPile (if source='deck'，公共池卡不入弃牌堆)
5. broadcastHandState(io, battleId, userId, characterId)  // self
6. broadcastCharacterStatus(io, battleId, characterId)  // both
7. completePlayPhase(battleId)  // play → end_step
8. broadcastBoardState(io, battleId)  // both, 含 phase

### 错误码（8 个）
- `not_in_play_phase` / `not_current_actor` / `not_owner`
- `card_not_in_hand` / `unsupported_card_type`
- `validation_failed`（带 detail = validate.error）
- `energy_deduct_failed` / `side_effect_failed`

### 不做（明确范围外）
- 实际扣 HP —— T056 applyDamage 负责
- burn 伤害结算 —— T051 orchestrator
- defense 卡 —— T050.5
- player_cards 消耗 —— T053
- 回合切换 —— T051
- 胜负判定 —— T052

### 文件清单
- `src/services/battleActionService.ts` — 追加 executePlayCard + 8 个 error 类型
- `src/services/battleActionService.test.ts` — 追加 18 个单测
- `src/socket/battleRoom.ts` — 追加 handleBattlePlayCard + validatePlayCardPayload
- `src/socket/battleRoom.test.ts` — 追加 5 个 handler 测试
- `src/socket/socketServer.ts` — 注册 battle:play_card 事件

### WS 事件
- `battle:play_card` (client → server): `{ battleId, characterId, handCard: HandCard }`
- `battle:play_card:error` (server → client): `{ error, detail? }`
- 复用 T047 既有 `battle:state:hand` / `battle:state:character` / `battle:state:board`

---

## T051 回合切换 (Turn Switching)

T051 实现回合切换 orchestrator, 在 T050 出牌后自动级联, 客户端也可主动 `battle:skip_play` 触发. 两个独立 orchestrator: `executeEndStep` (11 步主流水) + `executeRoundEnd` (5 步子流水, 仅 last step 触发).

### 1. 触发流程

```
  T050 executePlayCard                       客户端 battle:skip_play
   (T049 executeMove 也可对称)                  (out of scope T051)
       │                                              │
       ▼                                              ▼
   completePlayPhase                       handleBattleSkipPlay(io, socket, payload)
       │                                              │
       └────────────┬─────────────────────────────────┘
                    ▼
            executeEndStep(io, battleId)
              (11 步)
              ├─ 步骤 1-2: 读 session + phase 校验 (play OR move)
              ├─ 步骤 3: retainHandOnStepEnd (保留 1 张手牌)
              ├─ 步骤 4: if (currentStep === 5) → executeRoundEnd
              ├─ 步骤 5: endCurrentStep
              ├─ 步骤 6: activateCurrentUnit (snake draft 下一 actor)
              ├─ 步骤 7: drawCards (新 actor 抽牌)
              ├─ 步骤 8: completeDrawPhase
              └─ 步骤 9-11: 重读 session + broadcastSessionState + broadcastBoardState

            executeRoundEnd (条件, last step 触发)
              (5 步)
              ├─ 步骤 1: tickBurnDamageOnTarget × 6 角色 (Promise.all)
              ├─ 步骤 2: tickEffects × 6 角色 (顺序, 改 state)
              ├─ 步骤 3: endCurrentRound
              └─ 步骤 4-5: 重读 session + broadcastSessionState + broadcastBoardState
```

### 2. 模块改动

| 模块 | 改动 |
|------|------|
| `src/services/professionMechanicService.ts` | **新增** `tickBurnDamageOnTarget(battleId, targetId, currentRound)` — 算 burn 伤害 + 扣 HP + 标记 is_alive=false (15 行 helper) |
| `src/services/battleActionService.ts` | **新增** `executeEndStep` (11 步) + `executeRoundEnd` (5 步) + `StepEndError` / `StepEndResult` 类型. T050 `executePlayCard` 末尾追加 `await executeEndStep(io, battleId)` (T050 spec §4.5) |
| `src/socket/battleStateBroadcaster.ts` | **新增** `broadcastSessionState(io, battleId, state)` — emit `battle:state:session` 到 `battle:{battleId}` room, payload 含 4 字段 (currentRound/currentStep/currentActorId/currentPhase) |
| `src/socket/battleRoom.ts` | **新增** `handleBattleSkipPlay(io, socket, payload)` — payload 验证 + 调 executeEndStep + 失败 emit `battle:skip_play:error` |
| `src/socket/socketServer.ts` | **注册** `socket.on('battle:skip_play', ...)` 事件 |

### 3. 关键设计决策

1. **服务端级联**: T050 出牌后服务端自动调 `executeEndStep`, 客户端无需手动发 `battle:skip_play`. 客户端 skip 是 PUA 用户的快捷方式, 业务逻辑相同路径.
2. **两个独立 orchestrator**: 镜像 T049/T050 模式 (executeMove + executeEndStep 分离), 单一职责, executeRoundEnd 可独立测试.
3. **burn 伤害结算**: `applyBurnDamage` 只算伤害不算 HP, T051 新增 `tickBurnDamageOnTarget` 局部完成 HP apply. T056 整合时由 T056 的统一 `applyDamage` 接管.
4. **独立 session 事件**: `battle:state:session` 独立于 `battle:state:board` (元数据变化频率高, 不应塞进 board payload). T047 broadcaster 库已预留此事件名.
5. **last step 双广播 by design**: last step 时 `executeRoundEnd` 推 1 次 session+board, `executeEndStep` 末尾再推 1 次 (round-end 元数据 vs step-end 元数据语义不同). 前端在同 tick 收到 2 次推送无视觉差.
6. **retainHandOnStepEnd 第 3 参**: T051 决定自动取 `hand[0]?.deck_id ?? null` (第一张手牌, 空手牌传 null), handler 不需客户端传保留牌 ID, 简化 client.
7. **错误传播**: 失败 → emit `battle:skip_play:error` 带 error + detail. 抛错 → 沿用 socketServer 兜底 (log + emit `internal_error`).

### 3.4 对战互动：退出对战（认输）+ 请求平局（2026-08-18）

**新服务** `src/services/battleInteractionService.ts`（result/ApiError 风格）：

| 函数 | 行为 | 校验 |
|------|------|------|
| `surrenderBattle(io, battleId, userId)` | 退出方判负、对方胜利，`recordVictory(..., 'surrender')` | participant + status ∈ {pending, ongoing}（pending 兼作卡死对局逃生门） |
| `requestDraw(io, battleId, userId)` | SET `battle:{id}:draw_request`=请求方 + 房间广播 `battle:draw_requested {fromUserId}` | participant + status=ongoing |
| `respondDraw(io, battleId, userId, accept)` | accept -> `recordVictory` 平局；reject -> DEL key + 仅向请求方 `user:{userId}` 房间单播 `battle:draw_declined` | participant + ongoing + 存在请求 + responder ≠ 请求方 |

- **victory_type**：新增 `'surrender'`（migration 011 扩 CHECK 约束）；求和接受用既有 `'draw'`。`recordVictory` 的 source 参数类型扩为 `VictorySource = 'kill' | 'base' | 'surrender' | 'draw'`，并在终局时 best-effort DEL draw_request key（唯一漏斗）。
- **WS 事件**：client->server `battle:surrender` / `battle:draw_request` / `battle:draw_response {accept}`；server->client `battle:draw_requested`（房间广播，客户端按 fromUserId 忽略自己）/ `battle:draw_declined`（请求方单播）/ 三个 `battle:X:error`。认输 handler 手动组合 checkRoomMembership + checkRateLimit（validateOperationContext 的 status 校验仅允许 ongoing）。
- **结算链路不变**：battle:end -> 前端 POST /api/battle/result（T054 settleBattle 幂等入账）。
- **前端**：game store `pendingDrawRequest`/`drawRequestSent` + 三个 emit 封装；BattleView 实战中显示 [请求平局]/[退出对战]，两个自制 modal（退出二次确认 / 对方求和接受拒绝）。

### 3.5 T-FIX 战棋死锁修复（2026-08-18，用户实测发现）

**现象**：真实对战卡在「第1回合 步骤0 待机」（currentPhase='idle'），双方均无法行动。

**根因**：`activateCurrentUnit`（唯一 idle->draw 推进点）只被 `executeEndStep` 步骤 6.5 调用，而后者入口要求 phase ∈ {move, play}。两个死锁点：
1. `initBattleField` 初始化后 phase 停在 idle，无人推进（战斗开始死锁）；
2. `executeRoundEnd` 的 `endCurrentRound` 把 phase 重置为 idle 后 `executeEndStep` 提前 return（每回合切换死锁）。

此前 e2e 只验证 matched->join->state:full 广播链路（当时 state:full 就显示 phase=idle/actor 未激活，未被识别为问题），从未走完真实回合。

**修复**：`battleActionService.ts` 新增 `activateActorForStep(io, battleId, {draw})` helper（activateCurrentUnit -> 可选 drawCards -> completeDrawPhase -> broadcastSessionState + broadcastBoardState）：
- `initBattleField` 步骤 6.5（battles 行 ongoing 之后、首屏 broadcastFullState 之前）调 `activateActorForStep(io, battleId)`——**不抽牌**，初始手牌已由 init 步骤 4 发放（drawCards 是覆盖式写，重复抽会顶掉）；
- `executeRoundEnd` 步骤 7（applyBaseStars + checkWinCondition + recordVictory 之后）**仅当无胜负**时调 `activateActorForStep(io, battleId, {draw: true})`——跨回合给新回合首 actor 发手牌。

回归测试 4 个：init 后激活且在首屏广播之前 / battles 行未更新不激活 / last-step 无胜负激活+抽牌 / 有胜负不激活。

### 4. T056 集成要点

- **T056 整合时**: T051 是 T056 `applyDamage` 之外的新 HP 操作点 (round-end tick burn 扣 HP). 整合时需要审计 executeRoundEnd 步骤 1 调 `tickBurnDamageOnTarget` 的位置, 由 T056 统一 `applyDamage` 替换.
- **T051.5 范围 (T049 executeMove wire-up)**: T049 末尾也需追加 `await executeEndStep(io, battleId)`. T051.5 决定 move 阶段后是否级联.
- **Step 超时 AFK (T051+)**: 客户端未在 N 秒内行动, 服务端自动 `executeEndStep` + 切换 actor. 当前 T051 未实现, 等真实对战测试后再加.

### WS 事件
- `battle:skip_play` (client → server): `{ battleId }`
- `battle:skip_play:error` (server → client): `{ error, detail? }`
- **新增** `battle:state:session` (server → room): `{ battleId, currentRound, currentStep, currentActorId, currentPhase }` — 推 `battle:{battleId}` (双方共有)
- 复用 T047 既有 `battle:state:board`

### 测试
- `src/services/professionMechanicService.test.ts` — 4 个 tickBurnDamageOnTarget 单测
- `src/services/battleActionService.test.ts` — 10 个 executeEndStep 单测 (3 mid-round + 3 last-step + 4 error branches) + 既有 T049/T050 测试
- `src/socket/battleStateBroadcaster.test.ts` — 1 个 broadcastSessionState 单测
- `src/socket/battleRoom.test.ts` — 6 个 handleBattleSkipPlay 单测

---

# T052 胜负判定

## 胜利规则
- 击杀累计（每步）+ 据点占领累计（每轮）两条独立路径
- 任一方累计 ≥6 star 即获胜（双方同时 6 视为平局）
- 胜利类型: kill_threshold / base_threshold / draw

## 数据模型
- Redis 临时态: `battle:{id}:stars:p1/p2` (STRING), `battle:{id}:bases` (JSON), `battle:{id}:alive_p1/p2` (STRING)
- DB 持久化: battles 表加 p1_stars, p2_stars, winner_player_id, victory_type (migration 009)

## 据点配置
- 固定坐标: (2,2) + (6,6) -- 关于中心 (4,4) 对称
- 占领范围: Chebyshev 距离 ≤2 (5x5 区域)
- 判定规则: 范围内 alive 棋子数 p1 > p2 → 占领

## 模块设计
- `src/services/battleOutcomeService.ts` 新建 (~250 行)
  - `applyKillStars`: preStepAliveMap 快照 + HGetAll 比对 + 累加
  - `applyBaseStars`: 扫描 2 据点 + Chebyshev 判定 + 累加
  - `checkWinCondition`: 读 stars:p1/p2 + 判定 win/draw/not_over
  - `recordVictory`: DB UPDATE + finishSession + broadcast
- `src/socket/battleStateBroadcaster.ts` 加 `broadcastBasesState` + `broadcastBattleEnd` + BoardStateEvent 加 p1Stars/p2Stars/bases

## 触发流程
- T051 executeEndStep 步骤 0: 读 preStepAliveMap 快照
- T051 executeEndStep 步骤 12: applyKillStars + checkWinCondition + recordVictory (win/draw, source='kill')
- T051 executeRoundEnd 步骤 6: applyBaseStars + checkWinCondition + recordVictory (win/draw, source='base')
- `src/services/battleInitializationService.ts` 步骤 5.5 初始化 5 个 SET 键 (step 5+ 失败时一同 DEL)

## WS 事件
- 新增 `battle:state:bases` (server → both): 推据点占领变化
- 新增 `battle:end` (server → both): 推战斗结束 (win/draw + winner + victoryType + p1/p2 stars)
- 增量字段: `battle:state:board` 加 p1Stars / p2Stars / bases (前端无需订阅额外事件)

## T056 整合
- applyDamage 统一入口应包含「击杀 → applyKillStars 触发」链路
- 真实 HP 扣减在 T056 实现后, 本任务的 preStepAliveMap 比对继续生效

## 测试
- `src/services/battleOutcomeService.test.ts`: 21 cases (5 constants + 5 applyKillStars + 5 applyBaseStars + 4 checkWinCondition + 4 recordVictory, 含 finishSession 失败 best-effort 路径)
- `src/services/battleActionService.test.ts`: +5 cases (T052 wire-up, 2 executeEndStep + 3 executeRoundEnd)
- `src/services/battleInitializationService.test.ts`: 11 cases 全部沿用, 无需新增 (5 SET 是 5+ 失败回滚的子集)
- `src/socket/battleStateBroadcaster.test.ts`: 14 cases (7 T047 + 1 broadcastSessionState + 2 buildBoardState T052 字段 + 2 broadcastBasesState + 2 broadcastBattleEnd)

---

## T053 卡牌消耗

T053 补全 T050 流水线的「库存落地」环节：每打一张 `source='deck'` 的手牌，立即在 DB 中删除对应的 `character_deck` 行 + `player_cards` 行（同一事务内）。`source='public_pool'` 卡不入 `player_cards`，跳过删除。失败采用 best-effort 策略：catch + `console.error` + 不影响后续广播 / 阶段推进。

### 1. 触发流程

T050 executePlayCard 17 步流水线（T053 改造后）
  步骤 1-8:  session 读 / phase 校验 / actor 校验 / owner 校验 / hand 归属 / dispatch validate / 扣能量 / lRem 手牌
  步骤 9:    addToDiscardPile (if source='deck')
  步骤 9.5:  ★ T053 NEW: consumePlayerCard(handCard, characterId)  ← best-effort, 内部事务
  步骤 10-17: 广播 / 阶段推进 / T051 executeEndStep 级联

### 2. 新增基础设施

`backend/src/config/database.ts` 新增 `withTransaction<T>(fn)` helper：
- `pool.connect()` 拿单 client，fn 内部所有 SQL 走同一连接
- fn 成功 → COMMIT
- fn 抛错 → ROLLBACK + 重新抛错
- ROLLBACK 自身抛错 → 内部吞掉，避免 release 失败
- 任何情况下 `client.release()` 都被调用

T054 / T056 后续可复用此 helper（battle result API、applyDamage 整合等）。

### 3. 关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 触发时机 | 实时（executePlayCard 步骤 9.5） | 玩家期望「打牌 → 库存 -1」原子；与 T050 既有控制流解耦 |
| 删除范围 | `character_deck` + `player_cards` 双删 | spec 「卡牌为消耗品」语义；FK CASCADE 虽能自动删 character_deck，但显式双删可控可测 |
| 失败处理 | best-effort + console.error + 不返错 | 上游（lRem / 能量扣 / 广播）已成功，回滚代价大 |
| 事务策略 | `withTransaction` 单事务 | 避免「character_deck 删了 player_cards 没删」的中间态（野牌） |
| 公共池卡 | 提前 return 跳过 | 不在 player_cards，无 DELETE 必要 |
| ID 映射 | card_id → player_cards.id，deck_id → character_deck.id | PK 查询，O(1) |
| 部分删除 | throw PartialDeleteError sentinel | withTransaction 统一管 COMMIT/ROLLBACK 边界，fn 不越权 |
| 不复用 removeCardFromCharacter | 新写 `consumePlayerCard` | removeCardFromCharacter 是手动 API（无事务、单条 DELETE、抛错失败），与 T053 best-effort 实时事务语义不同 |

### 4. 文件清单

- `src/config/database.ts` — 新增 `withTransaction<T>(fn)` helper
- `src/config/database.test.ts` — 4 个新测试 (commit/rollback/异常隔离/调用顺序)
- `src/services/battleActionService.ts` — 新增 `consumePlayerCard` 内部函数 + executePlayCard 步骤 9.5 插入
- `src/services/battleActionService.test.ts` — 5 个新测试 + 顶部 mock 补 `withTransaction`

**无新增 migration / 无新增 Redis 键 / 无新增 WS 事件 / 无新增 T050 error 变体**。

### 5. 范围外（明确不做）

- ❌ 批量结算模式（对战结束统一删）
- ❌ 「used」标记 + 后台清理
- ❌ 退款 / 撤销
- ❌ 失败时回滚 Redis 手牌 / 能量 / 广播
- ❌ 失败时返回 error 变体
- ❌ 5v5 / NvN 模式
- ❌ 卡牌消耗统计 / 监控埋点

---

## T054 对战结算 API

T054 补完一场 PvP 对战的「终局闭环」：T049-T052 让对战能跑到 `battles.status='finished'` + `winner_player_id` + `victory_type`，T053 把卡牌消耗接上，但**玩家战绩（wins/losses/draws）+ 对战历史从未被持久化，Redis 临时态（~30 个 key）也无人清理**。T054 加 `POST /api/battle/result`，任一方玩家触发即可，服务端原子地完成「写双方战绩 + 写对战历史 + 标 settled + 清 Redis」。

### 1. 端点规范

**POST /api/battle/result**

- Auth：JWT 必需（沿用 `authMiddleware`）
- Request body：`{ battleId: string }`
- 成功响应 200：`{ success: true, data: SettlementResponse }`
  - 含 `yourResult`（从调用者视角推 win/loss/draw）、`winner`、`victoryType`、`p1Stars/p2Stars`、`duration`（matched_at→finished_at 秒数）、`yourStats/opponentStats`
- 错误码：`401 / 400 / 403 / 404 / 409`
  - `400` 缺 battleId 或类型错
  - `403` 调用者非 player1/player2
  - `404` battle 不存在
  - `409` battle 状态非 finished（pending/ongoing 都算「还没判完」）

### 2. 流水线（settleBattle 8 步）

1. `loadBattleForSettlement` — 单次 JOIN 拿 `status/matched_at/finished_at/settled_at/p1_stars/p2_stars/winner_player_id/victory_type/player1_id/player2_id/p1_user_id/p2_user_id`
2. 鉴权 — 调用者必须是 p1UserId 或 p2UserId
3. 状态校验 — `status === 'finished'`
4. 幂等检测 — `settledAt !== null` → 跳过 5
5. `withTransaction` 内：
   - 4a: `UPDATE players SET wins/losses/draws += 1` × 2
   - 4b: `INSERT INTO player_battle_history` × 2
   - 4c: `UPDATE battles SET settled_at = NOW()`
6. 并行 `loadPlayerStats(yourPlayerId)` + `loadPlayerStats(opponentPlayerId)` + `cleanupAllBattleRedisKeys`
7. 构造 SettlementResponse

### 3. 关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 触发方式 | 任一方玩家 POST | 不需要双方都调；接收 `battle:end` WS 事件后任一方触发即可 |
| 玩家数据范围 | `players.wins/losses/draws` + `player_battle_history` | MVP 范围；资源发放/Rating/段位留后续 |
| 幂等策略 | `battles.settled_at` 非空 → 跳过写入 | DB 自带；第二次调用返相同数据；不依赖 Redis 状态 |
| Redis 清理 | `keys('battle:{id}:*')` + `del(...)` | 一次性删全部 ~30 key；MVP 不上 SCAN（O(N) 可接受） |
| Redis 失败处理 | best-effort + `console.error` + 不影响响应 | 玩家数据已落库；key 野掉下次自然清 |
| 事务策略 | T053 `withTransaction` 复用 | 单 client 一致性；4a/4b/4c 全部回滚 |
| controller 错误穷举 | switch + `default: never` | 新增 error variant 编译失败，杜绝静默漏分支 |
| stats 查询 | 事务外 `loadPlayerStats × 2` 并行 | 事务已 commit，外部读最新 + 与 Redis 清理并发 |
| 对战历史表约束 | `UNIQUE(player_id, battle_id)` + `CHECK(victory_type)` | 防御性：手动 SQL / 未来 bug 都不能写双行 |

### 4. Migration 010

`backend/src/migrations/010_t054_settlement.sql`：

```sql
-- players 加胜场/败场/平局三计数
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS wins INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS losses INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS draws INTEGER NOT NULL DEFAULT 0;

-- battles 加 settled_at 标记（T054 写入,幂等检测键）
ALTER TABLE battles
  ADD COLUMN IF NOT EXISTS settled_at TIMESTAMP WITH TIME ZONE;

-- 对战历史表
CREATE TABLE IF NOT EXISTS player_battle_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  battle_id UUID NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
  result VARCHAR(10) NOT NULL CHECK (result IN ('win', 'loss', 'draw')),
  opponent_player_id UUID REFERENCES players(id),
  victory_type VARCHAR(20) NOT NULL CHECK (victory_type IN ('kill_threshold', 'base_threshold', 'draw')),
  my_stars INTEGER NOT NULL,
  opponent_stars INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_pbh_player_battle UNIQUE (player_id, battle_id)
);

CREATE INDEX IF NOT EXISTS idx_pbh_player_created
  ON player_battle_history(player_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pbh_battle
  ON player_battle_history(battle_id);
```

### 5. 文件清单

- `src/migrations/010_t054_settlement.sql` — players 三计数 + player_battle_history + battles.settled_at
- `src/services/battleSettlementService.ts` — `settleBattle` orchestrator + 内部 helpers（`loadBattleForSettlement` / `applySettlementInTransaction` / `updatePlayerCounter` / `insertBattleHistory` / `loadPlayerStats` / `cleanupAllBattleRedisKeys` / `buildResponse`）
- `src/controllers/battleController.ts` — `settleBattleHandler`，switch + `never` exhaustiveness
- `src/routes/battle.ts` — `POST /result`，沿用 `authMiddleware`
- `src/index.ts` — `app.use('/api/battle', battleRoutes)`，按字母序插在 auth/player 之间
- `src/services/battleSettlementService.test.ts` — 10 unit tests（happy path × 3 + 幂等 × 1 + 4 error branches + redis 失败 × 1 + transaction 回滚 × 1）
- `src/routes/battle.settlement.integration.test.ts` — 11 integration tests（401 × 1 + 400 × 2 + 403 × 1 + 404 × 1 + 409 × 2 + 200 × 4 含平局 + 幂等 × 1）

### 6. 范围外（明确不做）

- ❌ 资源发放（金币/经验/制造点）— 后续任务
- ❌ Rating / 段位 — 后续任务
- ❌ 战报回放（`battle_data` JSON 内容暴露）— 后续任务
- ❌ 5v5 / NvN 通用（T054 沿用 T052 3v3 假设）
- ❌ Redis SCAN 优化（KEYS 够用，MVP 不上）
- ❌ 清理 `idle:*` 全局匹配队列 key（不在 battle 范围内）
- ❌ WebSocket 推送结算事件（客户端走 `battle:end` 已有事件，POST /result 仅作持久化触发）

---

## T055 操作合法性校验中心化

### 1. 背景与动机

T049-T054 在 orchestrator 内部（`executeMove` / `executePlayCard` / `executeEndStep`）实现了 per-action 业务校验（actor / phase / owner / range / 能量等），是 process 内的 6/17 步流水线之一。但 **WS handler 入口层**（`battleRoom.ts:58-339`）只做了 payload 形状检查（battleId 是 string、characterId 是 string、handCard 形状合法），**完全没做跨切校验**：

1. **房间成员资格**：未验证 socket 真的在 `battle:{battleId}` 房间（攻击者可伪造任意 battleId）
2. **对战状态**：未验证 `battles.status='ongoing'`（已结算的对战还能继续收到 move）
3. **速率限制**：完全没有任何限流（单连接可无限刷 `battle:move`）
4. **代码重复**：4 个 handler 各自手写 payload 形状检查，没有共享模板

### 2. 设计决策

| # | 决策点 | 选择 |
|---|--------|------|
| 1 | T055 范围 | **中心化 + 跨切校验**（WS handler 入口加统一 validator + 新增 3 类跨切校验） |
| 2 | 存储后端 | **Redis**（rate-limit 计数器 + battle 状态 DB 查询） |
| 3 | 不动 orchestrator | T049/T050 内部校验逻辑保留（避免回归） |
| 4 | 非 nonce | **不做 nonce-based replay 防护**（MVP 范围外） |

### 3. 端到端流水线

```
WS Event (battle:move, payload: {battleId, characterId, toX, toY})
   │
   ▼
socket.io.on('battle:move', async (payload) => {
   │
   ▼  handleBattleMove (battleRoom.ts)
   │
   ├─ 1. payload 形状检查（现有，保留）
   │     battleId/characterId 是 string, toX/toY 是 finite number
   │
   ├─ 2. validateOperationContext(socket, payload, 'battle:move')  ★ T055 NEW
   │     ├─ 2a. socket.rooms.has(battleRoom(battleId))     ← 房间成员
   │     ├─ 2b. SELECT status FROM battles WHERE id=$1      ← 对战状态
   │     │        expect 'ongoing'
   │     └─ 2c. Redis Lua INCR rl:ws:user:{uid}:battle:move ← 速率限制
   │              if first: EXPIRE 60s
   │              if count > 60: rate_limited
   │
   ├─ 3. executeMove(...) (T049 orchestrator, 不动)
   │
   └─ 4. emit success or error
})
```

### 4. 模块: `backend/src/socket/wsValidation.ts`

```typescript
export type ValidationFailureReason =
  | 'invalid_payload'        // 400-equivalent (payload 缺字段)
  | 'not_in_room'             // socket 不在 battle room
  | 'battle_not_found'        // battleId 不存在
  | 'battle_not_ongoing'      // status != 'ongoing'
  | 'rate_limited';           // Redis 计数超阈值

export interface OperationContext {
  battleId: string;
  userId: string;          // 来自 socket.data.userId (T045 写入)
  eventName: string;       // 'battle:move' 等
}

export async function validateOperationContext(
  socket: BattleSocket,
  ctx: OperationContext
): Promise<ValidationResult>;

export async function validateJoinContext(  // 用于 handleBattleJoin（仅 rate-limit）
  userId: string,
  eventName: string
): Promise<ValidationResult>;
```

### 5. Rate Limit Lua 脚本（原子 INCR + EXPIRE）

```lua
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return current
```

**阈值**：60 次/分钟/用户/事件（足够人类操作；防脚本刷）。

### 6. 4 个 handler 的改造点

| Handler | 加的校验 | 不加的校验 | 原因 |
|---------|----------|-----------|------|
| `handleBattleJoin` | rate-limit | room / status='ongoing' | join 之前不在 room；status='pending' 由 `getPendingBattleForJoin` 吸收 |
| `handleBattleMove` | 完整 opContext | - | 全跨切校验 |
| `handleBattlePlayCard` | 完整 opContext | - | 同 move |
| `handleBattleSkipPlay` | 完整 opContext | - | 同 move |

### 7. Redis Key 设计

| Key 模式 | 类型 | 用途 | TTL |
|---------|------|------|-----|
| `rl:ws:user:{userId}:{eventName}` | STRING (counter) | 每用户每事件速率 | 60s |
| `battle:{battleId}` (已有) | ROOM | Socket.IO 房间 | session |

### 8. 降级策略

每步独立 try/catch，Redis/DB 异常 → **降级为 allow + console.error**。避免 Redis/DB 故障阻塞合法玩家。

### 9. 范围外（明确不做）

- ❌ Nonce-based replay 防护
- ❌ orchestrator 内部校验重构（T049/T050 的 6/17 步内部校验保留）
- ❌ per-battle 全局 rate-limit
- ❌ WS 消息结构校验（payload 形状检查保留在 handler 内）
- ❌ 能量平衡审计
- ❌ 跨进程速率聚合（T055 沿用单 Redis 即可，Lua global）
- ❌ 5v5 / NvN（T055 沿用 3v3）

### 10. 测试覆盖

- 单元测试 `wsValidation.test.ts`: 23 case（happy path / 3 类校验失败 / 降级 / Lua 边界）
- 集成测试 `wsValidation.integration.test.ts`: 10 case（真实 Redis Lua + 真实 PG battle row + EXPIRE 加速验证）
- 回归测试 `battleRoom.test.ts`: 5 case（验证 handler 调用 validator 后 emit error + 不调 orchestrator + happy path）

---

## T-FOLLOW-1 Migrations Runner（迁移自动化）

### 1. 背景与动机

T055 smoke test 真实暴露 dev DB 缺 8 migrations（003/005-010），单测 + 集成测试均不暴露（mock 隔离），只有真实 end-to-end smoke test 能发现。**项目此前无自动迁移机制**：SQL 文件躺在 `backend/src/migrations/`，但没 `npm run db:migrate` 脚本、没 `schema_migrations` 表追踪已应用版本、没 README 启动顺序说明。

**T-FOLLOW-1 目标**：补齐 migrations 三件套：
1. 自动化脚本（`npm run db:migrate` / `npm run db:status`）
2. `schema_migrations` 表（idempotent 追踪）
3. 启动顺序文档

### 2. 设计决策

| # | 决策点 | 选择 |
|---|--------|------|
| 1 | 位置 | `backend/src/scripts/migrate.ts`（与 docker compose + backend 紧耦合） |
| 2 | 跟踪表 | `schema_migrations`（filename UNIQUE + applied_at） |
| 3 | 排序 | 按文件名字符串升序（"001_" < "002_" < "010_"） |
| 4 | 事务粒度 | **每个迁移独立事务**（BEGIN/COMMIT），失败 ROLLBACK + abort |
| 5 | Bootstrap | 第一次运行自动 CREATE TABLE IF NOT EXISTS `schema_migrations` |
| 6 | 范围外 | 不支持 down/rollback（项目无 .down.sql） |

### 3. 模块: `backend/src/scripts/migrate.ts`

```typescript
// 核心导出
export async function runMigrations(): Promise<void>  // 应用所有未运行迁移
export async function printStatus(): Promise<void>    // 仅打印当前状态
export function listMigrations(): MigrationFile[]     // 列出目录所有 .sql 文件（纯函数）
```

**CLI 入口**（`require.main === module` 模式）：
- `ts-node src/scripts/migrate.ts` → apply all pending
- `ts-node src/scripts/migrate.ts --status` → print only
- 单测 `import { runMigrations }` 不触发 CLI（避免 main 自动跑）

### 4. 端到端流水线

```
$ npm run db:migrate
   │
   ▼
migrate.ts main()
   │
   ├─ 1. ensureMigrationsTable()      ← CREATE TABLE IF NOT EXISTS schema_migrations
   │
   ├─ 2. listMigrations()             ← readdirSync *.sql, sort
   │
   ├─ 3. getAppliedMigrations()       ← SELECT filename FROM schema_migrations
   │
   ├─ 4. pending = all - applied
   │
   ├─ 5. for each pending: applyMigration(file)
   │     ├─ pool.connect()
   │     ├─ BEGIN
   │     ├─ client.query(sql)         ← 执行 .sql 文件
   │     ├─ INSERT INTO schema_migrations (filename)
   │     ├─ COMMIT
   │     └─ client.release()
   │     失败 → ROLLBACK + abort + process.exit(1)
   │
   └─ 6. Summary: Applied/Failed/Remaining
```

### 5. SQL 目录约定

`backend/src/migrations/0NN_*.sql`（10 个文件，编号 001-010 但 004 故意空缺 = T019 仓储上限无 SQL 变更）：

| 编号 | 文件 | T 任务 |
|------|------|--------|
| 001 | `001_initial_schema.sql` | T003 数据库设计 |
| 002 | `002_add_card_sequence.sql` | T016 加工 |
| 003 | `003_add_battle_session_state.sql` | T036 回合流程 |
| 005 | `005_seed_taunt_card.sql` | T039 战士嘲讽 |
| 006 | `006_public_pool.sql` | T1001 公共池 |
| 007 | `007_add_match_metadata.sql` | T042 撮合 |
| 008 | `008_t048_battle_init.sql` | T048 战场初始化 |
| 009 | `009_t052_victory_stars.sql` | T052 胜利判定 |
| 010 | `010_t054_settlement.sql` | T054 结算 |

### 6. 启动顺序（README 标准）

```bash
# 1. 起 DB
docker compose up -d               # PG 5433 + Redis 6379

# 2. 装依赖
cd backend && npm install

# 3. 应用迁移（首次或 schema 变更后必跑）
npm run db:migrate

# 4. 起后端
npm run dev
```

### 7. 幂等性

- **重复运行安全**：`schema_migrations` 表 UNIQUE(filename) 防止重复 INSERT；已 applied 的文件 `getAppliedMigrations` 直接跳过
- **Bootstrap 自愈**：`CREATE TABLE IF NOT EXISTS` 即使跟踪表不存在也安全
- **失败可重试**：失败 migration ROLLBACK，事务保证 DB 状态干净；修复 SQL 后 re-run，已 applied 的会跳过

### 8. 测试覆盖

- 单元测试 `src/scripts/migrate.test.ts`: **8 case**（listMigrations 排序 / runMigrations 全应用/部分应用/全跳过/失败 abort + ROLLBACK / printStatus / 二次运行幂等）
- 手动验证：本地 dev DB 跑 `npm run db:migrate` 跑通后 → `npm run db:status` → 9 files, 9 applied, 0 pending；二次 `npm run db:migrate` → "All migrations already applied. Nothing to do."

### 9. 范围外（明确不做）

- ❌ Down/rollback migrations（项目无 .down.sql 文件）
- ❌ Non-SQL migrations（未来加 JS/TS 需扩展 runner）
- ❌ Schema diff 自动生成（手写 SQL）
- ❌ Migration 锁（防多进程并发 apply）— 单 dev 场景不需要
- ❌ 5v5 / NvN（沿用 3v3）

---

## T-FOLLOW-2 Migrations 启动期集成 + README 文档

### 1. 背景与动机

T-FOLLOW-1 把迁移 runner 跑通了，但仍有 2 个 gap：
1. **README 缺失** — 仓库根 + backend 都没有 README，新开发者不知道启动顺序
2. **启动时无感知** — dev DB 缺 migration 时，server 也能正常起来，但运行时报 `column "xxx" does not exist`，排查浪费时间

**T-FOLLOW-2 目标**：
1. 新增根 `README.md` + `backend/README.md`，写明 4 步启动顺序
2. `src/index.ts` 启动时自动检测 migrations 状态，缺时 console.warn（**不阻塞**）

### 2. 设计决策

| # | 决策点 | 选择 |
|---|--------|------|
| 1 | 警告 vs 阻塞 | **警告**（fail-open）— DB 状态问题不应拖垮 server 启动；运维友好 |
| 2 | 检测函数 | `checkMigrationsStatus()` 加到 `migrate.ts`（与 runMigrations/printStatus 平级），只读 |
| 3 | 返回结构 | `{ total, applied, pending, missing, hasPending, ok, error? }` — 程序化可消费 |
| 4 | 错误处理 | DB 错误 → `ok=false + error`，**不抛错**（避免 server 启动失败） |
| 5 | README 范围 | 2 份：根（项目概览 + 4 步启动）+ backend（细节 + 命令 + API） |

### 3. 模块: `checkMigrationsStatus`

```typescript
// backend/src/scripts/migrate.ts
export interface MigrationStatus {
  total: number;
  applied: number;
  pending: number;
  missing: string[];   // pending 文件名（按文件名升序）
  hasPending: boolean;
  ok: boolean;          // false = DB 错误
  error?: string;
}

export async function checkMigrationsStatus(): Promise<MigrationStatus>;
```

**关键不变量**：
- `missing` 数组保留 sorted order → 日志逐行展示友好
- `ok=false` 时所有计数为 0，`missing=[]` — 防止 caller 误用脏数据
- 不修改 DB（只调 `ensureMigrationsTable` 自我修复 + read 一次 `schema_migrations`）

### 4. index.ts 启动期集成

```typescript
// backend/src/index.ts
async function initializeApp() {
  try {
    await testDb();
    await warnIfMigrationsPending();   // ← T-FOLLOW-2 NEW
    await connectRedis();
    await initializeGatheringConfig();
    startGatheringChecker();
    console.log('✅ All services initialized');
  } catch (error) { ... }
}

async function warnIfMigrationsPending(): Promise<void> {
  const status = await checkMigrationsStatus();
  if (!status.ok) {
    console.error(`[migrations] ⚠️  Failed to check migration status: ${status.error}`);
    console.error(`[migrations]    Server will start anyway. Run 'npm run db:migrate' manually.`);
    return;
  }
  if (status.hasPending) {
    console.warn(`\n[migrations] ⚠️  ${status.pending} pending migration(s) detected:`);
    for (const m of status.missing) console.warn(`[migrations]    ○ ${m}`);
    console.warn(`[migrations]    Run 'npm run db:migrate' to apply.\n`);
  }
  // 全 applied → 静默（不刷日志）
}
```

**日志样式**（与 T055 validator 风格一致）：
- 全 applied → 静默
- 有 pending → ⚠️ 警告 + 列表 + 修复命令
- DB 错误 → ⚠️ 错误 + 提示手动跑 migrate

### 5. README 结构

#### 根 `README.md`（`/home/lovept/PtIDLE/README.md`）
- 项目简介 + 技术栈
- **4 步快速启动**（docker compose up → npm install → npm run db:migrate → npm run dev）
- 项目结构 + 常用命令 + 验证步骤
- 文档索引 + 贡献流程

#### `backend/README.md`
- 后端快速启动（含启动日志样例）
- 目录结构（含文件统计：51 源 + 42 测试 + 9 SQL）
- npm scripts 详解
- 数据库 / 测试结构 / 调试技巧
- REST API + WS 事件概览

### 6. 启动顺序（最终标准）

```bash
# 1. 起 DB
docker compose up -d               # PG 5433 + Redis 6379

# 2. 装依赖
cd backend && npm install

# 3. 应用迁移（首次或 schema 变更后）
npm run db:migrate

# 4. 起后端
npm run dev
```

**漏跑 `db:migrate` 的现象**：
- 启动看到 `[migrations] ⚠️  N pending migration(s) detected`
- 部分 query 报 `column "xxx" does not exist`
- 修复：执行 `npm run db:migrate` 即可

### 7. 测试覆盖

- 单元测试 `migrate.test.ts` 新增 5 case（happy path 全 applied / 部分 pending / 全 pending / DB 错误 fail-open / bootstrap 失败）
- 全量基线：42/42 suite, 701/701 test 全绿（696 → 701 = 5 新）
- 手动 smoke：故意 DELETE 一行 `schema_migrations`，调 `checkMigrationsStatus` 验证返回 `hasPending=true + missing=['010_xxx.sql']`

### 8. 范围外（明确不做）

- ❌ **强制阻塞启动**（fail-open 是有意的，dev 体验 > 严格性）
- ❌ **自动跑 migrate**（用户应主动控制 schema 变更时机）
- ❌ **per-migration 详细 diff**（仅文件名列表，不解析 SQL 内容）
- ❌ **CLI 集成警告**（仅 server 启动时检测，`migrate.ts` 自身保持纯 CLI）
- ❌ **TS 编译时类型生成**（每次 migration 仍是手写 SQL，不接入 prisma/typeorm）

---

## T-FOLLOW-3 CI/CD 接入（GitHub Actions）

### 1. 背景与动机

T-FOLLOW-1/2 把 dev DB 启动流程自动化了，但**所有测试仍靠本地 `npx jest`**：
- 新 PR 没有自动化校验，merge 前需 reviewer 手动跑测试
- 多 contributor 协作时"在我机器上能跑"问题频发
- 没有 coverage 历史趋势
- T055 smoke test 暴露的「dev DB 缺 8 migrations」问题，在 CI 上**应该自动发现**（而不是等 reviewer 跑 smoke test）

**T-FOLLOW-3 目标**：用 GitHub Actions 跑全量测试 + migrations，PR 阶段自动拦截 schema / 测试问题。

### 2. 设计决策

| # | 决策点 | 选择 |
|---|--------|------|
| 1 | CI 平台 | **GitHub Actions**（仓库已在 GitHub，免费 + 集成 PR 状态检查） |
| 2 | Service 端口 | **标准端口**（PG 5432 / Redis 6379），与 dev docker-compose (PG 5433) 不同 |
| 3 | 触发条件 | `push` 到 master + `pull_request` 到 master + 手动 `workflow_dispatch` |
| 4 | Node 版本 | 20.x（对齐 `engines.node >= 20.0.0`） |
| 5 | 装包 | `npm ci`（用 lock file 精确版本，比 `npm install` 可靠） |
| 6 | Migration | **先跑 `npm run db:migrate`，再跑 jest**（避免 schema 缺失时跑出假阳性测试失败） |
| 7 | Coverage | `actions/upload-artifact@v4` 上传 30 天（**不接 codecov**，避免 secret 管理复杂度） |
| 8 | 并发控制 | `concurrency.cancel-in-progress: true`（PR 多次 push 自动取消旧 run） |
| 9 | Health check | service container 必须有 health check，jest 启动不能比 PG ready 快 |

### 3. Workflow 文件结构

```yaml
# .github/workflows/ci.yml
name: CI
on:
  push: { branches: [master] }
  pull_request: { branches: [master] }
  workflow_dispatch:        # 手动触发

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true   # 新 push 取消旧 run

jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    services:
      postgres: { image: postgres:16, ports: [5432:5432], health-cmd: pg_isready ... }
      redis:    { image: redis:7-alpine, ports: [6379:6379], health-cmd: redis-cli ping ... }
    env:
      NODE_ENV: test
      DB_HOST: localhost
      DB_PORT: 5432                # ← 标准端口（dev 是 5433）
      DB_NAME: ptidle
      DB_USER: postgres
      DB_PASSWORD: postgres
      REDIS_HOST: localhost
      REDIS_PORT: 6379
      JWT_SECRET: ci-test-secret-not-for-prod  # 必填，否则 auth 测试 fail

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm', cache-dependency-path: backend/package-lock.json }
      - working-directory: backend
        run: npm ci
      - working-directory: backend
        run: npm run db:migrate              # T-FOLLOW-1 幂等
      - working-directory: backend
        run: npx jest --forceExit            # 42/701 全量
      - if: success()
        working-directory: backend
        run: npm run test:coverage
      - if: success()
        uses: actions/upload-artifact@v4
        with: { name: coverage-report, path: backend/coverage, retention-days: 30 }
```

### 4. 端口差异：dev vs CI

| 环境 | PG 端口 | Redis 端口 | 备注 |
|------|---------|-----------|------|
| Dev (docker-compose) | **5433** (host) → 5432 (container) | 6379 | 避免与本机已装 PG 冲突 |
| CI (GitHub Actions) | **5432** | 6379 | service container 内部端口 |
| Tests (`*.integration.test.ts`) | 读 `process.env.DB_PORT` | 读 `process.env.REDIS_PORT` | 自动适配 |

**关键**：`backend/src/config/database.ts` 用 `process.env.DB_PORT || '5432'` 兜底，所以 dev .env 设 5433 / CI workflow 设 5432 都对。

### 5. README Badge

```markdown
[![CI](https://github.com/YunXihb/PtIDLE/actions/workflows/ci.yml/badge.svg)](https://github.com/YunXihb/PtIDLE/actions/workflows/ci.yml)
```

shields.io 动态 badge，首次跑前显示 "no status"，跑过后显示 pass/fail。

### 6. 关键踩坑（CI 调试要点）

1. **service container 必须有 health check** — 否则 jest 启动可能比 PG ready 还快 → `ECONNREFUSED 127.0.0.1:5432`
2. **`DB_PORT` 必须是 5432** — GitHub Actions 内部 `localhost:5432` 走 service container 端口映射；用 5433 会连不上
3. **`JWT_SECRET` 必填** — `authController` 测试需要真 token，secret 空会 401
4. **`npm ci` 不是 `npm install`** — CI 场景下用 lock file 精确版本，避免 `package.json` 与 lock 不同步的随机性
5. **`concurrency.cancel-in-progress`** — PR 上多次 push 排队浪费 runner 时间
6. **Coverage 用 artifact 不用 codecov** — 避免 `CODECOV_TOKEN` secret 管理；后期需要时再加

### 7. 未来增强（明确不做）

- ❌ **Codecov 集成**（需 `CODECOV_TOKEN` secret 管理，本期 MVP 不做；artifact 30 天保留够 review 用）
- ❌ **Lint 独立 workflow**（当前 jest + tsc 已覆盖类型错误；eslint 可加但本期不阻塞）
- ❌ **多 Node 版本矩阵**（package.json 已锁 `engines.node >= 20`，单 20.x 足够）
- ❌ **多 OS 矩阵**（dev/prod 都 Linux，Windows/Mac 兼容非目标）
- ❌ **CD（自动 deploy）**（dev 手动部署；prod 部署是另一个任务）
- ❌ **PR 状态检查 / required checks**（仓库 settings，非 workflow 文件控制；用户审阅后配置）

### 8. 测试覆盖

- **不写新单测**（CI 是基础设施，不需单测）
- **真实验证**：用户 push 后，GitHub Actions runner 跑通才算成功
- 当前本地基线：**42/42 suite, 701/701 test**（T-FOLLOW-2 收尾）

---

## T-FOLLOW-4 CD 接入（Docker Image + GHCR Release）

### 1. 背景

T-FOLLOW-3 接入 CI 后，dev/prod 部署仍手动。T-FOLLOW-4 把"打镜像 + 推镜像"自动化，但**不**做 deploy（无 SSH / 平台 webhook 步骤 — 编排平台尚未选定）。

### 2. 用户选择

- ✅ **做**：Docker image build + push 到 GHCR
- ❌ **不做**：deploy workflow（无编排平台 / 无 SSH / 无平台 webhook）
- 理由：项目尚未选定 ECS/k8s/Compose/其他，部署步骤留 T-FOLLOW-5 决定

### 3. 三个交付物

| 文件 | 作用 |
|---|---|
| `backend/Dockerfile` | Multi-stage build (Node 20 alpine)：builder 装全量 deps + tsc 产 dist/；runtime 装 prod deps + copy dist/ + USER node + HEALTHCHECK via `node -e "http.get..."`（alpine 无 wget）|
| `backend/.dockerignore` | 排除 node_modules / dist / coverage / .env / tests / docs / .github，加速 build context |
| `.github/workflows/release.yml` | tag push v* + workflow_dispatch → buildx multi-platform (linux/amd64 + linux/arm64) → push GHCR |
| `docs/deploy.md` | 拉取 / env vars / 启动顺序 / 单机 vs compose / 健康检查 / 自定义 build / 常见问题 |

### 4. 镜像设计

| 维度 | 决策 | 理由 |
|---|---|---|
| Base image | `node:20-alpine` | 镜像小（~50MB base） + Node 20 LTS |
| Multi-stage | builder + runtime | runtime 镜像**不**含 tsc / dev deps |
| 包管理 | `npm ci --omit=dev` | CI 锁版本，runtime 排除 dev |
| User | `USER node` | 不跑 root，减少攻击面 |
| HEALTHCHECK | `node -e "http.get(...)"` | alpine 无 wget/curl |
| 启动命令 | `node dist/index.js` | 跟 `package.json` `main` 字段对齐 |

**镜像体积**：215MB（alpine base 50MB + node_modules 150MB + dist 15MB）。进一步优化可换 `gcr.io/distroless/nodejs20`（T-FOLLOW-5 决定）。

### 5. Release Workflow 设计

| 触发 | 输入 | Tag 输出 |
|---|---|---|
| tag push `v*` (stable v1.0.0) | 自动 | `1.0.0`, `1.0`, `<sha7>`, `latest` |
| tag push `v*` (pre-release v1.0.0-rc1) | 自动 | `1.0.0-rc1`, `1.0`, `<sha7>`（不打 latest）|
| workflow_dispatch | 用户输入 version | `<input>`, `<sha7>`（不打 latest）|

**Auth**：`secrets.GITHUB_TOKEN` 自动注入（GHCR push 需 `packages: write` 权限），无需 user secret。

**Buildx**：QEMU + multi-platform 在 amd64 runner 上同时产出 arm64 镜像（Apple Silicon / ARM 服务器直拉）。

**Cache**：`cache-from: type=gha` + `cache-to: type=gha,mode=max` 利用 GitHub Actions 内置缓存加速后续 build。

### 6. 关键设计决策

1. **Pre-release 不打 `latest`**：用 bash regex `^[0-9]+\.[0-9]+\.[0-9]+$` 区分 stable vs rc/alpha/beta，符合 semver 约定
2. **`major.minor` 自动跟随**：tag `v1.0.0` 同时打 `1.0`，方便"跟踪 minor 升级"用户
3. **手动 trigger 不打 `latest`**：workflow_dispatch 通常是 dev 测试，污染 `latest` 误导生产用户
4. **容器内不跑 migrations**：镜像只跑 `node dist/index.js`，migrations 由外部 / init container / CI job 负责（幂等的 `npm run db:migrate` 可重复跑）
5. **Multi-arch 默认开**：现代容器生态（k8s/Compose/Serverless）多 arch 无额外成本

### 7. 关键踩坑（release 调试要点）

1. **容器内 `localhost` ≠ host `localhost`** — DB/Redis 用 `host.docker.internal` (Linux 20.10+ 需 `--add-host=host.docker.internal:host-gateway`)
2. **必须先 migrations 再启动** — 否则 backend 因 schema 缺失报错（services.online 但 health check "migrations" warning）
3. **GHCR visibility 默认 private** — 首次 push 后在 package settings 改 public 才能 `docker pull` 不登录
4. **`packages: write` 权限** — 默认 GITHUB_TOKEN 无 packages 写权限，必须显式声明
5. **QEMU 慢** — multi-arch build 约 5-8 分钟（单 arch 约 2-3 分钟），timeout 留 30 分钟

### 8. Smoke Test 结果（2026-06-22）

| 步骤 | 命令 | 结果 |
|---|---|---|
| 1. 起容器 | `docker run --rm -d --name ptidle-test -p 3001:3000 --add-host=host.docker.internal:host-gateway -e DB_HOST=host.docker.internal ... ptidle-backend:test` | ✅ 启动 |
| 2. 看日志 | `docker logs ptidle-test` | ✅ `HTTP+WS server running on port 3000` + `PostgreSQL connected` + `Redis connected` |
| 3. 健康检查 | `curl http://127.0.0.1:3001/health` | ✅ HTTP 200, `{"status":"ok","timestamp":"...","services":{...}}` |
| 4. 清理 | `docker stop ptidle-test` + `docker rmi ptidle-backend:test` | ✅ 容器 + 镜像已删 |

**注意**：容器日志有 `[migrations] ⚠️  Failed to check migration status: ENOENT ... '/app/dist/migrations'`，是预期的（migrations 文件**故意**不进镜像，参考 Dockerfile 头部注释）。

### 9. 未来增强（明确不做 / 留 TODO）

- ❌ **Deploy workflow**（k8s/ECS/Compose 自动部署）—— T-FOLLOW-5 决定编排平台后实现
- ❌ **Distroless 镜像**（gcr.io/distroless/nodejs20）—— 体积优化非阻塞
- ❌ **镜像签名（cosign / sigstore）**—— 安全加固非 MVP 目标
- ❌ **SBOM 生成**（syft / grype）—— 合规需求未触发
- ❌ **镜像扫描**（trivy）—— 安全加固非 MVP 目标
- ❌ **Crane / skopeo 跨 registry 同步**—— 单 registry 足够

### 10. 测试覆盖

- **不写新单测**（release 是基础设施，不需单测）
- **真实验证**：用户 push tag v* → GHCR image 出现 → `docker pull` + `docker run` 跑通
- **当前基线**：**42/42 suite, 701/701 test**（release 是新增，不改代码 → 无 regression）

---

---

## T-FOLLOW-5 单 VPS 部署编排（Docker Compose + GitHub Actions SSH deploy）

### 1. 背景

T-FOLLOW-4 完成镜像 + GHCR 发布，但生产部署仍手动。T-FOLLOW-5 在 T-FOLLOW-4 之上加 deploy workflow，让 push tag v* 自动部署到单 VPS。

### 2. 用户决策

- ✅ 编排平台: **单 VPS + Docker Compose**（不是 k8s/ECS/Serverless）
- ✅ Deploy 自动化: **CI 触发 SSH deploy**（workflow_run + appleboy/ssh-action）
- ✅ DB / Redis 位置: **同 VPS, docker compose**（4 services）
- ✅ 错误处理: **方案 A — 失败手动 SSH 修**（不做 auto-rollback）
- ❌ 编排平台选型后续（k8s/ECS/Serverless）：不在本任务范围
- ❌ HTTPS / TLS / domain：T-FOLLOW-6 决定
- ❌ 监控 / alerting：T-FOLLOW-6+
- ❌ 备份：MVP 阶段不加（数据可重建）

### 3. 8 个交付物

| 文件 | 作用 |
|---|---|
| `backend/src/scripts/migrate.js` | 纯 JS 迁移 runner（替代 migrate.ts），不需 ts-node + `MIGRATIONS_DIR` env var |
| `backend/src/scripts/migrate.d.ts` | TS 声明文件（migrate.js 是 JS, 需 .d.ts 供 .ts 引用） |
| `backend/Dockerfile` | 加 `COPY src/migrations /app/migrations` + `COPY src/scripts/migrate.js` (tsc 不编译 .js) |
| `docker-compose.yml` | 4 services (postgres/redis/backend/migrate), VPS 部署模板 |
| `.env.example` | VPS env vars 模板 |
| `scripts/deploy.sh` | VPS 上跑: pull + migrate + restart + 30s health check + `--force-recreate` |
| `.github/workflows/deploy.yml` | workflow_run trigger + appleboy/ssh-action + actions/checkout |
| `docs/deploy.md` | 加 § 5.3 单 VPS CI 自动部署指南 |

### 4. 关键设计决策

1. **migrate.js 替代 migrate.ts**: 生产 image 不含 ts-node (dev dep), 改纯 JS. 新增 `MIGRATIONS_DIR` env var (默认 `/app/migrations`) 让 prod image 找到 baked-in SQL
2. **migrate 复用 backend image**: 不用独立 `node:20-alpine` + bind mount, 避免 VPS 维护额外目录 + 每次 deploy 重 npm ci ~60s
3. **migrate 用 `profiles: ["migrate"]`**: 隔离 one-shot service, 平时不启, deploy 时显式 `run --rm`
4. **depends_on `condition: service_healthy`**: backend 等 PG/Redis 健康才启, 避免 cold start race
5. **healthcheck 用 `node -e`**: alpine 无 wget/curl, 跟 Dockerfile / deploy.sh 一致
6. **trigger = `workflow_run`**: 监听 release.yml 成功事件, 不独立触发, 避免「未发布就部署」
7. **`actions/checkout@v4` 必须显式加**: `workflow_run` 触发时**不**自动 checkout, 需显式 `actions/checkout@v4` 才能让 `script_path: scripts/deploy.sh` 找到脚本
8. **`--force-recreate` 必须显式加**: `docker compose up -d` 只在 config 变化时 recreate, pull 新镜像不算 config 变化, 不加 `--force-recreate` 新镜像不会被加载
9. **方案 A 不做 auto-rollback**: solo dev, 失败时手动 SSH 修, 简单可靠; 自动回滚的 schema 兼容性问题留 TODO

### 5. 关键踩坑（deploy 调试要点）

1. **VPS 一次性配置**: 非 root 用户 + docker group, `/opt/ptidle` 目录权限
2. **GitHub Secrets**: `VPS_SSH_KEY` 是专用 key (不与个人 key 混用), `secrets.GITHUB_TOKEN` 自动给 release.yml 用
3. **image 默认 private**: 部署前需在 GHCR package settings 改 public, 否则 `docker compose pull` 401
4. **MIGRATIONS_DIR 推荐显式设 (defense-in-depth)**: prod image baked-in 是 `/app/migrations`, `migrate.js` 默认 `resolve(__dirname, '../migrations')` 在 image 里也解析到 `/app/migrations` (因 `dist/scripts/migrate.js` 的 `../migrations` = `/app/migrations`). docker-compose 里显式设 env 是清晰度 + 防御性, 不是必须
5. **`docker compose exec -T`**: 交互式 TTY 在 SSH + workflow_run 场景会卡, 用 `-T` 禁用
6. **workflow_run 的 `conclusion`**: 在 if guard 里要明确 `conclusion == 'success'`, 否则 cancelled/failed release 也会触发 deploy
7. **`tsc` 不编译 `.js`**: `migrate.js` 不会被 tsc 输出到 `dist/scripts/`, 需 Dockerfile 显式 `COPY src/scripts/migrate.js /app/dist/scripts/migrate.js`
8. **`workflow_run` 不自动 checkout**: 需显式 `actions/checkout@v4`, ref 用 `head_sha` (release run 的 commit)

### 6. 镜像 baked migrations 的优势

| 维度 | 旧 (migrate.ts + bind mount) | 新 (migrate.js + baked) |
|---|---|---|
| 镜像大小 | + node:20-alpine (~50MB) | 0 (复用 backend image) |
| 部署时间 | npm ci ~60s | 0 (image 内已含) |
| VPS 维护 | 需 backend-migrations 目录 | 无 |
| Schema 漂移风险 | bind mount 跟 image 可能不同步 | 原子一致 (同 image) |

### 7. 未来增强（明确不做 / 留 TODO）

- ❌ **HTTPS / TLS**: T-FOLLOW-6 用 Caddy / nginx + Let's Encrypt
- ❌ **Domain 绑定**: T-FOLLOW-6
- ❌ **自动回滚**: T-FOLLOW-7+ (记录 .last-good tag + health check fail 时 restore)
- ❌ **备份策略**: T-FOLLOW-8+ (daily pg_dump → B2 / S3)
- ⚠️ **监控**: T-FOLLOW-9 部分完成 (2026-08-07): GH Actions scheduled health check 已做 (每 15 min curl /health + issue 告警); UptimeRobot + 5xx 告警阻塞于域名
- ❌ **镜像签名 / 扫描**: T-FOLLOW-10+ (cosign / trivy)
- ❌ **Distroless 镜像**: T-FOLLOW-11+ (体积优化)
- ❌ **HA / multi-instance**: T-FOLLOW-12+ (load balancer + 2 VPS, 仅在用户量到时考虑)

### 8. 测试覆盖

- **单元测试**: migrate.js 9/9 (8 原有 + 1 新增 MIGRATIONS_DIR env var), 全量 42/42 suite, 702/702 test pass
- **集成测试**: 本地 `docker build` + `docker run ls /app/migrations` 验证 baked
- **真实验证**: 用户 push v* tag 触发完整 deploy 链路 → 看到 GH Actions success

---

## T-FOLLOW-6: HTTPS / TLS / Domain

**日期**: 2026-06-22
**前置**: T-FOLLOW-5 (commit e10b9da)
**目的**: 让玩家通过 https://$DOMAIN 访问后端, Let's Encrypt 自动 cert + 续期

### 1. 关键设计决策

1. **Caddy 作为 docker-compose 第 5 service**: 跟 T-FOLLOW-5 4-service 模式一致, `docker compose up -d` 管所有服务, 升级统一, 不需 host native caddy
2. **HTTP-01 challenge (不是 DNS-01)**: 不需 DNS provider API token, 任何 DNS provider 都行, 只需 80 端口可达
3. **删 backend 直连 port 3000**: 玩家只能走 Caddy, 减少攻击面 (只有 Caddy 暴露到 host)
4. **caddy_data volume 持久化 cert**: 容器重建不丢 cert, 避免重复申请触发 Let's Encrypt 限速
5. **Caddyfile `{$DOMAIN}` 占位符**: env 注入, 同 Caddyfile 模板可换 domain (e.g. staging 用 test.example.com)
6. **WebSocket 透明转发**: Caddy 默认支持 upgrade 协议, Socket.IO /socket.io/ 不需额外配置

### 2. 文件改动

| 文件 | 改动 |
|---|---|
| `Caddyfile` | 新建 (4 行) |
| `docker-compose.yml` | 加 caddy service + 删 backend ports + 加 caddy_data/caddy_config volumes |
| `.env.example` | 加 DOMAIN + ACME_EMAIL, 删 BACKEND_PORT |
| `docs/deploy.md` § 5.3 | 加 DNS 步骤 + https 验证 + 错误排查 |
| `memory-bank/*` | 本次同步 |

### 3. 验证路径

- 本地: `caddy validate --config Caddyfile --adapter caddyfile` (语法)
- 本地: `docker compose config` (YAML + env var 引用)
- VPS: `dig +short $DOMAIN` → 应返回 VPS IP
- VPS: `curl -vI https://$DOMAIN/health` → HTTP/2 200, server: Caddy
- VPS: `curl -vI http://$DOMAIN/health` → 301 → https://$DOMAIN/health
- VPS: `wscat -c wss://$DOMAIN/socket.io/?EIO=4&transport=websocket` → 101 Switching Protocols

### 4. 关键踩坑

1. **80 端口 firewall**: Hetzner / DO / Aliyun 等 cloud firewall 默认挡 80, 需显式开. Caddy log "acme: 403" 是这个症状
2. **DNS 传播延迟**: A 记录改后 5-30 分钟才全球生效, Caddy 启动期连不上 ACME server 会 retry (默认 5 次)
3. **Caddyfile `{$DOMAIN}` 占位符**: caddy validate --adapter caddyfile 模式下不展开, 会有 WARN (可忽略), 真实运行时由 caddy 二进制展开

### 5. 未来增强（明确不做 / 留 TODO）

- ❌ **Wildcard cert (DNS-01)**: T-FOLLOW-13+ (多 sub-domain 时考虑)
- ❌ **HSTS preload**: T-FOLLOW-14+
- ❌ **Rate limiting / DDoS 防护**: 内部娱乐游戏量小, 不做
- ❌ **多 domain / SAN cert**: 单域名单 cert 够

### 6. 测试覆盖

- **语法验证**: Caddyfile caddy validate + docker compose config 5 services/4 volumes (本地跑)
- **单测**: 不改 backend 代码, 全量 42/42 suite / 702/702 test pass (无 regression)
- **真实验证**: 用户在 VPS 上配 DNS A 记录 + 改 .env + `docker compose up -d` → curl https://$DOMAIN/health 200

## T-FOLLOW-7 自动回滚 (2026-06-25)

### 目标
deploy.sh 加自动回滚 — health check 失败时自动切回上一个 known-good image.

### 关键组件
1. **`scripts/deploy.sh`** — 6 步 + 1 回滚分支
   - `[0/6]` 读 `/opt/ptidle/.last_good` → `PREV_GOOD`
   - `[1-4/6]` 原 4 步 (pull / migrate / restart / health check 30s)
   - `[5/6]` success → `docker inspect` 拿新 digest → 写入 `.last_good`
   - `[ROLLBACK]` health fail → 拉 PREV_GOOD + restart + 15s health check
2. **`/opt/ptidle/.last_good`** — VPS 上单行 text 文件, 存上次成功 deploy 的 image ref (digest)
3. **`docker-compose.yml` backend image** — 改 `${BACKEND_IMAGE:-...}` 模式, 回滚时通过 env var 覆盖

### 触发条件
- **仅 health check 30s 失败** → 进入回滚分支
- **migrate 失败 / 拉镜像失败** → 不回滚, exit 1, 用户判断

### 更新时机
- **仅 deploy 成功后**写 `.last_good`
- 避免「连续 deploy 都坏」时 `.last_good` 被覆盖成坏状态

### 关键假设
- **Migrations forward-only 且 additive** (T-FOLLOW-6 Q4 已明确)
- 回滚代码到 N-1 时, DB schema 仍是 N 的状态; 旧代码不引用新列, 可正常运行
- 违反此假设的 migration → 自动回滚救不回来, 用户需手动介入

### 数据流
- 首次 deploy: 无 `.last_good` → 失败 → exit 1 loud (无回滚目标)
- Happy path: deploy 成功 → `.last_good` 覆盖为新 digest → exit 0
- 回滚成功: 拉 PREV_GOOD → restart → 15s health pass → exit 0 (deploy.yml green)
- 回滚失败: 拉失败 / compose 失败 / health fail → exit 1 + dump logs (deploy.yml red, 用户 SSH 介入)

### 失败诊断可观测性 (2026-08-06)
- `deploy.sh` 加 `set -E` + `trap on_error ERR`: 裸命令失败 (cd/pull/migrate/up) 时打印失败行号 + 定位提示 (`BASH_LINENO[0]`)
- **背景**: v0.1.1 首次 deploy (run #28175599367) 8s exit 1 但无 step-level 输出, 无法定位根因 (静态分析最可能: /opt/ptidle 未就绪 `cd` 秒失败, 或 GHCR 包 private + VPS 未 `docker login` -> pull 401 秒失败)
- **语义**: ERR trap 仅裸命令失败触发 (POSIX); `if`/`while` 条件里的失败不触发 -> health-check 循环与回滚分支 (手动 `if !` 处理) 不受影响
- **`set -u` 未定义变量**: bash stderr 自带行号 (`line N: VAR: unbound variable`), trap 不触发也能定位
- **局限**: 仍需 VPS 访问才能真修; trap 只改善"定位" (从 GH Actions 日志直接看行号), 不改部署逻辑

### 不做 (YAGNI)
- ⚠️ 深 health check: DB/Redis ping 已实现 (e7e51c9, 待镜像刷新上线); 5xx 率统计仍待做 — T-FOLLOW-9
- ❌ 蓝绿/金丝雀 — 单 VPS 不需要
- ❌ 自动重试 / 循环检测 — 回滚失败 → 用户介入
- ❌ multi-image `.last_good` (保留 N 个 good tag) — 单 deploy 失败概率极低
- ❌ 改 GH Actions deploy.yml — deploy.sh 行为已变, yml 不动

---

## T-FIX 质量修复批次（2026-08-06）

### 背景
摸排发现"测试全绿但生产跑不通"：单测全部 mock DB/Redis，掩盖了 8 个致命 bug。核心是架构级脱节——战斗状态机写 Redis、编排器读 DB（双状态源）。

### 关键修复

| # | 修复 | 文件 |
|---|------|------|
| 1 | **统一状态源**：新增 `getSessionState`（读 Redis 完整状态含 activationOrder），`executeMove`/`executePlayCard`/`executeEndStep` 全部改用；DB 仅审计/恢复 | battleSessionService.ts / battleActionService.ts |
| 2 | **手牌类型冲突**：手牌是 STRING(JSON)，改 lRem 为 `removeCardFromHand`（读-过滤-覆盖写） | handService.ts / battleActionService.ts |
| 3 | **回合轮转**：`executePlayCard` 不再独立 completePlayPhase，统一交给 `executeEndStep`（其内部 move/play→end_step→endCurrentStep→round end）；`isLastStepInRound` 用 `activationOrder.length` 动态判定，替代硬编码 5 | battleActionService.ts |
| 4 | **阵营判定**：`sideForPlayerId` 优先字面量 'p1'/'p2'，再按 battles 表 player1/2_id (UUID) 映射；`applyKillStars`/`applyBaseStars` 改用 | battleOutcomeService.ts |
| 5 | **据点坐标**：positions HASH 是 `key="x,y"→value=charId`，新增 `getPositionByCharacterId` 反查 | battleOutcomeService.ts |
| 6 | **skip_play 归属**：`executeEndStep(io, battleId, userId)` 加 actor 归属校验 | battleActionService.ts / battleRoom.ts |
| 7 | **AOE currentRound**：`validateAOEAttack` 加第 5 参 currentRound，ranger 增伤/mage mark 不再 hardcode 0 | battleService.ts |
| 8 | **撮合 SQL 优先级**：`((A AND B) OR (A' AND B')) AND status='pending'` 加括号 | matchmakingService.ts |
| 9 | **制造顺序**：`executeCardCrafting` 用 withTransaction，先校验（模板/上限/sequence）后扣料+INSERT | craftingService.ts |
| 10 | **经济幂等**：`completeGathering`/`claimOfflineEarnings`/加工路由全部 withTransaction + `SELECT ... FOR UPDATE` 行锁 | gatheringService.ts / playerService.ts / routes/processing.ts |
| 11 | **IDOR**：`GET /characters/:id/deck` 加归属校验 | routes/characters.ts |
| 12 | **JWT 密钥**：生产强制要求 JWT_SECRET（否则抛错）；verify 显式 `algorithms:['HS256']` | config/jwt.ts / middleware/auth.ts / socket/authMiddleware.ts |
| 13 | **health 真实探测**：/health 实际 ping DB/Redis，异常返回 503 | index.ts |
| 14 | **deploy.sh 回滚**：容器名 ptidle-backend-1 + 存 image ref（com.docker.compose.image label）替代不可 pull 的本地镜像 ID | scripts/deploy.sh |

### 测试基线
- 全量 jest：671/702 通过（4 suite 失败 = 本地无 PG/Redis 的 ECONNREFUSED，与基线一致；CI 环境应全绿）
- 相关 28 suite 566 测试全绿；tsc --noEmit 零错误
- 测试同步更新：battleActionService / battleOutcomeService / craftingService / gatheringService / player.integration / processing.integration / gathering.integration

## T-FIX 批次 2（P1/P2，2026-08-06）

### 并发/资产安全
| # | 修复 | 文件 |
|---|------|------|
| 15 | **moveCharacter Lua 原子**：三段非原子（hGet+hDel+hSet）改 Lua 单线程原子执行，防并发抢占 | battleService.ts |
| 16 | **settleBattle 行锁幂等**：事务内 `SELECT settled_at FOR UPDATE` 复核，防并发双倍累加战绩 | battleSettlementService.ts |
| 17 | **consumePlayerCard 归属复核**：DELETE 带 character_id + 子查询复核 card 归属，防误删他人卡牌 | battleActionService.ts |
| 18 | **全局错误中间件**：4 参 Express error handler，统一 JSON 错误格式，生产不泄露内部详情 | index.ts |
| 19 | **CORS 收敛 + auth 限流**：CORS_ORIGIN env 收敛 REST+WS；register/login 加 Redis Lua 限流（每 IP 60s/20 次） | index.ts / middleware/rateLimit.ts / routes/auth.ts |

### 代码整洁
| # | 修复 | 文件 |
|---|------|------|
| 20 | **共享缓存工具**：`createCache` 消除 5 处手写 5 分钟缓存（crafting/processing/card/skill/profession） | utils/cache.ts |
| 21 | **Redis key 常量**：`redisKey` 模块集中 key 模板，收敛 6 个 service 的手写重复 | utils/redisKeys.ts |
| 22 | **错误码统一**：MatchmakingError/GatheringError 带 code 属性，controller 不再 `.includes('中文')` 匹配 | matchmakingService / gatheringService + controllers |
| 23 | **迁移 004 + 唯一约束**：card_templates/gathering_skills/processing_recipes 加 name/template_no UNIQUE，修复种子 ON CONFLICT 失效 | migrations/004_*.sql |

### 验证
- 全量 jest：671/702（4 suite 失败 = Windows 路径 + 本地无 PG/Redis，与基线一致；CI 应全绿）
- tsc --noEmit 零错误；改动生产文件零 lint error
- 相关测试：battleService / battleSettlementService(+集成) / battleActionService / matchmaking / gathering / 5 缓存 service 全绿

---

*文档版本：v1.50*
*最后更新：2026-08-06*

---

## T-FOLLOW-8 备份策略 (2026-08-06)

### 目标
生产数据备份: daily pg_dump + 保留策略 + 恢复流程 + storage 抽象. 防止数据丢失 (误操作 / migration 失败 / 硬件故障).

### 关键组件
1. **`scripts/backup.sh`** - pg_dump (custom format, compress=9) + storage backend dispatch (local/b2/s3) + prune (daily14+weekly8) + 磁盘空间检查 (>=1GB) + trap 清理临时文件
2. **`scripts/restore.sh`** - pg_restore --clean --if-exists --no-owner + `CONFIRM_RESTORE=yes` 守卫 (防误跑覆盖) + verify 关键表 count
3. **`docker-compose.yml` backup service** - postgres:16 image (含 pg_dump/psql), `profiles:["backup"]` 隔离 (不随 up 启动), 挂载 ./backups + 脚本
4. **`.github/workflows/backup.yml`** - `schedule: cron '17 3 * * *'` (daily 03:17 UTC) + `workflow_dispatch`, SSH 跑 `docker compose run --rm backup` (复用 VPS_SSH_KEY/HOST/USER secrets)
5. **storage 抽象接口** - `upload_backup`/`list_backups`/`delete_backup` 函数 dispatch; `local` 实现, `b2`/`s3` TODO (打印明确错误 + return 1, 不静默成功)

### 数据流
- 备份: GH cron -> SSH -> `docker compose run --rm backup` -> backup.sh -> pg_dump -> `/backups/ptidle-DATE.dump` -> prune 旧备份 -> exit 0 (GH green)
- 恢复: SSH -> `docker compose run --rm -e CONFIRM_RESTORE=yes backup /rs.sh <DATE|latest>` -> pg_restore --clean -> verify count

### 关键决策
| 维度 | 选择 | 理由 |
|---|---|---|
| 备份内容 | PG full dump (custom format) | 全量、可选择性恢复单表 |
| 频率 | daily (GH Actions cron) | 复用 SSH 模式, 不依赖 VPS cron |
| 保留 | daily 14 + weekly 8 (周一) | 约 22 个备份, 平衡成本与恢复点 |
| 存储 | 本地 (VPS /opt/ptidle/backups/) + 抽象接口 | 用户选; 不依赖外部账号; 后续 B2/S3 易加 |
| 调度 | GH Actions scheduled | 配置在 GH, 复用 SSH, 审计可见 |
| 恢复 | restore.sh + CONFIRM_RESTORE 守卫 | 防误跑覆盖生产数据 |

### 范围外
- ❌ Redis 备份 (redisdata volume 持久化已够; battle session 丢失可接受, 玩家重连重建)
- ❌ .env/配置备份 (含密钥需加密, 用户自管)
- ❌ B2/S3 实际实现 (本轮 local + 接口; B2/S3 留 TODO 分支返回 1)
- ❌ 增量备份 / WAL archiving / PITR (pg_dump 全量够 solo dev)
- ❌ 备份加密 (本地不需; B2/S3 时再加 GPG)

### 本地验证 (2026-08-06, dev PG ptidle-dev-pg)
- backup: dump 48KB, `pg_restore -l` 128 TOC entries, custom+gzip format
- prune: 31 假文件 (30 天 + 1 真) -> 删 15 -> 保留 16 (daily14 + weekly 额外 2: 07-20/07-13 周一)
- storage 抽象: `BACKUP_STORAGE=b2` -> "TODO 未实现" + exit 1 (不静默)
- restore: insert user (14->15) -> restore 08-06 -> 14 (回退, 测试 user 消失); `CONFIRM_RESTORE` 缺失 -> exit 1
- `bash -n` 语法 OK (backup.sh + restore.sh)

### 关联
- T-FOLLOW-5 (部署编排): 复用 docker-compose + SSH 模式
- T-FOLLOW-7 (自动回滚): backup service 独立于 deploy, 不受回滚影响
- T-FOLLOW-9 (监控, 部分完成 2026-08-07): GH Actions health check 已做; backup workflow 成功率告警仍待做
- migrate.js (T-FOLLOW-1): 恢复后 schema_migrations 被备份状态覆盖, 需重跑 migrate

---

## 前端 (T057-T070, 2026-08-13)

### 技术栈
Vite 5 + Vue 3 (Composition API, `<script setup>`) + TypeScript + Vue Router 4 + Pinia + axios + socket.io-client

### 目录结构 (frontend/)
```
frontend/
├── package.json / vite.config.ts / tsconfig*.json / index.html
└── src/
    ├── main.ts / App.vue / env.d.ts
    ├── types/index.ts          # 对齐 REST + WS 契约的类型定义
    ├── router/index.ts         # 路由 + 鉴权守卫 (guest 页 vs 登录页)
    ├── stores/
    │   ├── auth.ts             # token/user 持久化(localStorage) + login/register/logout
    │   ├── player.ts           # profile/warehouse/characters/myCards
    │   ├── game.ts             # WS 连接 + 对战状态机(棋盘/手牌/回合/胜负) + T073 auto-join + T077 queueMatch/cancelMatch
    │   ├── gathering.ts        # 采集: skills/efficiency/activeTask + start/complete/cancel (T064)
    │   ├── processing.ts      # 加工: recipes/loadAll/process + lastMissing(缺料兜底) (T065)
    │   └── crafting.ts        # 制造: recipes/loadAll/craft(按 category 分发) (T066)
    ├── services/
    │   ├── http.ts             # axios 实例 + JWT 拦截 + 401 自动登出 + typed helpers
    │   └── api.ts              # 全域 REST 客户端 (authApi/playerApi/gatheringApi/...)
    ├── utils/
    │   ├── resources.ts        # 资源/材料中文名映射 (T064)
    │   ├── cards.ts            # 卡牌 effect 中文摘要 + CARD_TYPE_META + 打牌目标计算 (cardNeedsTarget/isAOE/computeCardTargets, T070/T072)
    │   └── movement.ts         # 移动范围 BFS (computeReachableCells, 对齐后端, T071)
    ├── components/
    │   ├── GatheringPanel.vue  # 采集面板: 技能列表 + 进度 + 领取/取消 + 轮询 (T064)
    │   ├── ProcessingPanel.vue # 加工面板: 配方卡 + input->output + 数量1/5/10 + 预算校验 (T065)
    │   ├── CraftingPanel.vue  # 制造面板: 3分类(卡牌/装备/消耗品) + 替代料 + 职业门槛 + 预算校验 (T066)
    │   ├── BattleBoard.vue   # 战棋棋盘: 9x9 CSS Grid + 基地(2,2/6,6) + 状态条 + cell-click + 格子内渲染 BattlePiece + 可移动格/可目标高亮 (T068/T069/T071/T072)
    │   ├── BattlePiece.vue   # 战棋棋子: 职业字+血量条(护盾)+能量pips+效果点+当前行动者环+敌我边框+选中脉冲环+可目标准星环 (T069/T071/T072)
    │   └── BattleHand.vue    # 战棋手牌: 角色头标+卡牌横排(类型色/费用/来源/效果摘要)+可出牌判定+card-click (T070)
    └── views/                  # Login/Register/HomeLayout/Home/Workshop(tab壳)/Warehouse/Characters/Cards/Battle(T068-T072渲染交互+T073 WS auto-join+T077 匹配面板)
```

### 关键设计
| 项 | 选择 |
|----|------|
| API 层 | axios 实例统一加 JWT + 401 自动登出重定向 + 剥离 `{success,data}` 信封；`httpGet/Post/Put/Delete` typed helpers 直接返回信封类型 |
| WS | socket.io `io('/', {auth:{token}})` 默认命名空间；连接时 JWT 鉴权，`connect_error` 处理鉴权失败 |
| 对战状态 | game store 订阅 board/ownHand/回合/胜负事件，响应式更新；`isMyTurn` 计算属性驱动操作 |
| 路由守卫 | 未登录 -> /login；guest 页(login/register)已登录 -> /home |
| 开发代理 | vite proxy: /api + /socket.io -> localhost:3000 (免 CORS) |
| 采集 (T064) | gathering store 封装 start/status/complete/cancel/efficiency；complete 成功后刷 player profile；组件 2s 轮询 status 检测后端定时器自动完成；错误按 message 文案分支（http 拦截器 reject response.data 丢 status） |
| 加工 (T065) | processing store 封装 recipes/process；即时加工无 duration，process 成功后刷 player profile（resources+materials 同步）；400 缺料经 errorHandler 把 ApiError.extra.missing 展开到响应顶层，store 捕获写入 lastMissing；组件客户端预算校验 canAfford/missingFor 提前禁用按钮，数量 1/5/10 分段选择；input 为资源(players.resources)/output 为材料(players.materials) |
| 制造 (T066) | crafting store 封装 recipes/craft，craft 按 recipe.category 分发到 card/gear/consumable 三端点（后端 result.success 模式非 throw，缺料/职业/超上限经 fail() 回 400/403，**无 missing 数组**仅 error 文案）；响应只含 materialsUsed 无 materials 快照 -> 成功+失败都刷 profile；input 为材料(players.materials)，input 可为替代料数组(任一组合满足即可，如回血药 iron_ingot 或 plank)；卡牌有 profession_required(查活角色职业)+max_quantity 上限；装备加 production_gear bonus(无 quantity，多次只叠 bonus)；组件按 3 分类 section 展示，替代料「或」连接，数量 1/5/10(装备强制1)，客户端预算校验+职业门槛 badge 禁用 |
| 手牌 (T070) | BattleHand 组件按 ownHand(Record<characterId, HandCard[]>) 每个 own 角色一组渲染；HandCard 运行时无 description，由 utils/cards.ts 的 effectSummary 把 effect JSONB 派生中文摘要（damage/aoe/range/shield/heal/movement/taunt）；可出牌判定 isCurrentActor&&isPlayPhase&&cost<=currentEnergy，当前行动者组高亮(accent 环)，能量不足卡 unaffordable 半透明，非行动组 dim；card-click emit {characterId,card} 供 T072 接入目标选择+WS(game.playCard)；ownHand 经 battle:state:full/hand WS 推送(T073 接入)，WS 未接前预览 mock 覆盖 8 卡型+public_pool 来源+能量不足分支 |
| 移动交互 (T071) | **后端 CharacterStatus 加 movement 字段**（characterStatusService: interface+baseInfo+DB SELECT，piece.movement 已在 Redis/DB 之前未广播）使前端可算范围。前端 utils/movement.ts computeReachableCells 复刻后端 bfsFindReachablePositions（4 方向无对角，maxDistance=movement，阻塞=occupied，起点穿透）；occupied 取 board.characters 中 position!=null（与后端 getAllBoardPositions 同源--getCharacterStatus.position 即派生自此，死棋死亡不移除位置故仍阻塞）；BattleView 选中状态机：canSelectActor(move 阶段+当前 actor 己方) -> 点 actor toggle 选中+BFS 算 movableCells -> 点高亮格 game.move(preview 本地更新 mockPositions/real WS) -> watch actor\|phase 字符串变化清选中(避免 board 刷新误清)；客户端范围仅 UX 提示，服务端 validateMovement 再校验，不匹配回 battle:move:error 优雅降级 |
| 打牌交互 (T072) | utils/cards.ts 加打牌分类(cardNeedsTarget 单体攻击/嘲讽, cardIsAOE, cardSupported)+ computeCardTargets(敌方+存活+射程内, 近战欧氏≤1.5/远程≤effect.range/嘲讽≤range??3, 对齐 validateAttack/validateTauntCard)；BattleHand 加 selectedCardDeckId 选中高亮 + unsupported 卡(defense/heal/movement 后端 T050 不支持)禁用+「暂不可用」标；BattleBoard/BattlePiece 加 targetableCharacterIds/isTargetable danger 准星脉冲环；BattleView 打牌状态机 canPlayCards(play 阶段+当前 actor 己方) -> onCardClick: AOE 直接 game.playCard / needsTarget 进目标选择模式(再点同卡取消) -> onPieceClick 目标模式优先(点可目标棋子 playCard+targetId/点其他取消) -> onCellClick 目标模式点空取消 -> 跳过出牌 game.skipPlay -> watch actor\|phase 清选中；AOE 无需选目标自动命中射程内全部；嘲讽强制目标等边界由服务端 getTauntRedirect 强制客户端不建模(回 battle:play_card:error 优雅降级) |
| WS 对战连接 (T073) | game store 的 battle:matched handler 加 joinBattle(payload.battleId) 自动加入对战房间（补齐 T057 连接层最后缺口；connect/disconnect + 全部 battle:state:full/board/session/hand/character/bases + opponent_joined/disconnected + end + move/play_card/skip_play/join:error handler 早已就绪于 T057）；matched=true 时后端 emit battle:matched -> handler 复位 matching/inQueue + 自动 emit battle:join -> 后端回 battle:join:ok + 推 battle:state:full(棋盘+ownHand+myCharacterIds 由 ownHand keys 推断)。**e2e**: node 脚本 2 socket.io-client 客户端经 ptidle_default 网络验证 matched->auto-join->join:ok->state:full(6棋子/3手牌/状态同步) 全链路通过 |
| 匹配队列界面 (T077) | game store 加 queueMatch/cancelMatch 并导出（queueMatch 调 matchApi.join 设 matching+inQueue=true；matched=true 依赖 WS handler(T073) auto-join，不在此复位 inQueue 防止 WS 事件未到时 UI 闪烁回「开始匹配」；失败回 lastError；cancelMatch 调 matchApi.leave 复位 matching/inQueue/matched）；BattleView 替换 T077 占位为匹配面板三态：game.matched->「已匹配进入战斗」/ game.inQueue->「匹配中」+取消按钮(调 cancelMatch)/ 空闲->「开始匹配」按钮(调 queueMatch)；预览(开发)按钮匹配中隐藏(v-if=!inQueue&&!matched) |

### 状态
- T057(初始化) / T058(路由) / T059(Pinia) / T060-T063(登录注册/主界面+离线弹窗): 骨架完成
- T064(采集界面): 完成 — GatheringPanel + gathering store + resources util + WorkshopView tab 壳；`npm run build` + `typecheck` 通过
- T065(加工界面): 完成 - ProcessingPanel + processing store + WorkshopView 挂载；`typecheck` 零错；`build` 通过；API smoke 全过（冶炼/木工/研磨×1 + smelting×5 + 缺料 400 missing 顶层）
- T066(制造界面): 完成 - CraftingPanel + crafting store + WorkshopView 挂载（工坊三子页全完成）；`typecheck` 零错；`build` 通过（WorkshopView chunk 14.55kB）；API smoke 全过（card/gear/consumable×1 + 法师火球卡×3缩放 + 职业卡 + 回血药替代料 + 缺料400无missing + 职业403 + 卡牌上限400边界）
- T067(仓库界面): 完成 - WarehouseView 实现（onMount fetchWarehouse + 资源/材料 section + 分类用量条 + 物品 grid）；`typecheck` 零错；`build` 通过（WarehouseView 0.25kB->3.34kB）；API smoke 全过（GET /warehouse 字段+数据正确 + 401 + 用量计算）
- T068(棋盘渲染): 完成 - BattleBoard.vue（9x9 CSS Grid + 基地(2,2/6,6)染色 + 状态条 round/step/phase/stars + 坐标轴 + cell-click 事件）+ BattleView 容器（接 game store.board，预览 mock 供 WS 未接前验证）；`typecheck` 零错；`build` 通过（BattleView 3.28kB）。**渲染技术 CSS Grid（非计划 Canvas/SVG）**：离散格子 + 后续点击交互(T071) + 主题一致。棋盘无 REST 状态端点（实时走 WS T073），契约靠编译期对齐 BoardStateEvent（与后端 battleStateBroadcaster 核实一致）
- T069(棋子渲染): 完成 - BattlePiece.vue（职业单字 战/弓/法 + 职业色 + 血量条按比例绿/黄/红 + 护盾段拼接+🛡N 徽章 + 能量 pips + 状态效果点 boost/mark/burn/taunt + 当前行动者发光环 + 敌我边框 own蓝/enemy红 + click emit 供 T071）+ BattleBoard 加 ownCharacterIds prop + pieceMap 位置->棋子映射 + 格子内渲染 + piece-click emit + BattleView 传 ownIds(preview?mock:store) + 充实 mock 6 棋子(含受损/护盾/被嘲讽/burn/mark/当前行动者验证各分支)；`typecheck` 零错；`build` 通过（BattleView 3.28kB->7.71kB，CSS 5.26kB）；dev server HTTP 200。**敌我区分**：CharacterStatus 无 side 字段，靠 myCharacterIds（ownHand keys）判定
- 据点对称调整 (T068/T069 后续): P1 基地 (3,3)->(2,2)，P2 基地保持 (6,6)，关于棋盘中心 (4,4) 对称。全栈改动 -- 后端 battleOutcomeService(BASES 数组+默认 bases JSON)/battleInitializationService/battleStateBroadcaster(类型+默认+广播参数) + 3 测试文件(battleOutcomeService 5 占领场景+BASES+beforeEach / battleStateBroadcaster 7 处 / battleActionService mock bases) + 前端 types/BattleBoard(isBase+baseSideAt)/BattleView mock。两据点 Chebyshev 半径 2 范围仅 (4,4) 单格重叠。jest 81/81 战棋套件全绿 + tsc 零错 + 前端 typecheck/build 通过
- T070(手牌渲染): 完成 - utils/cards.ts(CARD_TYPE_META + effectSummary 派生中文摘要) + BattleHand.vue(角色头标+卡牌横排 类型色/⚡费用/来源徽章 牌库-公共池/效果摘要 + 可出牌判定 isCurrentActor&&isPlayPhase&&cost<=energy + card-click emit) + BattleView 手牌区(每 own 角色一组 + 预览 mock 8 卡型全覆盖 + 阶段切换 move<->play 验证可点击态)；`typecheck` 零错；`build` 通过（BattleView 7.71kB->12.04kB，CSS 5.26kB->7.99kB）；dev server HTTP 200。**手牌数据源**: game.ownHand(WS battle:state:full/hand，T073 接入)，HandCard 运行时无 description 由 effect 派生
- T071(移动交互): 完成 - **后端** characterStatusService CharacterStatus 加 movement 字段(piece.movement 已存但之前未广播, +DB SELECT movement, +测试断言)；**前端** utils/movement.ts(computeReachableCells BFS 复刻后端) + types CharacterStatus 加 movement + BattleBoard(movableCells/selectedCharacterId prop + 可移动格高亮) + BattlePiece(选中脉冲环) + BattleView 选中状态机(canSelectActor + movableCells BFS + onPieceClick toggle + onCellClick 执行移动[preview 更新 mockPositions/real game.move] + watch actor|phase 清选中 + mock 加 movement + mockPositions reactive)；`typecheck` 零错；`build` 通过（BattleView 12.04kB->13.99kB，CSS 7.99kB->9.04kB）；后端 tsc 零错 + jest 4 战棋 suite 134/134 全绿；dev server HTTP 200。**关键**: occupied 用 position!=null 精确镜像后端 getAllBoardPositions(死棋死亡不移除位置仍阻塞)，客户端范围仅 UX 提示服务端 validateMovement 再校验
- T072(打牌交互): 完成 - utils/cards.ts 加 cardNeedsTarget/cardIsAOE/cardSupported + computeCardTargets(敌方+存活+射程内, 近战≤1.5/远程≤range/嘲讽≤range??3) + BattleHand(选中高亮 selectedCardDeckId + unsupported 卡禁用「暂不可用」) + BattleBoard/BattlePiece(targetableCharacterIds/isTargetable danger 准星脉冲环) + BattleView 打牌状态机(canPlayCards + onCardClick AOE直接打/needsTarget进目标模式 + onPieceClick目标模式优先 + onCellClick空格取消 + 跳过出牌 + watch 清选中)；typecheck 零错；build 通过(BattleView 13.99kB->16.57kB，CSS 9.04->10.15kB)；dev server HTTP 200。**关键**: defense/heal/movement 后端 T050 unsupported_card_type 故前端禁用; 嘲讽强制目标由服务端 getTauntRedirect 强制客户端不建模回 error 降级; AOE 无需选目标
- T073(WS对战连接): 完成 - game store battle:matched handler 加 auto-join(joinBattle)；e2e 2 客户端验证 matched->join->state:full 全链路通过
- T077(匹配队列界面): 完成 - game store queueMatch/cancelMatch + BattleView 匹配面板三态(进入中/匹配中+取消/开始匹配)；e2e 同 T073 通过。`typecheck` 零错；`build` 通过(BattleView 16.57kB->17.07kB)
- T074-T076(战棋其他交互) / T078(对战结算界面) / T079+T080(API 对接+JWT 管理, 审视确认实质完成) / T081(集成测试+Bug 修复) / T082(性能优化): 完成（详见 progress.md）
- 前端尚未有独立构建产物部署 (Caddy 静态托管 / 资源缓存 / 增量同步 待做)

## T082 性能优化 (2026-08-15)

### 后端

- **HTTP 压缩**: `index.ts` 挂 `compression()` 中间件(cors/json 之后、路由之前), 依赖 `compression@^1.8.1`(+`@types/compression`)。按 Accept-Encoding 协商 gzip, 大 JSON 响应(卡牌模板/玩家数据/战斗状态)传输体积显著降低。测试 `src/middleware/compression.test.ts`(gzip 生效 / identity 不压缩)。
- **优雅关闭**: SIGTERM/SIGINT handler(Docker stop/recreate 触发), shuttingDown 幂等标志防重入, 依序 `io.close()`(Socket.IO+底层 HTTP server, 停止接受新连接) -> `pool.end()`(PG) -> `disconnectRedis()`, 各步独立 try/catch 防连环失败, 完成后 `process.exit(0)`。修复停容器时 PG/Redis 连接泄漏与僵尸 socket。
- **crafting 事务化**(修 T081 已知③): `executeGearCrafting`/`executeConsumableCrafting` 改 `withTransaction` + 玩家行 `SELECT ... FOR UPDATE`(比 executeCardCrafting 更强--读也移入事务内)。gear 修 TOCTOU(原事务外 read->校验->write, 并发扣料丢失更新); consumable 修扣料与发消耗品分两条 execute 的中间失败不一致。PLAYER_NOT_FOUND/INSUFFICIENT_MATERIALS 以 `err.code` 抛出, 经 withTransaction 统一 ROLLBACK, 路由层 catch 映射回 `result.success=false` 契约不变。配方读取(静态缓存)与 gear 类型校验留事务外提前失败。+3 防回归 test(craftingService 34/34)。

### 前端

- **socket.io-client 延迟加载**: game store `connect()` 改 async + `await import('socket.io-client')`。原静态 import 经 App.vue->game store 链路把 socket.io 整个子图拉进主 chunk, 首屏(登录/主页/工坊)被迫下载; 改动态 import 后独立懒加载 chunk, 主 chunk(eager) 197KB->156KB, socket.io ~44KB 仅对战连接时下载。
- **vite manualChunks**: 仅把 vue 全家桶(vue/vue-router/pinia/@vue)拆 `vendor-vue` chunk(跨路由复用+业务代码变动不失效长期缓存); 其余 node_modules 返回 undefined 交回 Vite 默认拆分(动态 import 的 socket.io 传递依赖自动成懒 chunk, 静态 import 的 axios 并入引用方)。**坑**: 不在 manualChunks 强行归类 socket.io 依赖, 否则传递依赖被错误并入 eager vendor 破坏延迟加载。

### 验证

后端 jest 40/43 suite 681/709(3 env-fail suite 不变: socketServer/authController/wsValidation.integration, ECONNREFUSED 环境非代码); 前端 build + typecheck 全过。

*文档版本：v1.63*
*最后更新：2026-08-15*
