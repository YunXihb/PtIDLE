# T050 打牌操作同步 — 设计文档

> **For agentic workers:** This is a design document. Implementation plan will be created after spec approval.

**Goal:** 实现 3v3 战棋对战中的打牌操作同步 —— 玩家在 WebSocket 上发 `battle:play_card` 事件，服务端校验手牌归属、dispatch 到对应 `validate*` 函数、写状态效果（warrior shield / ranger damage_boost / mage fire mark + burn）、扣能量、删手牌、入弃牌堆（deck 来源）、广播手牌+状态+整盘、自动推进 phase `play` → `end_step`。**本任务不实际扣 HP —— T056 applyDamage 负责**。

**Architecture:** 扩展既有 `battleActionService` 模块新增 `executePlayCard` 17 步流水（5 验证 + 3 validate 派发 + 5 副作用 + 4 广播/阶段推进）；`battleRoom.ts` 追加 `handleBattlePlayCard` 薄壳 handler；`socketServer.ts` 注册 `battle:play_card` 事件。

**Tech Stack:** Node.js + TypeScript + Express + Socket.io + PostgreSQL + Redis（v4 client）+ Jest + ts-jest

**Spec:** 依赖 T033（棋盘）、T034（移动判定）、T035（攻击判定 + validateAttack + validateAOEAttack + validateTauntCard）、T036（回合流程）、T037（抽牌）、T038（保留手牌）、T039/T040/T041（职业机制）、T047（broadcaster 函数库）、T049（移动同步，建立 battleActionService 模式）、T1001（公共池 source 字段）

---

## 1. 触发流程

### 1.1 客户端发送

```typescript
socket.emit('battle:play_card', {
  battleId: 'uuid',
  characterId: 'uuid',
  handCard: {
    deck_id: 'uuid',       // character_deck.id 或 `pool:<template_no>`
    card_id: 'uuid',       // player_card.id 或 card_template.id
    name: '轻击',
    type: 'attack',        // 'attack' | 'tactical'（'defense' T050 不支持）
    cost: 1,
    effect: { damage: 2, range: 1, aoe?: false },
    template_no: 1,
    source: 'deck',        // 'deck' | 'public_pool' (T1001)
    targetId: 'uuid',      // attack 单体/AOE 中心 / tactical taunt 目标；AOE 可省（按 effect 自动算）
  },
});
```

### 1.2 服务端链路

```
socket.on('battle:play_card')
  → handleBattlePlayCard(io, socket, payload)
    → 验证 payload 结构（battleId/characterId/handCard 各字段类型）
    → 失败 → emit `battle:play_card:error` { error: 'invalid_payload' }
    → executePlayCard(io, battleId, characterId, handCard, userId)
      → getDbSessionState(battleId)                    // 1. 读 session
      → 验证 phase === 'play'                           // 2. phase check
      → 验证 currentActorId === characterId             // 3. actor match
      → listCharactersInBattle(battleId)                // 4. 查 userId
      → 验证 userId match                               // 5. owner check
      → getActorHand(battleId, characterId)             // 6. ★手牌归属校验
      → 验证 handCard.deck_id 在 hand LIST 中           // 7.
      → dispatch by card.type → validate*                // 8. validateAttack/validateAOEAttack/validateTauntCard
      → 验证 validation.valid                            // 9.
      → 读 pieces HASH → currentEnergy                   // 10. 能量读
      → setCharacterEnergy(battleId, characterId, ...)   // 11. 扣能量
      → redisClient.lRem(hand LIST, 1, handCard)         // 12. 删手牌
      → addToDiscardPile (if source='deck')              // 13. 入弃牌堆
      → broadcastHandState (user-room, self)             // 14. 推手牌
      → broadcastCharacterStatus (battle room, both)     // 15. 推状态
      → completePlayPhase (play → end_step)              // 16. 阶段推进
      → broadcastBoardState (battle room, both)          // 17. 整盘广播
      → return { success: true, validation }
    → handleBattlePlayCard 根据 success emit
```

### 1.3 成功响应

- 不 emit 单独的"成功"事件给 caller
- `battle:state:hand`（self-only, user-room）、`battle:state:character`（all, battle room）、`battle:state:board`（all, battle room）三个事件触发

### 1.4 失败响应

- emit `battle:play_card:error` 给 caller（不是 room-wide）
- Payload: `{ error: 'invalid_payload' | 'not_in_play_phase' | 'not_current_actor' | 'not_owner' | 'card_not_in_hand' | 'unsupported_card_type' | 'validation_failed' | 'energy_deduct_failed' | 'side_effect_failed' | 'internal_error' }`
- `validation_failed` 时附 `detail` 字段携带 `validate*` 内部 error 信息

---

## 2. 模块设计

### 2.1 `src/services/battleActionService.ts`（修改，追加 executePlayCard）

**新增导出**：
```typescript
export type PlayCardError =
  | 'not_in_play_phase'
  | 'not_current_actor'
  | 'not_owner'
  | 'card_not_in_hand'
  | 'unsupported_card_type'
  | 'validation_failed'
  | 'energy_deduct_failed'
  | 'side_effect_failed';

export type PlayCardResult =
  | { success: true; validation: AttackValidationResult }
  | { success: false; error: PlayCardError; detail?: string };

export async function executePlayCard(
  io: IOServer,
  battleId: string,
  characterId: string,
  handCard: HandCard,
  userId: string
): Promise<PlayCardResult>;
```

**内部依赖**：
- `battleSessionService.getDbSessionState` — 读 session
- `battleSessionService.completePlayPhase` — phase 推进
- `battleService.listCharactersInBattle` — 拿 character → userId 映射
- `battleService.validateAttack` / `validateAOEAttack` / `validateTauntCard` — dispatch 目标
- `battleService.getCharacterPiece` — 通过 validate* 间接调用
- `handService.getActorHand` — 读手牌
- `handService.addToDiscardPile` — 弃牌堆
- `redisClient` — pieces HASH 读、hand LIST lRem
- `battleStateBroadcaster.broadcastHandState` / `broadcastCharacterStatus` / `broadcastBoardState`

**错误处理**：
- 业务错误（validation 失败、phase 不对）→ 返回 `{ success: false, error: ... }`
- 依赖抛错（Redis 挂、PG 挂）→ 向上抛（异常路径），由 socketServer 层兜底

### 2.2 `src/socket/battleRoom.ts`（修改，追加 handleBattlePlayCard）

**新增导出**：
```typescript
export async function handleBattlePlayCard(
  io: IOServer,
  socket: Socket,
  payload: {
    battleId?: unknown;
    characterId?: unknown;
    handCard?: unknown;  // 完整 HandCard 对象
  }
): Promise<void>;
```

**handler 流程**：
1. 验证 payload 结构（battleId/characterId 是 string，handCard 是对象且各字段类型正确）
2. 失败 → emit `battle:play_card:error` `{ error: 'invalid_payload' }`
3. 调 `executePlayCard(io, battleId, characterId, handCard, socket.data.userId)`
4. 失败 → emit `battle:play_card:error` 带 error 字符串 + 可选 detail
5. 不对成功 emit 任何事件（依赖 broadcast* 三连推送 + 客户端推断成功）

**payload handCard 字段验证**（handler 私有）：
- `deck_id`: string
- `card_id`: string
- `name`: string
- `type`: 'attack' | 'tactical'（'defense' 在 service 层走 `unsupported_card_type`，不在 handler 拒绝）
- `cost`: number ≥ 0
- `effect`: object
- `template_no`: number
- `source`: 'deck' | 'public_pool'
- `targetId`?: string（attack 单体/tactical taunt 必填；attack AOE 可省）

### 2.3 `src/socket/socketServer.ts`（修改）

**注册新事件**：
```typescript
socket.on('battle:play_card', (payload) => {
  handleBattlePlayCard(io, socket, payload).catch((err) => {
    console.error(`[WS] battle:play_card error: userId=${userId}`, err);
    socket.emit('battle:play_card:error', { error: 'internal_error' });
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
| `handCard` | 必须是 object 且上述字段类型正确 |

任一不通过 → emit `battle:play_card:error` `{ error: 'invalid_payload' }`

### 3.2 业务验证（service 层）
| 步骤 | 验证 | 失败时 error |
|------|------|--------------|
| 1 | session 存在 | 抛错（异常路径） |
| 2 | `current_phase === 'play'` | `not_in_play_phase` |
| 3 | `current_actor_id === handCard.characterId` | `not_current_actor` |
| 4 | `character.userId === payload.userId` | `not_owner` |
| 5 | `handCard.deck_id` 在 actor hand LIST 中 | `card_not_in_hand` |
| 6 | `card.type` 是 'attack'（AOE/单体）或 'tactical'+'taunt' | `unsupported_card_type` |
| 7 | `validate*` 返回 `{ valid: true }` | `validation_failed`（带 detail = validate.error） |

### 3.3 validate* dispatch 规则
```typescript
if (handCard.type === 'attack' && (handCard.effect as { aoe?: boolean })?.aoe) {
  // AOE：targetId 可省（effect 自动计算范围内所有敌方）
  validation = await validateAOEAttack(battleId, characterId, handCard.card_id, handCard.source);
} else if (handCard.type === 'attack') {
  // 单体：targetId 必填（validate 内部校验 target 存在 + alive + enemy）
  validation = await validateAttack(
    battleId, characterId, handCard.card_id, handCard.targetId!,
    session.currentRound, handCard.source
  );
} else if (handCard.type === 'tactical' && (handCard.effect as { type?: string })?.type === 'taunt') {
  // 嘲讽：targetId 必填
  validation = await validateTauntCard(
    battleId, characterId, handCard.card_id, handCard.targetId!,
    session.currentRound
  );
} else {
  return { success: false, error: 'unsupported_card_type', detail: `card type '${handCard.type}' effect '${(handCard.effect as { type?: string })?.type ?? 'unknown'}' not supported in T050` };
}
```

### 3.4 post-validate 副作用失败
| 副作用 | 失败 error | 是否回滚已写状态 |
|--------|----------|----------------|
| `setCharacterEnergy` 抛错 | `energy_deduct_failed` | 否（validate 已写 shield/boost/mark） |
| `redisClient.lRem` 抛错 | `side_effect_failed` | 否（能量已扣，状态效果已写） |
| `addToDiscardPile` 抛错 | `side_effect_failed` | 否（同上） |

**设计决策**：与 T049 executeMove 一致 — 已写状态不主动回滚（moveCharacter 失败时也无法回滚已发生的移动）。T056 applyDamage 接入时统一讨论一致性策略。

---

## 4. 数据流

### 4.1 读取的 Redis keys
- `battle:{battleId}:session` — 通过 `getDbSessionState` 读
- `battle:{battleId}:pieces` — 读 attacker 完整 piece（含 energy）
- `battle:{battleId}:hand:{characterId}` — 读手牌 LIST
- `battle:{battleId}:positions` — 通过 validate* 内部 getCharacterPosition 读
- `battle:{battleId}:effects:{characterId}` — 通过 validate* 内部 getActiveEffects 读

### 4.2 写入的 Redis keys
- `battle:{battleId}:pieces` — energy 字段更新（read-modify-write）
- `battle:{battleId}:hand:{characterId}` — LREM 一条 handCard
- `battle:{battleId}:discard:{characterId}` — RPUSH（仅 deck 来源）
- `battle:{battleId}:effects:{characterId}` — 由 validate* 内部写（shield / damage_boost / mark_fire / burn / taunt）
- `battle:{battleId}:session` — 通过 `completePlayPhase` 写 phase

### 4.3 不涉及的 Redis keys
- `battle:{battleId}:positions` — 不变（打牌不移动）
- `battle:{battleId}:retained:{characterId}` — 不变

### 4.4 不涉及的 PostgreSQL 表
- `battles` — 不变（phase 推进由 completePlayPhase 走 Redis，**不**持久化到 PG。T051 才决定是否同步）
- `player_cards` — 不变（**T050 不消耗 player_cards**，T053 卡牌消耗处理时再做）
- `card_templates` — 不变

### 4.5 副作用顺序（executePlayCard 步骤 10-17）
严格按下列顺序（**重要**：影响 WS 推送一致性 + 后续 phase 推进）：

```
10. 读 pieces HASH → currentEnergy         // 必须在 deduct 前
11. setCharacterEnergy(attackerId, cur-cost) // 扣能量
12. lRem(hand LIST, handCard)               // 删手牌
13. addToDiscardPile (if source='deck')     // 入弃牌堆
14. broadcastHandState (self)               // 推手牌（手牌已变）
15. broadcastCharacterStatus (both)         // 推状态（能量已变 + 状态效果已写）
16. completePlayPhase                       // phase 推进
17. broadcastBoardState (both)              // 整盘广播（含 phase='end_step'）
```

**为什么不先 broadcast 再 deduct**：broadcastCharacterStatus 会读 `getCharacterStatus` → 内部读 pieces HASH → 拿当前 energy。如果先 broadcast 拿到旧 energy 再 deduct，前端会看到"先看到能量变了再看到 phase 推进"的不一致。T050 选择「副作用先于广播」。

---

## 5. 测试设计

### 5.1 单元测试（`battleActionService.test.ts` 追加 describe 块）

| 编号 | describe 块 | 用例 | 期望 |
|------|-------------|------|------|
| 1 | happy path | attack 单体（warrior/ranger/mage 三种职业） | success: true，全部副作用按序调用 |
| 2 | happy path | attack AOE | success: true，validateAOEAttack 被调 |
| 3 | happy path | tactical taunt | success: true，validateTauntCard 被调 |
| 4 | happy path | 公共池卡（source='public_pool'） | success: true，**addToDiscardPile 未被调**（不入弃牌堆） |
| 5 | happy path | deck 卡 | success: true，addToDiscardPile 被调 |
| 6 | phase error | not_in_play_phase | error: 'not_in_play_phase'，所有副作用未调 |
| 7 | actor error | not_current_actor | error: 'not_current_actor'，所有副作用未调 |
| 8 | owner error | not_owner | error: 'not_owner'，所有副作用未调 |
| 9 | hand error | card_not_in_hand | error: 'card_not_in_hand'，validate* 未调 |
| 10 | type error | unsupported_card_type (defense) | error: 'unsupported_card_type' |
| 11 | type error | unsupported_card_type (tactical non-taunt) | error: 'unsupported_card_type' |
| 12 | validation | validation_failed (Card not found) | error: 'validation_failed'，detail 携带 |
| 13 | validation | validation_failed (Not enough energy) | 同上 |
| 14 | validation | validation_failed (Target out of range) | 同上 |
| 15 | validation | validation_failed (Cannot attack friendly) | 同上 |
| 16 | validation | validation_failed (taunt range error) | 同上 |
| 17 | post-validate | energy_deduct_failed (setCharacterEnergy throws) | error: 'energy_deduct_failed' |
| 18 | post-validate | side_effect_failed (lRem throws) | error: 'side_effect_failed' |

**总计 18 个新 case**，追加到 `battleActionService.test.ts` 已有 describe 块后。

### 5.2 关键 mock 桩顺序（happy path）
```
mock getDbSessionState           → 1次 (返回 phase='play', currentActor=c1, currentRound=1)
mock listCharactersInBattle      → 1次 (返回 [{characterId:c1, userId:u1, ...}])
mock getActorHand                → 1次 (返回 [handCard])
mock validateAttack (or AOE/Taunt) → 1次
mock getCharacterPiece           → 2次 (attacker + target, validate 内部)
mock getPlayerCard               → 1次 (validate 内部)
mock getCharacterPosition        → 2次 (attacker + target positions)
mock getTargetsInRange           → 0-1次 (AOE only)
mock onWarriorAttackCardPlayed   → 0-1次 (warrior only)
mock onRangerAttackCardPlayed    → 0-1次 (ranger only)
mock getRangerDamageBoost        → 0-1次 (ranger only)
mock attachFireMark              → 0-1次 (mage only)
mock hGet pieces HASH            → 1次 (读 currentEnergy) ★新增
mock setCharacterEnergy          → 1次 ★新增
mock lRem hand LIST              → 1次 ★新增
mock addToDiscardPile            → 0-1次 (deck only) ★新增
mock broadcastHandState          → 1次 ★新增
mock broadcastCharacterStatus    → 1次 ★新增
mock completePlayPhase           → 1次 ★新增
mock broadcastBoardState         → 1次 ★新增
```

### 5.3 Handler 测试（`battleRoom.test.ts` 新增 describe 块）
| 编号 | 用例 | 期望 |
|------|------|------|
| 1 | valid play_card | executePlayCard 被调 |
| 2 | invalid payload（缺 handCard） | emit `battle:play_card:error` `{ error: 'invalid_payload' }` |
| 3 | invalid payload（handCard.type === 'defense'） | **handler 不拒**，交给 service 返回 `unsupported_card_type` |
| 4 | executePlayCard 失败（validation_failed） | emit `battle:play_card:error` 带 error + detail |
| 5 | executePlayCard 抛错 | 不 emit（兜底由 socketServer 层处理） |

### 5.4 socketServer 测试（`socketServer.test.ts` 顶部 mock 补全）
- 顶部 `jest.mock('../services/battleActionService', ...)` 加 `executePlayCard: jest.fn()`
- 既有集成测试 mock setup 追加 `mockExecutePlayCard.mockResolvedValue(...)`

### 5.5 不写新集成测试
- 复用 T047 既有 socketServer 集成测试
- T050 范围内的端到端集成测试在 T051 之后做

---

## 6. 文件清单

| 路径 | 改动 |
|------|------|
| `src/services/battleActionService.ts` | **修改** — 追加 `executePlayCard` + `PlayCardResult` + `PlayCardError` 类型 |
| `src/services/battleActionService.test.ts` | **修改** — 追加 18 个单测 case |
| `src/socket/battleRoom.ts` | 修改 — 追加 `handleBattlePlayCard` 导出函数 |
| `src/socket/battleRoom.test.ts` | 修改 — 追加 5 个 handleBattlePlayCard describe case |
| `src/socket/socketServer.ts` | 修改 — 注册 `socket.on('battle:play_card', ...)` handler |
| `src/socket/socketServer.test.ts` | 修改 — 顶部 mock 补全 `../services/battleActionService.executePlayCard` |

**无数据库改动** — 复用既有 pieces HASH + hand LIST + discard LIST + session 字段

**无新 WS 事件类型**（除 `battle:play_card` 和 `battle:play_card:error`）— `battle:state:hand` / `battle:state:character` / `battle:state:board` 已在 T047 定义

---

## 7. 关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 文件结构 | 扩展 `battleActionService.ts`（不新建） | T049 模式延续；T050 与 T049 同 service 利于将来 T056 applyDamage 整合 |
| Card 范围 | attack (单体+AOE) + tactical (taunt) | 全部有 validate 函数；defense 留 T050.5 |
| Damage apply | T050 **不**实际扣 HP | T056 applyDamage 统一处理（含 shield 消耗 + boost 应用 + 多目标）；「生产 vs 应用」分离 |
| Phase 推进 | T050 自动调 `completePlayPhase` | 与 T049 executeMove → completeMovePhase 对称；避免「play 阶段可重复打牌」race |
| 能量扣减 | 步骤 11 显式 `setCharacterEnergy(attackerId, cur-cost)` | validateAttack 只 check energy，不 deduct；T049 move 不动能量故未涉及 |
| 弃牌堆判定 | 仅 deck 来源入弃牌堆 | T1001 spec 3.5 边界表：公共池卡无限复用、不入弃牌堆 |
| Board 广播 | 调 `broadcastBoardState`（整盘） | 与 T049 对称，phase='end_step' 立即可见；代价：额外一次整盘推送 |
| Hand 广播 | 调 `broadcastHandState`（user-room, self） | T047 既有；手牌变化仅本人可见 |
| 角色广播 | 调 `broadcastCharacterStatus`（battle room, both） | 能量/状态效果变化双方都需看到 |
| 副作用顺序 | deduct → lRem → discard → broadcast | broadcast 必须最后（拿到最新状态）；能量必须在 broadcast 前扣 |
| payload 错误来源 | handler 验结构 + service 验业务 | 关注点分离；handler 私有 'invalid_payload'，service 8 个业务 error |
| validate 失败回滚 | **不**主动回滚已写状态 | T049 同模式（moveCharacter 失败无法回滚已发生移动）；T056 统一处理一致性 |

---

## 8. 范围外（明确不做）

- ❌ 实际扣 HP（含 shield 消耗、boost 应用、多目标）—— T056 applyDamage 范围
- ❌ burn 伤害结算（applyBurnDamage）—— T051 orchestrator 在 ABABAB 行动完后调用
- ❌ defense 卡（防御/治疗/护盾）—— T050.5 范围，需先实现 validateDefenseCard
- ❌ 玩家卡牌消耗（player_cards 减 1）—— T053 卡牌消耗处理范围；T050 仅入弃牌堆 LIST
- ❌ 回合切换（end_step → idle/end_round）—— T051 orchestrator 范围
- ❌ burn tick 结算（扣血 + 减少 duration）—— T051 范围
- ❌ 玩家死亡/胜负判定（all dead / 据点占领）—— T052 范围
- ❌ step/round 切换时的状态效果 tick 清理 —— T051 范围
- ❌ 真实 Redis 集成测试（需要完整 PG+Redis 启动）—— T050 沿用 T049 模式仅单元测
- ❌ 客户端卡牌选择 UI —— 前端 T070 范围
- ❌ 重连后手牌/状态恢复 —— 前端 reconnect 重发 `battle:join` 触发（T047 已实现）

---

*文档版本：v1.0*
*最后更新：2026-06-17*
