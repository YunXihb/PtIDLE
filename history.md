# PtIDLE 项目工作流日志 (Prompt History)

> 此文件记录项目开发过程中的 Prompt 与执行上下文
> 用于追踪需求变更、架构决策和踩坑记录

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

*日志持续更新中...*
