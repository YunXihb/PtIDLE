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
- 每10秒检查一次所有玩家的采集任务
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
```

---

*文档版本：v1.3*
*最后更新：2026-03-11*
