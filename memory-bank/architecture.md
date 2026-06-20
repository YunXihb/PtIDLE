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
- 固定坐标: (3,3) + (6,6) —— 9x9 棋盘对角线
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

*文档版本：v1.41*
*最后更新：2026-06-20*
