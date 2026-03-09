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
    │   ├── redis.ts         # Redis 客户端配置
    │   └── env.ts           # 环境变量加载
    ├── controllers/         # 控制器目录（处理请求）
    ├── models/              # 数据模型目录（数据库表映射）
    ├── services/            # 业务逻辑目录
    ├── middleware/          # 中间件目录
    ├── routes/              # 路由目录
    └── socket/              # WebSocket 处理器目录
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

## 当前状态

- T001, T002 已完成：项目初始化 + TypeScript + ESLint 配置

---

*文档版本：v1.0*
*最后更新：2026-03-10*
