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
- **T018 已完成**：仓库资源查询 API (GET /api/warehouse)
- T019-T025 已完成

---

*文档版本：v1.10*
*最后更新：2026-03-19*
