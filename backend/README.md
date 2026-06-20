# PtIDLE Backend

Node.js + Express + TypeScript + Socket.IO + PostgreSQL + Redis

## 🚀 快速启动

```bash
# 1. 前置：PG/Redis 已在 docker compose 起来
docker compose up -d

# 2. 装依赖
npm install

# 3. 应用迁移（首次或 schema 变更后）
npm run db:migrate

# 4. 启动 dev server
npm run dev
```

启动成功看到：
```
✅ PostgreSQL connected
[migrations] (静默 — 全部已 applied)
✅ Redis connected
✅ Gathering config initialized
HTTP+WS server running on port 3000
```

> 启动时如果看到 `[migrations] ⚠️  N pending migration(s) detected: ...`
> 说明 DB 缺迁移 → 执行 `npm run db:migrate` 修复。**不会阻塞启动**（fail-open）。

---

## 📂 目录结构

```
backend/src/
├── index.ts                    # HTTP+WS 入口，启动期检测 migrations
├── config/
│   ├── database.ts            # PG pool + query / queryOne / execute / withTransaction
│   ├── redis.ts               # Redis client 单例
│   └── env.ts                 # 环境变量加载
├── controllers/                # Express controllers (auth / battle / player / ...)
├── services/                   # 业务逻辑层
│   ├── battleService          # 战棋核心 (validateMove / validateAttack / AOE / AOE)
│   ├── battleActionService    # 出牌 orchestrator (17 步流水线)
│   ├── battleSettlementService# 结算 + 幂等
│   ├── matchmakingService     # 撮合 (tryMatch + Lua)
│   ├── professionMechanicService # 战士/弓手/法师职业机制
│   └── ...
├── socket/
│   ├── socketServer.ts        # WS server 初始化
│   ├── battleRoom.ts          # battle:join/move/play_card/skip_play 4 个 handler
│   ├── wsValidation.ts        # T055 跨切校验 (room/status/rate-limit)
│   └── broadcaster.ts         # 实时状态推送
├── routes/                     # Express routes (REST API)
├── middleware/                 # JWT 鉴权 / 错误处理
├── scripts/
│   └── migrate.ts             # 迁移 runner (T-FOLLOW-1)
└── migrations/                 # 9 个 SQL 迁移 (001-010, 004 故意空缺)
```

**统计**：51 源文件 + 42 测试文件 + 9 SQL 迁移。

---

## 🛠 npm scripts

| 命令 | 说明 |
|------|------|
| `npm run dev` | nodemon + ts-node 热重载 |
| `npm run build` | tsc 编译到 `dist/` |
| `npm start` | 运行 `dist/index.js`（生产模式） |
| `npm test` | 跑全部 Jest 测试（**注意：不会清理**，`cd backend && npx jest <file>` 推荐指定文件） |
| `npm run test:coverage` | 覆盖率报告 |
| `npm run lint` | ESLint 检查 |
| `npm run lint:fix` | ESLint 自动修复 |
| `npm run db:migrate` | 应用所有 pending migrations（幂等） |
| `npm run db:status` | 查看迁移状态（不应用） |

> ⚠️ **dev DB 启动顺序很重要**：`docker compose up -d` → `npm install` → `npm run db:migrate` → `npm run dev`。
> 漏掉 `db:migrate` 会导致 schema 缺失（已在 T-FOLLOW-1 实施自动化）。

---

## 🗄 数据库

- **连接**：见 `docker-compose.yml`（PG 5433 / Redis 6379）
- **Schema**：`src/migrations/*.sql`（001_initial → 010_t054_settlement）
- **跟踪表**：`schema_migrations`（自动建，记录已应用 migration）
- **手动操作**（罕见）：
  ```bash
  # 重置 DB（dev only）
  docker compose down -v
  docker compose up -d
  npm run db:migrate
  ```

---

## 🧪 测试

```bash
# 单文件
npx jest src/services/battleService.test.ts --forceExit

# 模式匹配
npx jest src/socket --forceExit

# 全量
npx jest --forceExit

# 覆盖率
npm run test:coverage
```

### 测试结构

- **单元测试**：mock 掉 PG/Redis，测纯逻辑。多数 service 测试在此。
- **集成测试**：真实 PG（5433）+ 真实 Redis（6379），需要 docker compose 在线。命名 `*.integration.test.ts`。
- **WS handler 测试**：mock socket.io socket + DB + Redis，验证事件 emit 行为。

### 已知基线

- **T-FOLLOW-2 收尾**：42 suite / 701 test 全绿
- 集成测试依赖 `ptidle-postgres-1`（5433）+ `ptidle-redis-1`（6379）运行中
- 单测可独立跑（不依赖 docker）

---

## 🔌 API 概览

完整列表见 `src/routes/` 和 `src/controllers/`。

### REST 端点（部分）

| Method | Path | 说明 |
|--------|------|------|
| POST | `/api/auth/register` | 注册 |
| POST | `/api/auth/login` | 登录（返回 JWT） |
| GET | `/api/player` | 玩家数据 |
| POST | `/api/gathering/start` | 开始采集 |
| GET | `/api/gathering/progress` | 采集进度 |
| POST | `/api/match/queue` | 入匹配队列 |
| GET | `/api/match/queue` | 查询匹配状态 |
| DELETE | `/api/match/queue` | 取消匹配 |
| POST | `/api/battle/result` | 对战结算（幂等） |
| GET | `/health` | 健康检查 |

### WebSocket 事件

WS 握手期在 `auth` 中传 JWT。连接后默认加入 `user:{userId}` 房间。

| 事件 | 方向 | 说明 |
|------|------|------|
| `battle:join` | C→S | 加入对战房间（`battle:{battleId}`） |
| `battle:move` | C→S | 移动棋子 |
| `battle:play_card` | C→S | 出牌（attack / tactical） |
| `battle:skip_play` | C→S | 跳过出牌阶段 |
| `battle:state` | S→C | 全量状态推送（init 后） |
| `battle:state_update` | S→C | 增量状态更新 |
| `battle:phase_change` | S→C | 阶段切换（move → play → end） |
| `battle:X:error` | S→C | 错误（X = move / play_card / skip_play） |

---

## 🐛 调试技巧

```bash
# 1. 看 dev DB 状态
npm run db:status

# 2. 跑特定测试（带 console.error 显示）
npx jest src/socket/wsValidation.test.ts --forceExit --verbose

# 3. 集成测试需要 PG/Redis 在线
docker compose ps

# 4. 单独跑 migrate（看每条 SQL 走没走）
npx ts-node src/scripts/migrate.ts
```

---

## 📚 相关文档

- 仓库根 `README.md` — 项目概览 + 快速启动
- `memory-bank/architecture.md` — 完整架构 / API / DB schema
- `memory-bank/specs.md` — 产品需求
- `memory-bank/progress.md` — 任务进度
- `memory-bank/history.md` — 工作日志
