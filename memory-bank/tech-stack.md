# PtIDLE 技术栈文档 (Tech Stack)

**项目**：PtIDLE - 战棋挂机游戏
**版本**：v1.0
**日期**：2026-03-10

---

## 一、技术选型原则

### 1.1 选型标准
- **简洁性**：优先选择成熟、社区支持良好的技术
- **匹配性**：技术选型需匹配项目需求和团队能力
- **可扩展性**：架构需支持未来功能扩展
- **开发效率**：Vibe Coding 模式下，优先选择开发效率高的框架

### 1.2 项目特点
- 单人开发 + AI 辅助（Vibe Coding）
- Web 全栈应用
- 内部体验娱乐，非商业化
- 实时 PVP + 离线挂机

---

## 二、前端技术栈

### 2.1 核心框架

| 技术 | 版本 | 用途 | 选择理由 |
|------|------|------|----------|
| **Vue 3** | ^3.4 | 渐进式前端框架 | 上手简单，Composition API 适合 AI 生成代码，生态成熟 |
| **Vite** | ^5.0 | 构建工具 | 极速热更新，开发体验好，配置简单 |
| **Pinia** | ^2.1 | 状态管理 | Vue 3 官方推荐，比 Vuex 更轻量简洁 |

### 2.2 UI 与样式

| 技术 | 用途 | 选择理由 |
|------|------|----------|
| **原生 CSS** | 样式编写 | 项目规模适中，原生 CSS 足够，避免引入重型 UI 框架 |
| **CSS Variables** | 主题管理 | 便于后续主题切换 |

### 2.3 通信与工具

| 技术 | 用途 |
|------|------|
| **Axios** | HTTP 请求 |
| **Socket.io-client** | WebSocket 客户端 |
| **Vue Router** | 路由管理 |

### 2.4 开发工具

| 技术 | 用途 |
|------|------|
| **ESLint** | 代码规范 |
| **Prettier** | 代码格式化 |

---

## 三、后端技术栈

### 3.1 运行时与框架

| 技术 | 版本 | 用途 | 选择理由 |
|------|------|------|----------|
| **Node.js** | ^20 | 运行时 | 与前端语言统一，WebSocket 支持好 |
| **Express** | ^4.18 | Web 框架 | 简洁灵活，中间件生态丰富 |
| **Socket.io** | ^4.7 | WebSocket |  rooms、events 等功能完善，降级支持好 |

### 3.2 数据存储

| 技术 | 用途 | 选择理由 |
|------|------|----------|
| **PostgreSQL** | 核心数据 | 关系型数据可靠，支持复杂查询 |
| **Redis** | 缓存/会话 | 性能高，支持复杂数据结构，适合离线计算 |

### 3.3 认证与安全

| 技术 | 用途 |
|------|------|
| **JWT** | 用户认证 |
| **bcryptjs** | 密码加密 |

### 3.4 开发工具

| 技术 | 用途 |
|------|------|
| **TypeScript** | 类型安全 |
| **nodemon** | 开发热重载 |
| **dotenv** | 环境变量管理 |

---

## 四、部署技术栈

### 4.1 容器化

| 技术 | 用途 |
|------|------|
| **Docker** | 容器化部署 |
| **docker-compose** | 多容器编排 |

### 4.2 进程管理

| 技术 | 用途 |
|------|------|
| **PM2** | Node.js 进程管理 |

---

## 五、项目结构

### 5.1 整体目录结构

```
ptidle/
├── backend/                 # 后端项目
│   ├── src/
│   │   ├── controllers/    # 控制器
│   │   ├── models/         # 数据模型
│   │   ├── routes/         # 路由
│   │   ├── services/       # 业务逻辑
│   │   ├── middleware/     # 中间件
│   │   ├── config/        # 配置文件
│   │   └── index.js       # 入口文件
│   ├── package.json
│   └── .env.example
│
├── frontend/                # 前端项目
│   ├── src/
│   │   ├── components/    # 组件
│   │   ├── views/         # 页面
│   │   ├── stores/        # Pinia 状态
│   │   ├── services/      # API 服务
│   │   ├── router/        # 路由配置
│   │   ├── assets/        # 静态资源
│   │   └── App.vue
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
│
├── docker-compose.yml       # Docker 编排
└── README.md
```

### 5.2 后端结构

```
backend/src/
├── config/
│   ├── database.js         # PostgreSQL 配置
│   ├── redis.js            # Redis 配置
│   └── env.js              # 环境变量
├── controllers/
│   ├── authController.js   # 认证
│   ├── playerController.js # 玩家
│   ├── gatheringController.js  # 采集
│   ├── craftingController.js   # 制造
│   ├── battleController.js     # 战棋
│   └── matchController.js      # 匹配
├── models/
│   ├── User.js             # 用户模型
│   ├── Player.js           # 玩家模型
│   ├── Character.js        # 棋子模型
│   ├── Card.js             # 卡牌模型
│   └── Recipe.js           # 配方模型
├── services/
│   ├── authService.js      # 认证服务
│   ├── idleService.js      # 挂机计算
│   ├── battleService.js    # 战棋逻辑
│   └── matchService.js     # 匹配服务
├── middleware/
│   ├── authMiddleware.js   # JWT 验证
│   └── errorMiddleware.js  # 错误处理
├── routes/
│   ├── authRoutes.js
│   ├── playerRoutes.js
│   ├── gatheringRoutes.js
│   ├── craftingRoutes.js
│   ├── battleRoutes.js
│   └── matchRoutes.js
├── socket/
│   └── battleHandler.js    # WebSocket 处理器
└── index.js
```

### 5.3 前端结构

```
frontend/src/
├── components/
│   ├── common/             # 通用组件
│   ├── game/               # 游戏组件
│   │   ├── Board.vue       # 棋盘
│   │   ├── Piece.vue       # 棋子
│   │   └── Card.vue        # 卡牌
│   └── ui/                 # UI 组件
├── views/
│   ├── LoginView.vue       # 登录
│   ├── RegisterView.vue    # 注册
│   ├── HomeView.vue        # 主界面
│   ├── WorkshopView.vue    # 工坊
│   ├── BattleView.vue      # 战棋
│   ├── WarehouseView.vue   # 仓库
│   └── QueueView.vue       # 匹配队列
├── stores/
│   ├── authStore.js        # 认证状态
│   ├── playerStore.js      # 玩家状态
│   └── gameStore.js        # 游戏状态
├── services/
│   ├── api.js              # Axios 实例
│   ├── authService.js      # 认证 API
│   ├── playerService.js    # 玩家 API
│   └── gameService.js      # 游戏 API
├── router/
│   └── index.js            # 路由配置
├── assets/
│   └── styles/
│       └── main.css        # 全局样式
└── App.vue
```

---

## 六、技术选型决策记录

### 6.1 为什么选择 Vue 3 而非 React？
- Vue 3 的 Composition API 与 AI 生成代码模式更匹配
- Vue Router 和 Pinia 集成更紧密
- 模板语法对 AI 生成的代码可读性更好

### 6.2 为什么选择 Express 而非 NestJS？
- Express 更轻量，配置简单
- 适合小型项目和快速迭代
- Vibe Coding 模式下，简洁的框架更易生成和修改代码

### 6.3 为什么选择 PostgreSQL 而非 MongoDB？
- 项目数据结构相对固定、资源、（玩家卡牌）
- 关系型数据更适合复杂查询（配方、材料流转）
- PostgreSQL JSON 支持也为灵活数据提供扩展

### 6.4 为什么需要 Redis？
- 会话存储：高速读写
- 离线计算：作为计算引擎
- 实时状态：PVP 对战时的状态缓存

### 6.5 为什么 REST + WebSocket 而非纯 WebSocket？
- REST 适合非实时操作（采集、制造、仓库）
- WebSocket 仅用于 PVP 实时对战
- 分离简化了架构复杂度

---

## 七、环境变量配置

### 7.1 后端 (.env)

```bash
# Server
PORT=3000
NODE_ENV=development

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=ptidle
DB_USER=postgres
DB_PASSWORD=your_password

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# JWT
JWT_SECRET=your_jwt_secret
JWT_EXPIRES_IN=7d

# CORS
CORS_ORIGIN=http://localhost:5173
```

### 7.2 前端 (.env)

```bash
VITE_API_BASE_URL=http://localhost:3000
VITE_WS_URL=http://localhost:3000
```

---

## 八、技术风险与应对

| 风险 | 影响 | 应对措施 |
|------|------|----------|
| 单人开发效率 | 中 | 选择简洁框架，依赖 AI 辅助 |
| 实时对战复杂度 | 高 | 后端权威校验，前端即时反馈 |
| 离线收益计算 | 中 | Redis + 定时任务处理 |
| 数据库性能 | 低 | 初期数据量小，PostgreSQL 足够 |

---

*文档版本：v1.0*
*最后更新：2026-03-10*
