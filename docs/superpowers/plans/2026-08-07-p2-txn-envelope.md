# P2 代码改进 批次1：注册事务化 + 响应包裹统一

**日期**：2026-08-07
**范围**：用户选「事务化+响应包裹 (推荐)」；zod 字段校验 + REST 统一留下一批。

## 背景
- `authService.createUser` 的 INSERT user + `initializePlayer`（INSERT players + 3× characters）是 5 次独立 `execute`（各自 auto-commit），中间失败留孤立 user（re-register 撞 `UserAlreadyExistsError`，永不能玩）。
- 响应格式不统一：4 controller 用 `{success,data}` 信封，8 inline route 混用裸数据 / `{error}` / `{success:true,message}` / inline 500 catch。错误响应缺 `success:false`。
- 测试套件早已把 `{success,data}`/`{success,error}` 当事实标准（70× body.data、42× body.error、33× body.success），仅 ~10 处裸字段断言是偏差。

## 方案

### P2-1 注册事务化
- `playerService.initializePlayer(userId, client?: PoolClient)`：可选 client，有则 `client.query`，无则 `execute`（向后兼容旧调用与单测）。
- `authService.createUser`：password hash 留事务外（CPU 密集），`withTransaction(async client => { existence check + INSERT user + initializePlayer(userId, client) })`。
- 测试：三个 mock DB 的测试文件（authService.test / auth.integration.test / e2e.test）补 `withTransaction` mock（委托 fn(mockClient)），重写 register 断言（client.query 调用，索引 +1）；新增注册回滚回归用例。
- 真库 smoke：_smoke_txn.ts 验证 commit/duplicate/ROLLBACK。

### P2-2 响应包裹统一
- 新增 `src/utils/http.ts`：`ok(res, data, status=200)` -> `{success:true,data}`；`fail(res, status, error)` -> `{success:false,error}`。
- `index.ts` 全局错误中间件 body 加 `success:false`（保留 500 + 生产脱敏）。
- 12 routes + 4 controllers 全部走 ok()/fail()：裸数据 -> ok，`{success:true,data}` -> ok，`{error}` -> fail（加 success:false），`{success:false,error}` -> fail。
- 保留少数刻意顶层字段（有契约）：matchmaking `matched`/`status`、cards `/my/list` `pagination`、gathering status 空任务 `message`、processing 缺料 `missing`、matchmaking 409 `data.battleId`。
- inline try/catch 结构保留；next(error) + ApiError 留 REST 统一批次。错误消息原值保留。

## 验证
- tsc --noEmit 零错。
- jest 703/703 全绿（702 + 1 注册回滚回归用例）。
- 真库 smoke：[1] 注册原子提交 user+1player+3chars；[2] 重复拒 UserAlreadyExistsError 无 orphan；[3] withTransaction 抛错后 ROLLBACK 留 0 行。

## 范围外（下一批）
- zod 字段校验（用户已选 zod）。
- REST 统一（next(error) + ApiError + 状态码 + 路由命名审计）。
- 切新 release tag / 部署（outward-facing，需用户确认）。
