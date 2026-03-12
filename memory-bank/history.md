# PtIDLE 工作日志 (History)

> 记录每个任务阶段的 Prompt、思考和意外情况

---

## 2026-03-11 - 任务：离线收益系统 (T010-T011)

### Prompt
实现 T010 离线收益计算服务和 T011 登录时离线收益结算 API，包含：
- 离线收益计算逻辑（最大24小时，资源产出速率）
- POST /api/player/offline-claim 路由
- 仓储上限处理

### 思考
- 利用 players.last_offline 字段记录离线时间
- 铁矿石/原木产出 1个/分钟，煤炭/树液/荧光菇 0.5个/分钟
- 仓储上限默认 1000，超出部分溢出
- 计算逻辑：离线时间 → clamp 到最大时间 → 按速率产出 → 应用仓储上限

### 意外
无

---

## 2026-03-11 - 任务：获取玩家数据 API (T009)

### Prompt
实现获取玩家完整数据的 API，包括资源、材料、棋子列表等信息

### 思考
- 使用 JWT 认证保护路由
- 玩家表 + 棋子表联表查询
- 返回完整的玩家资料结构

### 意外
无

---

## 2026-03-11 - 任务：集成测试和端到端测试

### Prompt
添加集成测试和端到端测试覆盖主要 API

### 思考
- 使用 supertest 模拟 HTTP 请求
- 集成测试覆盖认证路由和玩家路由
- E2E 测试覆盖注册、登录、获取玩家数据流程

### 意外
无

---

## 2026-03-11 - 任务：玩家初始化逻辑 (T008)

### Prompt
实现玩家注册后自动初始化玩家数据（创建 players 记录和 3 个棋子）

### 思考
- 注册流程中调用 initializePlayer
- 创建玩家记录：资源、材料、仓储上限初始化为默认值
- 创建 3 个棋子：战士、弓手、法师，属性各不同

### 意外
无

---

## 2026-03-11 - 任务：JWT 认证中间件 (T007)

### Prompt
实现 JWT 认证中间件，保护需要登录的 API

### 思考
- 使用 jsonwebtoken 库
- Bearer token 验证
- 解析用户信息到 req.user

### 意外
无

---

## 2026-03-12 - 任务：采集技能数据模型 (T012)

### Prompt
实现采集技能数据模型，从数据库读取技能配置：
- 创建 skillService.ts 从 gathering_skills 表读取技能
- 修改 gatheringService.ts 使用数据库配置（带缓存）
- 创建技能查询 API（GET /api/skills/gathering）
- 单元测试覆盖

### 思考
- 技能配置存储在 gathering_skills 数据库表
- 使用 5 分钟内存缓存避免频繁查询
- gatheringService.getConfig() 改为异步，自动初始化配置
- API 路由：GET /api/skills/gathering 和 /api/skills/gathering/:type

### 意外
集成测试需要 mock skillService，否则会因数据库连接问题失败

---

## 2026-03-12 - 任务：加工配方数据模型与服务层 (T016)

### Prompt
实现 T016 加工配方数据模型和服务层：
- 创建 processingService.ts（从 processing_recipes 表读取配方，5分钟缓存）
- 创建 processing.ts 路由（GET /api/processing/recipes, GET /api/processing/recipes/:type, POST /api/processing/process）
- 在 index.ts 注册路由
- 单元测试覆盖

### 思考
- 参考 skillService.ts 的实现模式
- processing_recipes 表包含 type (smelting/carpentry/grinding)、input、output、efficiency 字段
- POST /api/process 需要认证，检查输入材料是否足够，扣除输入并添加输出到 materials
- 初始配方：冶炼(iron_ore+coal→iron_ingot)、木工(wood→plank)、研磨(herb→herb_powder)

### 意外
修复了 AuthRequest.userId 类型错误（应为 req.user?.userId）
