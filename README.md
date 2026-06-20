# PtIDLE

> 集成战棋玩法的挂机游戏（Idle + Tactical Chess）
> 核心特色：「所玩即所造」—— 玩家通过挂机系统深度定制卡牌与装备，在公平的战棋对局中比拼策略。

**项目状态**：PvP 3v3 战棋闭环已通（T042-T055 撮合→战场初始化→移动/打牌→回合→胜负→结算）。

## 技术栈

| 类别 | 技术 |
|------|------|
| 后端 | Node.js 20+ / Express / TypeScript |
| 数据库 | PostgreSQL 16（端口 5433） |
| 缓存/队列 | Redis 7（端口 6379） |
| 实时 | Socket.IO 4.x（HTTP+WS 同 server，握手期 JWT 鉴权） |
| 测试 | Jest + ts-jest + supertest |

完整规格见 [`memory-bank/specs.md`](memory-bank/specs.md)，
架构见 [`memory-bank/architecture.md`](memory-bank/architecture.md)。

---

## 🚀 快速启动（4 步）

```bash
# 1. 启动 PostgreSQL + Redis（docker compose）
docker compose up -d

# 2. 安装依赖
cd backend && npm install

# 3. 应用数据库迁移（首次或 schema 变更后必跑）
npm run db:migrate

# 4. 启动后端（dev 模式，含 nodemon 热重载）
npm run dev
```

启动后访问 <http://localhost:3000/health> 验证：
```json
{ "status": "ok", "services": { "database": "unknown", "redis": "unknown" } }
```

> 💡 **如果 npm run dev 启动时出现 migrations 警告**，提示有 N 个 pending migrations → 再次执行 `npm run db:migrate` 即可。
> 健康检查不会因缺 migration 而失败（fail-open）。

---

## 📁 项目结构

```
PtIDLE/
├── backend/              # Node.js + Express + TypeScript 后端
│   ├── src/
│   │   ├── scripts/migrate.ts    # 迁移 runner (npm run db:migrate)
│   │   ├── migrations/           # 9 个 SQL 迁移文件 (001-010, 004 故意空缺)
│   │   ├── config/               # PG/Redis/Env 配置
│   │   ├── controllers/          # Express controllers
│   │   ├── services/             # 业务逻辑 (battle / gathering / matchmaking ...)
│   │   ├── socket/               # Socket.IO 房间/handler/validator
│   │   └── index.ts              # HTTP+WS 入口
│   ├── jest.config.js
│   ├── tsconfig.json
│   └── package.json
├── docker-compose.yml    # PG 5433 + Redis 6379
├── memory-bank/          # 设计文档（架构 / 规格 / 进度 / 历史日志）
│   ├── architecture.md
│   ├── specs.md
│   ├── progress.md
│   └── history.md
└── docs/                 # 杂项文档
```

---

## 🛠 常用命令

```bash
# 数据库
docker compose up -d              # 启动 PG + Redis
docker compose down               # 停止
npm run db:migrate                # 应用所有 pending migrations
npm run db:status                 # 查看当前迁移状态

# 后端开发
npm run dev                       # nodemon + ts-node（热重载）
npm run build                     # 编译到 dist/
npm start                         # 运行编译产物
npm test                          # 跑全部测试
npm run test:coverage             # 覆盖率
npm run lint                      # ESLint
```

详见 [`backend/README.md`](backend/README.md)。

---

## 🧪 验证步骤（smoke test）

1. `docker compose up -d` ← PG/Redis 在线
2. `cd backend && npm install` ← 依赖装好
3. `npm run db:migrate` ← 9/9 applied, 0 pending
4. `npm run dev` ← 看到 `HTTP+WS server running on port 3000`
5. `curl http://localhost:3000/health` ← 返回 ok

---

## 📝 文档

| 文档 | 说明 |
|------|------|
| [`memory-bank/specs.md`](memory-bank/specs.md) | 产品需求（功能 / 非功能 / 棋类对战 / 挂机工坊） |
| [`memory-bank/architecture.md`](memory-bank/architecture.md) | 架构设计（DB 表 / 模块 / API / WS 事件） |
| [`memory-bank/progress.md`](memory-bank/progress.md) | 任务进度（待开发 / 开发中 / 已完成） |
| [`memory-bank/history.md`](memory-bank/history.md) | 工作日志（每次任务的 prompt / 思考 / 意外） |
| [`memory-bank/tech-stack.md`](memory-bank/tech-stack.md) | 技术栈细节 |
| [`memory-bank/implementation-plan.md`](memory-bank/implementation-plan.md) | 实施计划 |

---

## 🤝 贡献

开发流程（见 `CLAUDE.md`）：
1. 读 `memory-bank/specs.md` + `architecture.md`
2. AI 生成代码 → 用户跑测试验证
3. 更新 `memory-bank/progress.md` + `architecture.md`
4. Git 提交（不 push）→ 用户审阅后 push

**CLAUDE.md 规则 4**：未经用户批准，禁止 push 到远端仓库。
