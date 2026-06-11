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

### Mock 约定

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

### 适用范围

- ✅ `src/routes/gathering.integration.test.ts`（2026-06-10 修复）
- 触发 `idleQueueService` 或 `battleService` Redis 调用的集成测试都应遵循此约定

### T035/T036 history 误读澄清

T035/T036 history 提到「集成测试 8 个失败」是 PostgreSQL 5433 / Redis 6379 端口未启动的**基线连接错误**。环境拉起后，DB 相关全通；Redis 相关暴露真实缺陷——即上文单例未连接问题，**已修复**。

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
| `userId: string` | 握手鉴权通过 | 当前 `connection` / `disconnect` handler；**T046 房间管理基于此推送** |
| `username: string` | 握手鉴权通过 | 日志 / 调试 |
| `battleId?: string` | **T046 才写入** | T046+ 房间管理；T045 不写 |

### T045 范围 vs T046+ 范围

| 项 | T045 | T046 | T047 |
|----|------|------|------|
| 握手期鉴权 | ✅ | — | — |
| `socket.data.userId/username` | ✅ | — | — |
| 房间订阅 / `socket.join(battleId)` | ❌ | ✅ | — |
| `io.to(userId).emit('battle:matched')` | ❌ | ✅ | — |
| 棋盘状态 / 手牌 / 能量广播 | ❌ | ❌ | ✅ |
| 重连 / heartbeat / 速率限制 | ❌ | ❌ | ❌（运维层） |
| Redis adapter（跨节点） | ❌ | ❌ | ❌（单体 MVP） |

### 文件清单

| 路径 | 改动 |
|------|------|
| `src/index.ts` | T045 改造：`app.listen` → `http.createServer(app)` + `new IOServer(httpServer, { cors: { origin: '*' } })` + `httpServer.listen(PORT)` 内调 `initializeSocketServer(io)` |
| `src/socket/socketServer.ts` | **新建**：`initializeSocketServer(io)` —— `io.use(verifyClientToken)` + `io.on('connection')` 日志 + `socket.on('disconnect')` 日志 |
| `src/socket/authMiddleware.ts` | **新建**：`verifyClientToken(socket, next)` —— 读 `socket.handshake.auth.token` → `jwt.verify` → 写 `socket.data.userId/username` |
| `src/socket/socketServer.test.ts` | **新建**：3 个集成测（socket.io-client 真连真断 + `listen(0)` 随机端口隔离） |
| `src/config/jwt.ts` | **新建**（simplify pass）：集中导出 `JWT_SECRET` / `JWT_EXPIRES_IN`，消除 `process.env.JWT_SECRET || '...'` 重复 3 处 |
| `src/middleware/auth.ts` | 改 1 行：改用 `import { JWT_SECRET } from '../config/jwt'` |
| `src/middleware/auth.test.ts` | 改 1 行：改用 `JWT_SECRET` 常量 |
| `src/services/authService.ts` | 改 3 行：改用 `JWT_SECRET` / `JWT_EXPIRES_IN` 常量 |
| `backend/package.json` | devDep 新增 `socket.io-client@^4.7.2`（与 server 端 socket.io 4.7.x 同号） |

---

*文档版本：v1.30*
*最后更新：2026-06-11*
