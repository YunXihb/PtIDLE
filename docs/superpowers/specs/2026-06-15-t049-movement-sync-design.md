# T049 移动操作同步 — 设计文档

> **For agentic workers:** This is a design document. Implementation plan will be created after spec approval.

**Goal:** 实现 3v3 战棋对战中的移动操作同步 —— 玩家在 WebSocket 上发 `battle:move` 事件，服务端验证合法性、执行棋子移动、广播棋盘状态、自动推进 phase `move` → `play`。

**Architecture:** 新增 `battleActionService` 模块封装「验证 + 执行 + 广播 + 阶段推进」流水；`battleRoom.ts` 增加 `handleBattleMove` 薄壳 handler；`socketServer.ts` 注册 `battle:move` 事件。

**Tech Stack:** Node.js + TypeScript + Express + Socket.io + PostgreSQL + Redis（v4 client）+ Jest + ts-jest

**Spec:** 依赖 T033（棋盘）、T034（移动判定 + 移动原子操作）、T036（回合流程状态机）、T047（broadcaster 函数库）

---

## 1. 触发流程

### 1.1 客户端发送
```typescript
socket.emit('battle:move', {
  battleId: 'uuid',
  characterId: 'uuid',
  toX: 5,
  toY: 3,
});
```

### 1.2 服务端链路
```
socket.on('battle:move')
  → handleBattleMove(io, socket, payload)
    → executeMove(battleId, characterId, toX, toY, userId)
      → getDbSessionState(battleId)         // 1. 读 session
      → 验证 phase === 'move'                // 2. phase check
      → 验证 actor match                     // 3. 验证 payload.characterId === current_actor_id
      → listCharactersInBattle(battleId)     // 4. 查 userId
      → 验证 userId match                    // 5. 验证 userId === character.userId
      → validateMovement(...)                // 6. BFS 路径合法
      → moveCharacter(...)                   // 7. 原子 Redis positions HASH 更新
      → broadcastBoardState(io, battleId)    // 8. 广播 board
      → completeMovePhase(battleId)          // 9. phase 'move' → 'play'
      → return { success: true }
    → handleBattleMove 根据 success emit
```

### 1.3 成功响应
- 不 emit 任何"成功"事件给 caller（语义：phase 推进 + board 广播已足够）
- `battle:state:board` 事件被 room 内所有 socket 接收（T047 既有）

### 1.4 失败响应
- emit `battle:move:error` 给 caller（不是 room-wide）
- Payload: `{ battleId, error: 'not_in_move_phase' | 'not_current_actor' | 'not_owner' | 'invalid_path' | 'move_failed' | 'internal_error' }`

---

## 2. 模块设计

### 2.1 `src/services/battleActionService.ts`（新建）

**导出**：
```typescript
export type MoveResult =
  | { success: true }
  | { success: false; error: MoveError };

export type MoveError =
  | 'not_in_move_phase'
  | 'not_current_actor'
  | 'not_owner'
  | 'invalid_path'
  | 'move_failed';

export async function executeMove(
  battleId: string,
  characterId: string,
  toX: number,
  toY: number,
  userId: string
): Promise<MoveResult>;
```

**内部依赖**：
- `battleSessionService.getDbSessionState` — 读 session
- `battleService.listCharactersInBattle` — 拿 character → userId 映射
- `battleService.validateMovement` — BFS 路径检查
- `battleService.moveCharacter` — 原子 Redis 更新
- `battleStateBroadcaster.broadcastBoardState` — board 广播
- `battleSessionService.completeMovePhase` — phase 推进

**错误处理**：所有内部失败 catch 后返回 `{ success: false, error: ... }`，不抛出。

### 2.2 `src/socket/battleRoom.ts`（修改）

**新增导出**：
```typescript
export async function handleBattleMove(
  io: IOServer,
  socket: Socket,
  payload: { battleId?: unknown; characterId?: unknown; toX?: unknown; toY?: unknown }
): Promise<void>;
```

**handler 流程**：
1. 验证 payload（battleId/characterId 是 string，toX/toY 是有限数字）
2. 失败 → emit `battle:move:error`
3. 调 `executeMove(battleId, characterId, toX, toY, socket.data.userId)`
4. 失败 → emit `battle:move:error` 带 error 字符串
5. 不对成功 emit 任何事件（依赖 broadcastBoardState room-wide 推送 + 客户端推断成功）

### 2.3 `src/socket/socketServer.ts`（修改）

**注册新事件**：
```typescript
socket.on('battle:move', (payload) => {
  handleBattleMove(io, socket, payload).catch((err) => {
    console.error(`[WS] battle:move error: userId=${userId}`, err);
    socket.emit('battle:move:error', { error: 'Internal server error' });
  });
});
```

---

## 3. 验证规则

### 3.1 payload 验证（handler 层）
| 字段 | 验证 |
|------|------|
| `battleId` | 必须是 string |
| `characterId` | 必须是 string |
| `toX`, `toY` | 必须是 0-8 之间的有限数字 |

任一不通过 → emit `battle:move:error` `{ error: 'invalid_payload' }`（注意：此 error 不在 MoveError 联合类型中，由 handler 自己加）

### 3.2 业务验证（service 层）
| 步骤 | 验证 | 失败时 error |
|------|------|--------------|
| 1 | session 存在 | 抛错（异常路径） |
| 2 | `current_phase === 'move'` | `not_in_move_phase` |
| 3 | `current_actor_id === payload.characterId` | `not_current_actor` |
| 4 | `character.userId === payload.userId` | `not_owner` |
| 5 | BFS 路径合法（不含障碍） | `invalid_path` |
| 6 | moveCharacter 原子写入成功 | `move_failed` |

---

## 4. 数据流

### 4.1 读取的 Redis keys
- `battle:{battleId}:positions` — HASH，读 characterId 的 fromX,fromY
- （间接）`battle:{battleId}:session` — 通过 `getDbSessionState` 读

### 4.2 写入的 Redis keys
- `battle:{battleId}:positions` — HASH field 更新（原子）
- （间接）`battle:{battleId}:session` — 通过 `completeMovePhase` 写 phase

### 4.3 不涉及的 Redis keys
- `battle:{battleId}:pieces` — 不变（属性不因移动改变）
- `battle:{battleId}:hand:*` — 不变

---

## 5. 测试设计

### 5.1 单元测试（battleActionService.test.ts）
| 编号 | 用例 | 期望 |
|------|------|------|
| 1 | Happy path | success: true，moveCharacter + broadcastBoardState + completeMovePhase 各被调一次 |
| 2 | wrong phase | error: 'not_in_move_phase'，不下游 |
| 3 | wrong actor | error: 'not_current_actor'，不下游 |
| 4 | not owner | error: 'not_owner'，不下游 |
| 5 | invalid path | error: 'invalid_path'，不下游 |
| 6 | moveCharacter throws | error: 'move_failed'，不广播不推进 |
| 7 | completeMovePhase throws | 异常向上抛（service 不吞） |

### 5.2 Handler 测试（battleRoom.test.ts 新增 describe）
| 编号 | 用例 | 期望 |
|------|------|------|
| 1 | valid move | executeMove 被调 |
| 2 | invalid payload（缺 battleId） | emit `battle:move:error` `{ error: 'invalid_payload' }`，executeMove 未被调 |
| 3 | executeMove 失败 | emit `battle:move:error` 带 service 返回的 error 字符串 |
| 4 | executeMove 抛错 | 不 emit（兜底由 socketServer 层处理） |

### 5.3 不写新集成测试
- 复用 T047 既有 socketServer 集成测试
- socketServer.test.ts 顶部 mock 补全 `../services/battleActionService`

---

## 6. 文件清单

| 路径 | 改动 |
|------|------|
| `src/services/battleActionService.ts` | **新建** — `executeMove` + `MoveResult` + `MoveError` 类型 |
| `src/services/battleActionService.test.ts` | **新建** — 7 单元测 |
| `src/socket/battleRoom.ts` | 新增 `handleBattleMove` 导出函数 |
| `src/socket/battleRoom.test.ts` | 新增 describe 块测 handleBattleMove（4 测） |
| `src/socket/socketServer.ts` | 注册 `socket.on('battle:move', ...)` handler |
| `src/socket/socketServer.test.ts` | 顶部 mock 补全 `../services/battleActionService` |

**无数据库改动** — 复用既有 positions HASH + sessions 表

**无新 WS 事件类型**（除 `battle:move` 和 `battle:move:error`）— `battle:state:board` 已在 T047 定义

---

## 7. 关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 文件结构 | 新建 `battleActionService.ts` | 跟 T048 模式一致；后续 T050 (出牌) 共用此 service |
| Broadcaster 选择 | 仅 `broadcastBoardState` | 移动改变的是 board 整体位置（positions HASH），不是单角色状态 |
| Phase 推进责任 | T049 自动调 `completeMovePhase` | 避免「move 阶段可重复走棋」的 race；T051 只负责 step/round 边界 |
| Session 广播 | T049 不调 | session 推送是 T051 范围；T049 状态推进与状态广播解耦 |
| actor 验证 | payload.characterId === current_actor_id + user 匹配 | 防同房间对手冒充 actor 走棋 |
| payload 错误来源 | handler 验结构 + service 验业务 | 关注点分离；invalid_payload 字符串在 handler 私有 |

---

## 8. 范围外（明确不做）

- ❌ 单元移动 vs 多步移动（一次走 N 格 vs 分 N 步走 1 格）—— T049 支持 BFS 范围内任意距离一次性走完
- ❌ 「跳过移动」行动（pass move）—— T051 范围
- ❌ 移动引发的「嘲讽目标失效」逻辑（T039 taunt）—— T050/T051 处理
- ❌ 移动对公共池/手牌的副作用 —— 移动不打牌
- ❌ 增量差分推送（只发位置变化字段）—— 复用 T047 既有全量 board 事件
- ❌ 移动撤销 / 回滚 —— 单人单决策，无撤销需求
- ❌ 单元测 TDD 之外的真实 Redis 集成测试 —— 留给 T048 已有的 integration test 骨架扩展

---

*文档版本：v1.0*
*最后更新：2026-06-15*
