# T051 回合切换 — 设计文档

> **For agentic workers:** This is a design document. Implementation plan will be created after spec approval.

**Goal:** 实现 3v3 战棋对战中的回合切换 orchestrator —— 在 `play`（或 `move`）阶段结束后，由服务端级联触发「保留手牌 → 推进 step → 切换 actor → 抽牌」流水；当所有 6 个 step 走完时（last step in round）追加「burn 伤害结算 + 状态效果 tick + 切换 round」子流水。新增 `battle:skip_play` 客户端事件，让不想打牌的玩家跳过 `play` 阶段。

**Architecture:** 扩展既有 `battleActionService` 模块新增两个公共 orchestrator：`executeEndStep`（11 步主流水）和 `executeRoundEnd`（5 步子流水，由 `executeEndStep` 在 last step 时调用）。新增 `handleBattleSkipPlay` 薄壳 handler 给 `battle:skip_play` 事件；T050 的 `executePlayCard` 在 `completePlayPhase` 之后追加一行调用 `executeEndStep`，完成 `play` → `end_step` 自动级联。

**Tech Stack:** Node.js + TypeScript + Express + Socket.io + PostgreSQL + Redis（v4 client）+ Jest + ts-jest

**Spec:** 依赖 T033（棋盘）、T036（回合流程 + snake draft）、T037（抽牌）、T038（保留手牌）、T039/T040/T041（职业机制 + applyBurnDamage / tickEffects）、T047（broadcaster 函数库）、T049（移动同步，建立 battleActionService 模式 + executeMove），T050（打牌同步，建立 executePlayCard 模式），T1001（公共池 source 字段）

---

## 1. 触发流程

### 1.1 触发源（两个）

```
┌─ 触发源 A: T050 executePlayCard 末尾自动级联（happy path 默认走此）──┐
│  executePlayCard                                                       │
│    ...                                                                  │
│    → completePlayPhase (phase: play → end_step)                        │
│    → broadcastBoardState                                                │
│    → executeEndStep(io, battleId)   ← ★ T051 新增调用                  │
└────────────────────────────────────────────────────────────────────────┘

┌─ 触发源 B: 客户端主动发 battle:skip_play（玩家跳过 play 阶段）─────┐
│  socket.on('battle:skip_play', payload)                                │
│    → handleBattleSkipPlay(io, socket, payload)                          │
│      → 验证 payload (battleId: string)                                  │
│      → executeEndStep(io, battleId)                                     │
└────────────────────────────────────────────────────────────────────────┘
```

**T049 executeMove 也可级联**：未来可对称追加 `executeEndStep` 调用（move → end_step）。T051 范围不强制；T051.5 再决定。当前 T051 只 wire T050 一条。

### 1.2 executeEndStep 完整 11 步流水

```
executeEndStep(io, battleId)
  1. 读 session                                          (getDbSessionState)
  2. 验证 phase === 'play' OR 'move'                      (StepEndError: not_in_play_or_move_phase)
  3. retainHandOnStepEnd(battleId, currentActorId)        (StepEndError: retain_failed)
  4. if (isLastStepInRound(state)) {
       executeRoundEnd(io, battleId, state)               (StepEndError: round_end_failed)
     }
  5. endCurrentStep(battleId)                             (StepEndError: end_step_failed)
  6. activateCurrentUnit(battleId)                        (StepEndError: activate_failed)
       (snake draft 3v3: even index → p1, odd → p2)
  7. drawCards(battleId, currentActorId)                  (StepEndError: draw_failed)
  8. completeDrawPhase(battleId)                          (StepEndError: complete_phase_failed)
  9. 读最新 session (getDbSessionState)                  // 重读一次, 用于返回 state
 10. broadcastSessionState(io, battleId, state)           (新事件: battle:state:session)
 11. broadcastBoardState(io, battleId)                    (既有事件)
     → return { success: true, state }
```

### 1.3 executeRoundEnd 完整 5 步子流水

```
executeRoundEnd(io, battleId, stateBefore)
  1. applyBurnDamage(io, battleId, stateBefore)           (T041 callsite — 所有 mage marks 结算)
  2. tickEffects(battleId)                                (所有 DoT 效果 tick: burn / poison / regen ...)
  3. endCurrentRound(battleId)                            (phase machine 推进 currentRound)
  4. broadcastSessionState(io, battleId, state)           (新事件: battle:state:session, 推 currentRound 变化)
  5. broadcastBoardState(io, battleId)                    (既有事件 — HP 变化可见)
     → return void
```

### 1.4 成功响应

- 不 emit 单独的"成功"事件给 caller
- 推送事件: `battle:state:session`（battle room, both）+ `battle:state:board`（battle room, both）
- skip-play 客户端通过 `battle:state:session` 中的 `currentPhase` 字段（从 `play` 变 `move`）推断成功（**主要信号**）；`battle:state:board` 也带 `currentPhase` 作为冗余信号

### 1.5 失败响应

- `executeEndStep` 失败 → emit `battle:skip_play:error` 给 caller
- Payload: `{ error: 'invalid_payload' | 'not_in_play_or_move_phase' | 'not_current_actor' | 'retain_failed' | 'round_end_failed' | 'end_step_failed' | 'activate_failed' | 'draw_failed' | 'complete_phase_failed' }`
- T050 的 `executePlayCard` → `executeEndStep` 失败 → 沿用 T050 既有的 socketServer 兜底（`console.error` + 不 emit，因为 T050 本来就无成功 emit）

### 1.6 副作用顺序（关键 — 决定 WS 推送一致性）

```
1. retainHandOnStepEnd       (手牌变化，**未广播** — 留到 broadcast)
2. executeRoundEnd (条件)    (burn/effect tick — HP 变化，**未广播**)
3. endCurrentStep            (session 字段变化 — step/round 推进)
4. activateCurrentUnit       (session.currentActorId 变化)
5. drawCards                 (新 actor 的手牌变化)
6. completeDrawPhase         (phase: draw → move)
7. broadcastSessionState     (新事件 — session 整体推送，**一次**)
8. broadcastBoardState       (既有事件 — 整盘状态推送，**一次**)
```

**为什么 broadcast 在最后**：所有副作用完成后再广播，前端一次性看到最新状态。T049/T050 都遵循此模式。**新增 `broadcastSessionState` 而不是多个局部 broadcast**，因为 step/round/actor/phase 4 个字段可能同时变化（end_step + activate + completeDrawPhase 三步串行改 session），避免推送多次。

---

## 2. 模块设计

### 2.1 `src/services/battleActionService.ts`（修改，追加 executeEndStep + executeRoundEnd）

**新增导出**：
```typescript
export type StepEndError =
  | 'not_in_play_or_move_phase'
  | 'not_current_actor'
  | 'retain_failed'
  | 'round_end_failed'
  | 'end_step_failed'
  | 'activate_failed'
  | 'draw_failed'
  | 'complete_phase_failed';

export type StepEndResult =
  | { success: true; state: BattleSessionState }
  | { success: false; error: StepEndError; detail?: string };

export async function executeEndStep(
  io: IOServer,
  battleId: string
): Promise<StepEndResult>;

export async function executeRoundEnd(
  io: IOServer,
  battleId: string,
  stateBefore: BattleSessionState
): Promise<void>;
```

**`executeEndStep` 内部依赖**：
- `battleSessionService.getDbSessionState` — 读 session
- `handService.retainHandOnStepEnd` — T038 保留手牌
- `battleSessionService.endCurrentStep` — 推进 step
- `battleSessionService.activateCurrentUnit` — snake draft
- `handService.drawCards` — T037 抽牌
- `battleSessionService.completeDrawPhase` — phase 推进
- `professionMechanicService.applyBurnDamage` — T041 burn 结算
- `statusEffectService.tickEffects` — 统一 DoT tick
- `battleSessionService.endCurrentRound` — 推进 round
- `battleStateBroadcaster.broadcastSessionState` — **新事件**（T051 引入）
- `battleStateBroadcaster.broadcastBoardState` — 既有

**错误处理**：
- 业务错误（phase 不对、actor 不对）→ 返回 `{ success: false, error: ... }`
- 依赖抛错（Redis 挂、PG 挂）→ 向上抛（异常路径），由 socketServer 层兜底
- **特殊：`round_end_failed` 仍返回 error，但 partial 副作用（burn/effect tick 的 HP 变化）已 commit，不回滚**（与 T050 一致）

**`executeRoundEnd` 内部依赖**：
- `professionMechanicService.applyBurnDamage` — 找所有有 `mark_fire` 的 target，每个 target 扣 burn HP
- `statusEffectService.tickEffects` — 对 `battle:{battleId}:effects:{charId}` 全部 LIST tick，duration 减 1，到期 LREM
- `battleSessionService.endCurrentRound` — `currentRound += 1`，`currentStep` 重置为 0

**`executeRoundEnd` 失败语义**：
- `applyBurnDamage` 抛错 → `round_end_failed`，**HP 变化不回滚**（部分 target 可能已 commit）
- `tickEffects` 抛错 → `round_end_failed`，同上
- `endCurrentRound` 抛错 → `round_end_failed`，同上
- 与 T050「不主动回滚」原则一致

### 2.2 `src/socket/battleRoom.ts`（修改，追加 handleBattleSkipPlay）

**新增导出**：
```typescript
export async function handleBattleSkipPlay(
  io: IOServer,
  socket: Socket,
  payload: { battleId?: unknown }
): Promise<void>;
```

**handler 流程**：
1. 验证 payload 结构（`battleId` 是 string）
2. 失败 → emit `battle:skip_play:error` `{ error: 'invalid_payload' }`
3. 调 `executeEndStep(io, battleId)`
4. 失败 → emit `battle:skip_play:error` 带 error 字符串 + 可选 detail
5. 不对成功 emit 任何事件（依赖 `broadcastSessionState` + `broadcastBoardState` 两连推送 + 客户端推断成功）

### 2.3 `src/socket/socketServer.ts`（修改）

**注册新事件**：
```typescript
socket.on('battle:skip_play', (payload) => {
  handleBattleSkipPlay(io, socket, payload).catch((err) => {
    console.error(`[WS] battle:skip_play error: userId=${userId}`, err);
    socket.emit('battle:skip_play:error', { error: 'internal_error' });
  });
});
```

### 2.4 `src/socket/battleStateBroadcaster.ts`（修改，追加 broadcastSessionState）

**新增导出**：
```typescript
export function broadcastSessionState(
  io: IOServer,
  battleId: string,
  state: BattleSessionState
): void;
```

**实现**：
```typescript
export function broadcastSessionState(io, battleId, state) {
  io.to(`battle:${battleId}`).emit('battle:state:session', {
    battleId,
    currentRound: state.currentRound,
    currentStep: state.currentStep,
    currentActorId: state.currentActorId,
    currentPhase: state.currentPhase,
  });
}
```

**为什么独立事件而不是塞进 `battle:state:board`**：
- session 变化（step/round/actor/phase）频率高（每 step 一次），整盘推送浪费
- 客户端可订阅 session 变化做 UI 提示（"Round 2 开始"），无需刷新整盘
- T047 已定义了 `battle:state:session` 事件类型占位（T047 broadcaster 文档有标注），T051 wire up

---

## 3. 验证规则

### 3.1 payload 验证（handleBattleSkipPlay 层）
| 字段 | 验证 |
|------|------|
| `battleId` | 必须是 string |

任一不通过 → emit `battle:skip_play:error` `{ error: 'invalid_payload' }`

### 3.2 业务验证（executeEndStep 层）
| 步骤 | 验证 | 失败时 error |
|------|------|--------------|
| 1 | session 存在 | 抛错（异常路径） |
| 2 | `current_phase === 'play' OR 'move'` | `not_in_play_or_move_phase` |
| 3 | (预留) `socket.data.userId` 拥有 currentActor | `not_current_actor`（**T051 不触发**，仅占位） |
| 4 | retainHandOnStepEnd 抛错 | `retain_failed` |
| 5 | executeRoundEnd 抛错 | `round_end_failed` |
| 6 | endCurrentStep 抛错 | `end_step_failed` |
| 7 | activateCurrentUnit 抛错 | `activate_failed` |
| 8 | drawCards 抛错 | `draw_failed` |
| 9 | completeDrawPhase 抛错 | `complete_phase_failed` |

**actor 归属检查**：
- T051 范围：`not_current_actor` 在 `StepEndError` 联合类型中定义但 **executeEndStep 内部不触发**（handler 层也未验证）
- 触发场景：未来 T051.5 接入「step 超时自动级联」时（AFK / 断线超时），系统级自动调用需 skip 校验；玩家主动调用需校验。**T051.5 统一重构时再决定**
- 当前 T051 调用方（T050 executePlayCard / handleBattleSkipPlay）已确保是当前 actor（phase machine 锁）

### 3.3 边界条件
| 情况 | 行为 |
|------|------|
| session.currentStep 已是 last step（5/6） | executeEndStep 调 executeRoundEnd + endCurrentStep（rollover to round N+1, step 0） |
| session.currentStep 不是 last step（0-4/6） | executeEndStep 只 endCurrentStep（步进到 step+1） |
| session.currentPhase === 'idle' 或 'finished' | 返回 `not_in_play_or_move_phase` |
| retainHandOnStepEnd actor 已无手牌 | 正常返回（retain 函数本身幂等） |
| 当前 actor 全部已死亡（T052 范围） | **T051 不处理**，由 T052 winner 判定跳过 |

---

## 4. 数据流

### 4.1 读取的 Redis keys
- `battle:{battleId}:session` — `getDbSessionState` 读
- `battle:{battleId}:hand:{characterId}` — `retainHandOnStepEnd` 读
- `battle:{battleId}:discard:{characterId}` — `retainHandOnStepEnd` 写
- `battle:{battleId}:effects:{characterId}` — `tickEffects` 读 + 写
- `battle:{battleId}:pieces` — `applyBurnDamage` 读 HP + 写 HP

### 4.2 写入的 Redis keys
- `battle:{battleId}:session` — `endCurrentStep` / `activateCurrentUnit` / `endCurrentRound` / `completeDrawPhase` 多处写
- `battle:{battleId}:hand:{characterId}` — `retainHandOnStepEnd` LREM + `drawCards` RPUSH
- `battle:{battleId}:discard:{characterId}` — `retainHandOnStepEnd` RPUSH
- `battle:{battleId}:effects:{characterId}` — `tickEffects` LREM 到期 effect
- `battle:{battleId}:pieces` — `applyBurnDamage` 扣 HP

### 4.3 不涉及的 Redis keys
- `battle:{battleId}:positions` — 不变（回合切换不移动）
- `battle:{battleId}:retained:{characterId}` — 不变（T038 retain 标记）— **T051 复用**
- `battle:{battleId}:warrior_status:{warriorId}` / `ranger_status:{rangerId}` — 不变
- `battle:{battleId}:matchmaking*` — 不变
- `idle:*` — 不变

### 4.4 不涉及的 PostgreSQL 表
- `battles` — 不变（**T051 不持久化 session 字段到 PG**，T052/T054 战斗结算时统一处理）
- `player_cards` — 不变
- `characters` — 不变
- `card_templates` — 不变

### 4.5 副作用顺序（严格按序）

**executeEndStep**:
```
1. retainHandOnStepEnd      (手牌内部处理)
2. isLastStepInRound? → executeRoundEnd (条件 — 见下, 仅 last step 触发)
3. endCurrentStep           (session.currentStep++ 或 rollover)
4. activateCurrentUnit      (session.currentActorId = snake[i])
5. drawCards                (新 actor 手牌补充)
6. completeDrawPhase        (session.currentPhase = 'move')
7. 重读 session (getDbSessionState) → state
8. broadcastSessionState    (新事件，一次性推 4 字段)
9. broadcastBoardState      (既有事件，phase + 手牌变化可见)
```

**executeRoundEnd（仅 last step 触发）**:
```
1. applyBurnDamage          (所有 target HP 扣减，commit 不回滚)
2. tickEffects              (所有 effect duration--，到期 LREM)
3. endCurrentRound          (session.currentRound++，currentStep = 0)
4. broadcastSessionState    (新事件，currentRound 变化)
5. broadcastBoardState      (既有事件，HP + effect 变化可见)
```

**为什么 broadcastSessionState 在 executeRoundEnd 末尾**：
- `endCurrentRound` 改变 `currentRound`，必须 broadcast 才可见
- HP + effect 变化在 step 1-2 已 commit，但**先 broadcastBoardState 再 broadcastSessionState** 会让前端先看到 HP 变化但 round 没变，体验割裂
- 解决：executeRoundEnd 末尾先 broadcastSessionState（round 变了）再 broadcastBoardState（HP/effect 变了），前端在同一个 tick 收到两次推送无视觉差

**注意：last step 时会广播 2 次 session + 2 次 board**（executeRoundEnd 一次 + executeEndStep 一次）。这是 by design —— round-end 元数据（currentRound）和 step-end 元数据（currentActor、currentPhase）是不同语义的更新，分开推便于前端做不同处理。优化空间在 T056 之后决定。

---

## 5. 测试设计

### 5.1 单元测试（`battleActionService.test.ts` 追加 describe 块）

| 编号 | describe 块 | 用例 | 期望 |
|------|-------------|------|------|
| 1 | executeEndStep happy | mid-round (step 0/6) | success: true，retain + endStep + activate + draw + completeDrawPhase 各 1 次，**executeRoundEnd 未调** |
| 2 | executeEndStep last-step | step 5/6 (last) | success: true，executeRoundEnd 被调 1 次，endCurrentRound 1 次 |
| 3 | executeEndStep rollover | step 5/6 → step 0/新 round | success: true，currentRound += 1，currentStep = 0 |
| 4 | executeRoundEnd burn tick | mage marks present | applyBurnDamage 被调 1 次，tickEffects 1 次，endCurrentRound 1 次 |
| 5 | executeRoundEnd effect tick | burn + poison + regen | tickEffects 被调 1 次 |
| 6 | phase error | currentPhase === 'idle' | error: 'not_in_play_or_move_phase'，retain 未调 |
| 7 | phase error | currentPhase === 'finished' | 同上 |
| 8 | retain error | retainHandOnStepEnd throws | error: 'retain_failed'，endStep 未调 |
| 9 | round-end error | executeRoundEnd throws | error: 'round_end_failed'，endStep 未调 |
| 10 | end_step error | endCurrentStep throws | error: 'end_step_failed'，activate 未调 |
| 11 | activate error | activateCurrentUnit throws | error: 'activate_failed' |
| 12 | draw error | drawCards throws | error: 'draw_failed' |
| 13 | complete_phase error | completeDrawPhase throws | error: 'complete_phase_failed' |
| 14 | snake draft ordering | 3v3 ABABAB 序列 | activateCurrentUnit 6 次调用，每次 currentActorId 符合 snake pattern |
| 15 | broadcast order | executeEndStep success | broadcastSessionState **先于** broadcastBoardState 调用 |

**总计 15 个新 case**。

### 5.2 关键 mock 桩顺序（mid-round happy path）

```
mock getDbSessionState           → 2次 (1次起始读 + 1次末尾重读返回 state)
mock retainHandOnStepEnd         → 1次 (return void)
mock endCurrentStep              → 1次
mock activateCurrentUnit         → 1次
mock drawCards                   → 1次
mock completeDrawPhase           → 1次
mock broadcastSessionState       → 1次 ★新增
mock broadcastBoardState         → 1次
```

**last-step happy path 额外 mock**:
```
mock applyBurnDamage             → 1次 (T041 callsite)
mock tickEffects                 → 1次
mock endCurrentRound             → 1次
mock broadcastSessionState       → 第 2 次 (executeRoundEnd 末尾)
mock broadcastBoardState         → 第 2 次 (executeRoundEnd 末尾)
mock getDbSessionState           → 第 3 次 (executeEndStep 末尾重读, 反映新 round)
```

### 5.3 Handler 测试（`battleRoom.test.ts` 新增 describe 块）

| 编号 | 用例 | 期望 |
|------|------|------|
| 1 | valid skip_play | executeEndStep 被调 |
| 2 | invalid payload (缺 battleId) | emit `battle:skip_play:error` `{ error: 'invalid_payload' }` |
| 3 | invalid payload (battleId 非 string) | 同上 |
| 4 | executeEndStep 失败 (not_in_play_or_move_phase) | emit `battle:skip_play:error` 带 error |
| 5 | executeEndStep 抛错 | 不 emit（兜底由 socketServer 层） |
| 6 | executeEndStep 成功 | 不 emit 任何事件（依赖 broadcast 两连） |

**总计 6 个新 case**。

### 5.4 socketServer 测试（`socketServer.test.ts` 顶部 mock 补全）

- 顶部 `jest.mock('../services/battleActionService', ...)` 加 `executeEndStep: jest.fn()`
- 既有集成测试 mock setup 追加 `mockExecuteEndStep.mockResolvedValue(...)`
- 验证 `socket.on('battle:skip_play', ...)` 注册成功

### 5.5 broadcaster 测试（`battleStateBroadcaster.test.ts` 追加）

- `broadcastSessionState` mock `io.to(...).emit` 验证事件名 + payload 字段
- 1 个 case 即可

### 5.6 不写新集成测试

- 复用 T047 既有 socketServer 集成测试
- T051 范围内的端到端集成测试在 T051.5 / T056 之后做

---

## 6. 文件清单

| 路径 | 改动 |
|------|------|
| `src/services/battleActionService.ts` | **修改** — 追加 `executeEndStep` + `executeRoundEnd` + `StepEndResult` + `StepEndError` 类型；T050 `executePlayCard` 末尾追加一行 `await executeEndStep(io, battleId)` |
| `src/services/battleActionService.test.ts` | **修改** — 追加 15 个单测 case |
| `src/socket/battleRoom.ts` | 修改 — 追加 `handleBattleSkipPlay` 导出函数 |
| `src/socket/battleRoom.test.ts` | 修改 — 追加 6 个 handleBattleSkipPlay describe case |
| `src/socket/socketServer.ts` | 修改 — 注册 `socket.on('battle:skip_play', ...)` handler |
| `src/socket/socketServer.test.ts` | 修改 — 顶部 mock 补全 `executeEndStep` |
| `src/socket/battleStateBroadcaster.ts` | 修改 — 追加 `broadcastSessionState` 导出函数 |
| `src/socket/battleStateBroadcaster.test.ts` | 修改 — 追加 1 个 broadcastSessionState case |

**无数据库改动** — 复用既有 pieces HASH + hand LIST + discard LIST + session 字段 + effects LIST

**新增 WS 事件类型**:
- `battle:skip_play` (client → server)
- `battle:skip_play:error` (server → caller)
- `battle:state:session` (server → both, 已在 T047 占位)

---

## 7. 关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 文件结构 | 扩展 `battleActionService.ts` | T049/T050 模式延续；T051 与既有 orchestrator 同 service，利于 T056 整合 |
| Orchestrator 拆分 | executeEndStep + executeRoundEnd 两个函数 | 单一职责；executeRoundEnd 可独立测试；未来 T054 战斗结算可复用 |
| 触发源 | T050 executePlayCard 末尾自动级联 + 新 battle:skip_play | 两个入口服务不同场景：主动打牌后走 A；想跳过打牌走 B |
| T049 executeMove 末尾是否级联 | **T051 范围外** | T049 的 move 阶段是手动推进（玩家可能 move 后不打牌），与 T050 play 后必须 end_step 的语义不同。T051.5 再决定 |
| Phase 校验 | play OR move 两种都接受 | 未来 T051.5 接入 move 末尾级联时无需改 executeEndStep |
| actor 归属检查 | handler 不做 | 避免与 T049/T050 重复校验；session 锁已保证原子性 |
| Broadcast 顺序 | broadcastSessionState 先于 broadcastBoardState | 前端在同 tick 收到两次推送无视觉差；session 是元数据先到，board 是数据后到 |
| broadcastSessionState 独立事件 | **是** | session 变化频率高（每 step 一次），独立事件让客户端按需订阅 |
| 副作用顺序 | retain → (round-end?) → endStep → activate → draw → completeDrawPhase | 与 T049/T050 一致：先改数据再 broadcast |
| round-end 失败回滚 | **不**主动回滚 | HP 变化已 commit；T056 统一处理一致性 |
| Burn tick 时机 | 每 round 末（last step 完成后） | T041 spec line 121-126 要求；用户 Q3 答案 |
| Effect tick 时机 | 每 round 末（与 burn 统一） | 用户 Q4 答案：与 burn 同步 |
| 公共池卡与 burn | **不**区分 | 公共池 source 字段只影响 retain/discard（T1001 spec），不影响 round-end 副作用 |

---

## 8. 范围外（明确不做）

- ❌ T049 executeMove 末尾自动级联到 executeEndStep —— T051.5 范围（需先决定 move 阶段语义）
- ❌ step 超时自动级联（AFK / 断线超时）—— T051 范围外，future work
- ❌ 玩家死亡/胜负判定（all dead / 据点占领 → 跳过 actor 切换）—— T052 范围
- ❌ session 字段持久化到 PG（battles.current_round 等）—— T054 战斗结算范围
- ❌ 实际 HP 扣减（attack/AOE 实际伤害）—— T056 applyDamage 范围
- ❌ 真实 Redis 集成测试（需要完整 PG+Redis 启动）—— T051 沿用 T050 模式仅单元测
- ❌ 客户端跳过打牌的 UI 提示 —— 前端 T070 范围
- ❌ 战斗结束后的对战结算（reward / rating）—— T054 范围
- ❌ 5v5 模式（chunk-based activation）—— 范围外，T049 + 后续 task 决定
- ❌ Reconnect 后 session 同步 —— 既有 T047 机制

---

*文档版本：v1.0*
*最后更新：2026-06-17*
