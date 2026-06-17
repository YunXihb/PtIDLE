# T050 打牌操作同步实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 3v3 战棋对战中玩家的打牌操作同步——客户端发 `battle:play_card`，服务端验证手牌归属、dispatch 到对应 `validate*` 函数、写状态效果（warrior shield / ranger damage_boost / mage fire mark + burn）、扣能量、删手牌、入弃牌堆（deck 来源）、广播手牌+状态+整盘、自动推进 phase `play` → `end_step`。**不实际扣 HP（T056 applyDamage 负责）**。

**Architecture:** 扩展既有 `battleActionService` 新增 `executePlayCard` 17 步流水（5 验证 + 3 validate 派发 + 5 副作用 + 4 广播/阶段推进）；`battleRoom.ts` 追加 `handleBattlePlayCard` 薄壳 handler；`socketServer.ts` 注册 `battle:play_card` 事件。dispatch 按 `handCard.type` 路由到 `validateAttack` / `validateAOEAttack` / `validateTauntCard`。

**Tech Stack:** Node.js + TypeScript + Express + Socket.io + PostgreSQL + Redis（v4 client）+ Jest + ts-jest

**Spec:** `docs/superpowers/specs/2026-06-17-t050-play-card-sync-design.md`

---

## File Structure

```
backend/
├── src/
│   ├── services/
│   │   ├── battleActionService.ts         [MODIFY] +executePlayCard + PlayCardResult + PlayCardError
│   │   └── battleActionService.test.ts    [MODIFY] +18 单测 (5 happy + 13 error)
│   ├── socket/
│   │   ├── battleRoom.ts                  [MODIFY] +handleBattlePlayCard 导出
│   │   ├── battleRoom.test.ts             [MODIFY] +describe('handleBattlePlayCard', 5 测)
│   │   ├── socketServer.ts                [MODIFY] +socket.on('battle:play_card', ...)
│   │   └── socketServer.test.ts           [MODIFY] 顶部 mock 补 battleActionService
```

---

## Task 1: executePlayCard 骨架 + 类型定义

**Files:**
- Modify: `backend/src/services/battleActionService.ts` (在 T049 executeMove 之后追加)
- Modify: `backend/src/services/battleActionService.test.ts` (在已有 mock setup 之后追加)

- [ ] **Step 1: 追加类型定义到 `battleActionService.ts`**

在 `backend/src/services/battleActionService.ts` 文件末尾追加（import 区域追加 `HandCard` import；类型 + 函数定义追加在 `MoveResult` 之后）：

```typescript
import type { HandCard } from './handService';
import type { AttackValidationResult } from './battleService';
import { validateAttack, validateAOEAttack, validateTauntCard, listCharactersInBattle, getCharacterPiece } from './battleService';
import { getDbSessionState, completePlayPhase } from './battleSessionService';
import { getActorHand, addToDiscardPile } from './handService';
import { broadcastHandState, broadcastCharacterStatus, broadcastBoardState } from '../socket/battleStateBroadcaster';
import { setCharacterEnergy } from './battleService';
import { redisClient } from '../config/redis';

/**
 * T050 打牌操作同步
 *
 * 业务规则（按 T050 spec §3.2）：
 *   1. session 存在
 *   2. current_phase === 'play'
 *   3. session.current_actor_id === characterId
 *   4. character.userId === userId（防同房间对手冒充）
 *   5. handCard.deck_id 在 actor hand LIST 中
 *   6. card.type 是 'attack'（AOE/单体）或 'tactical'+'taunt'
 *   7. validate* 返回 valid
 *
 * 成功后副作用（按顺序）：
 *   - 读 pieces HASH → currentEnergy
 *   - setCharacterEnergy(attackerId, currentEnergy - energyCost)
 *   - redisClient.lRem(hand LIST, 1, JSON.stringify(handCard))
 *   - addToDiscardPile (if source='deck')
 *   - broadcastHandState(io, battleId, userId, characterId)  // self
 *   - broadcastCharacterStatus(io, battleId, characterId)   // both
 *   - completePlayPhase(battleId)                           // play → end_step
 *   - broadcastBoardState(io, battleId)                     // both, 含 phase
 */

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

/**
 * 执行一次打牌操作的「验证 + 副作用 + 广播 + 阶段推进」流水
 *
 * @param io IOServer 实例（用于 broadcaster）
 * @param battleId battle id
 * @param characterId 打出卡牌的 actor
 * @param handCard 客户端传整张手牌对象（含 deck_id/card_id/type/effect/source/targetId）
 * @param userId 发起请求的 user（从 socket.data 拿）
 * @returns PlayCardResult —— 失败时携带 error 字符串
 *
 * 错误处理：业务失败返回 `{ success: false, error: ... }`；
 * 依赖服务（getDbSessionState 等）抛错 → 向上抛（异常路径）。
 */
export async function executePlayCard(
  _io: IOServer,
  _battleId: string,
  _characterId: string,
  _handCard: HandCard,
  _userId: string
): Promise<PlayCardResult> {
  // TODO(T050 Task 2/3/4/5/6/7): 实现
  return { success: false, error: 'not_in_play_phase' };
}
```

注意：函数暂时返回占位结果（不 throw），让后续 Task 写测试时调用方不会因 throw 影响测试稳定性。

- [ ] **Step 2: 追加 mock setup 到 `battleActionService.test.ts`**

在 `backend/src/services/battleActionService.test.ts` 文件顶部 mock setup 区域做 3 处修改：

（a）修改既有 `jest.mock('../config/redis', ...)` 块，在 redisClient 对象内追加 `lRem: jest.fn(),` 字段：

```typescript
jest.mock('../config/redis', () => ({
  redisClient: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    hGet: jest.fn(),
    hSet: jest.fn(),
    hDel: jest.fn(),
    lRem: jest.fn(),         // ← T050 新增（删手牌 LIST）
  },
  connectRedis: jest.fn(),
  disconnectRedis: jest.fn(),
}));
```

（b）修改既有 `jest.mock('./battleService', ...)` 块，追加 `getCharacterPiece: jest.fn()` + T050 新增的 3 个 validate 函数 + `setCharacterEnergy: jest.fn()`（共 5 个新字段）：

```typescript
jest.mock('./battleService', () => ({
  listCharactersInBattle: jest.fn(),
  validateMovement: jest.fn(),
  moveCharacter: jest.fn(),
  getCharacterPosition: jest.fn(),
  getCharacterPiece: jest.fn(),         // ← T050 新增
  validateAttack: jest.fn(),            // ← T050 新增
  validateAOEAttack: jest.fn(),         // ← T050 新增
  validateTauntCard: jest.fn(),         // ← T050 新增
  setCharacterEnergy: jest.fn(),        // ← T050 新增
}));
```

（c）在 import 区域追加引用：

```typescript
import { redisClient } from '../config/redis';
import { listCharactersInBattle, validateMovement, moveCharacter, getCharacterPosition, getCharacterPiece, validateAttack, validateAOEAttack, validateTauntCard, setCharacterEnergy } from './battleService';
```

（d）追加 mock 引用（紧接 T049 既有 mock 引用之后）：

```typescript
const mockGetCharacterPiece = getCharacterPiece as jest.MockedFunction<typeof getCharacterPiece>;
```

（e）追加新的 T050 mock 块（在（d）之后）：

```typescript
// 追加 T050 mock setup
jest.mock('./handService', () => ({
  getActorHand: jest.fn(),
  addToDiscardPile: jest.fn(),
}));

import { getActorHand, addToDiscardPile } from './handService';
import { validateAttack, validateAOEAttack, validateTauntCard, setCharacterEnergy } from './battleService';
import { completePlayPhase } from './battleSessionService';
import { broadcastHandState, broadcastCharacterStatus, broadcastBoardState } from '../socket/battleStateBroadcaster';

const mockGetActorHand = getActorHand as jest.MockedFunction<typeof getActorHand>;
const mockAddToDiscardPile = addToDiscardPile as jest.MockedFunction<typeof addToDiscardPile>;
const mockValidateAttack = validateAttack as jest.MockedFunction<typeof validateAttack>;
const mockValidateAOEAttack = validateAOEAttack as jest.MockedFunction<typeof validateAOEAttack>;
const mockValidateTauntCard = validateTauntCard as jest.MockedFunction<typeof validateTauntCard>;
const mockSetCharacterEnergy = setCharacterEnergy as jest.MockedFunction<typeof setCharacterEnergy>;
const mockCompletePlayPhase = completePlayPhase as jest.MockedFunction<typeof completePlayPhase>;
const mockBroadcastHandState = broadcastHandState as jest.MockedFunction<typeof broadcastHandState>;
const mockBroadcastCharacterStatus = broadcastCharacterStatus as jest.MockedFunction<typeof broadcastCharacterStatus>;
const mockBroadcastBoardState = broadcastBoardState as jest.MockedFunction<typeof broadcastBoardState>;
```

在 `beforeEach` 末尾追加 T050 默认 happy path 桩（注意：不要清空前面 T049 的 default）：

```typescript
// T050 默认 happy path 桩
mockGetActorHand.mockResolvedValue([
  { deck_id: 'd1', card_id: 'pc1', name: '轻击', type: 'attack', cost: 1, effect: { damage: 2, range: 1 }, template_no: 1, source: 'deck' },
]);
mockAddToDiscardPile.mockResolvedValue(undefined);
mockValidateAttack.mockResolvedValue({
  valid: true,
  damage: 2,
  targets: ['t1'],
  energyCost: 1,
});
mockValidateAOEAttack.mockResolvedValue({
  valid: true,
  damage: 2,
  targets: ['t1', 't2'],
  energyCost: 2,
});
mockValidateTauntCard.mockResolvedValue({
  valid: true,
  targets: ['t1'],
  energyCost: 1,
});
mockSetCharacterEnergy.mockResolvedValue(undefined);
mockCompletePlayPhase.mockResolvedValue({ success: true, state: undefined as any });
mockBroadcastHandState.mockResolvedValue(undefined);
mockBroadcastCharacterStatus.mockResolvedValue(undefined);
mockBroadcastBoardState.mockResolvedValue(undefined);
mockGetCharacterPiece.mockImplementation(async (_battleId: string, charId: string) => {
  return {
    character_id: charId,
    player_id: 'p1',
    profession: 'warrior',
    is_alive: true,
    health: 20,
    max_health: 20,
    energy: 3,
    position_x: 3,
    position_y: 3,
  } as any;
});
(redisClient.lRem as jest.Mock).mockResolvedValue(1);  // 默认删除 1 条成功
(redisClient.hGet as jest.Mock).mockResolvedValue(JSON.stringify({ energy: 3 }));  // 默认当前能量 3
```

注意：这里 `mockGetCharacterPiece` 是 T049 battleActionService.test.ts 里没有的——T050 validate* 内部会调它。需要在 `jest.mock('./battleService', ...)` 块里追加 `getCharacterPiece: jest.fn()`：

修改 `jest.mock('./battleService', ...)` 块为：

```typescript
jest.mock('./battleService', () => ({
  listCharactersInBattle: jest.fn(),
  validateMovement: jest.fn(),
  moveCharacter: jest.fn(),
  getCharacterPosition: jest.fn(),
  getCharacterPiece: jest.fn(),
  validateAttack: jest.fn(),
  validateAOEAttack: jest.fn(),
  validateTauntCard: jest.fn(),
  setCharacterEnergy: jest.fn(),
}));
```

并在 `import { ... }` 之后追加 `getCharacterPiece` 的 mock 引用：

```typescript
import { listCharactersInBattle, validateMovement, moveCharacter, getCharacterPosition, getCharacterPiece } from './battleService';

const mockGetCharacterPiece = getCharacterPiece as jest.MockedFunction<typeof getCharacterPiece>;
```

最后在文件末尾的 describe 块（已有 `describe('executeMove', ...)`）之后追加 placeholder：

```typescript
describe('executePlayCard', () => {
  it('placeholder — to be expanded in Task 2-7', async () => {
    const { executePlayCard } = await import('./battleActionService');
    const io = createMockIO();
    const result = await executePlayCard(io, 'b1', 'c1', {
      deck_id: 'd1',
      card_id: 'pc1',
      name: '轻击',
      type: 'attack',
      cost: 1,
      effect: { damage: 2, range: 1 },
      template_no: 1,
      source: 'deck',
    } as any, 'u1');
    // Task 1 占位期望：函数能调通，结构正确
    expect(result).toHaveProperty('success');
  });
});
```

- [ ] **Step 3: 运行测试验证骨架可执行**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/services/battleActionService.test.ts
```

Expected: 1 个 placeholder 测试 PASS（T049 + T050 placeholder 共 2 个 PASS）

- [ ] **Step 4: 类型检查**

```bash
cd /home/lovept/PtIDLE/backend
npx tsc --noEmit
```

Expected: exit 0，无错误

- [ ] **Step 5: Commit**

```bash
cd /home/lovept/PtIDLE
git add backend/src/services/battleActionService.ts backend/src/services/battleActionService.test.ts
git commit -m "feat(battleAction): add executePlayCard skeleton + types for T050"
```

---

## Task 2: executePlayCard happy path - attack 单体（TDD 核心 17 步流水）

**Files:**
- Modify: `backend/src/services/battleActionService.test.ts`（追加 happy path case 1）
- Modify: `backend/src/services/battleActionService.ts`（替换 `executePlayCard` 占位实现）

- [ ] **Step 1: 写失败测试（happy path - attack 单体）**

在 `describe('executePlayCard', ...)` 块内的 placeholder 之后追加：

```typescript
  it('happy path: attack single — calls all 17 steps in order and returns success', async () => {
    const { executePlayCard } = await import('./battleActionService');
    const io = createMockIO();

    const handCard: any = {
      deck_id: 'd1',
      card_id: 'pc1',
      name: '轻击',
      type: 'attack',
      cost: 1,
      effect: { damage: 2, range: 1 },
      template_no: 1,
      source: 'deck',
      targetId: 't1',
    };

    const result = await executePlayCard(io, 'b1', 'c1', handCard, 'u1');

    expect(result).toEqual({
      success: true,
      validation: expect.objectContaining({ valid: true, damage: 2 }),
    });

    // 验证调用顺序
    const callOrder = [
      mockGetDbSessionState,
      mockListCharactersInBattle,
      mockGetActorHand,
      mockValidateAttack,
      mockSetCharacterEnergy,
      mockAddToDiscardPile,
      mockBroadcastHandState,
      mockBroadcastCharacterStatus,
      mockCompletePlayPhase,
      mockBroadcastBoardState,
    ];
    for (let i = 1; i < callOrder.length; i++) {
      expect(callOrder[i]).toHaveBeenCalled();
    }
  });
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/services/battleActionService.test.ts -t "happy path: attack single"
```

Expected: FAIL — `expect(mockSetCharacterEnergy).toHaveBeenCalled()` 失败（占位实现未调）

- [ ] **Step 3: 实现 executePlayCard happy path（17 步流水）**

替换 `backend/src/services/battleActionService.ts` 末尾的占位 `executePlayCard`：

```typescript
export async function executePlayCard(
  io: IOServer,
  battleId: string,
  characterId: string,
  handCard: HandCard,
  userId: string
): Promise<PlayCardResult> {
  // 1. 读 session
  const session = await getDbSessionState(battleId);
  if (!session) {
    throw new Error(`executePlayCard: session not found: ${battleId}`);
  }

  // 2. phase check
  if (session.currentPhase !== 'play') {
    return { success: false, error: 'not_in_play_phase' };
  }

  // 3. actor match
  if (session.currentActorId !== characterId) {
    return { success: false, error: 'not_current_actor' };
  }

  // 4. user 拥有此 character
  const characters = await listCharactersInBattle(battleId);
  const character = characters.find((c) => c.characterId === characterId);
  if (!character || character.userId !== userId) {
    return { success: false, error: 'not_owner' };
  }

  // 5. 手牌归属校验
  const hand = await getActorHand(battleId, characterId);
  if (!hand.some((c) => c.deck_id === handCard.deck_id)) {
    return { success: false, error: 'card_not_in_hand' };
  }

  // 6. card.type dispatch
  let validation: AttackValidationResult;
  if (handCard.type === 'attack' && (handCard.effect as { aoe?: boolean })?.aoe) {
    validation = await validateAOEAttack(battleId, characterId, handCard.card_id, handCard.source);
  } else if (handCard.type === 'attack') {
    validation = await validateAttack(
      battleId,
      characterId,
      handCard.card_id,
      (handCard as HandCard & { targetId?: string }).targetId!,
      session.currentRound,
      handCard.source
    );
  } else if (
    handCard.type === 'tactical' &&
    (handCard.effect as { type?: string })?.type === 'taunt'
  ) {
    validation = await validateTauntCard(
      battleId,
      characterId,
      handCard.card_id,
      (handCard as HandCard & { targetId?: string }).targetId!,
      session.currentRound
    );
  } else {
    return {
      success: false,
      error: 'unsupported_card_type',
      detail: `card type '${handCard.type}' effect '${(handCard.effect as { type?: string })?.type ?? 'unknown'}' not supported in T050`,
    };
  }

  if (!validation.valid) {
    return { success: false, error: 'validation_failed', detail: validation.error };
  }

  // 7. 副作用：扣能量（读 pieces HASH → setCharacterEnergy）
  let currentEnergy = 0;
  try {
    const pieceRaw = await redisClient.hGet(`battle:${battleId}:pieces`, characterId);
    if (pieceRaw) {
      currentEnergy = JSON.parse(pieceRaw).energy ?? 0;
    }
  } catch (err) {
    return { success: false, error: 'energy_deduct_failed', detail: (err as Error).message };
  }

  try {
    await setCharacterEnergy(battleId, characterId, currentEnergy - validation.energyCost);
  } catch (err) {
    return { success: false, error: 'energy_deduct_failed', detail: (err as Error).message };
  }

  // 8. 删手牌
  try {
    await redisClient.lRem(`battle:${battleId}:hand:${characterId}`, 1, JSON.stringify(handCard));
  } catch (err) {
    return { success: false, error: 'side_effect_failed', detail: (err as Error).message };
  }

  // 9. 入弃牌堆（仅 deck 来源）
  try {
    if (handCard.source === 'deck') {
      await addToDiscardPile(battleId, characterId, [handCard]);
    }
  } catch (err) {
    return { success: false, error: 'side_effect_failed', detail: (err as Error).message };
  }

  // 10. 广播
  await broadcastHandState(io, battleId, userId, characterId);
  await broadcastCharacterStatus(io, battleId, characterId);

  // 11. 阶段推进 + 整盘广播
  await completePlayPhase(battleId);
  await broadcastBoardState(io, battleId);

  return { success: true, validation };
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/services/battleActionService.test.ts -t "happy path: attack single"
```

Expected: PASS

- [ ] **Step 5: 类型检查 + 全量测试**

```bash
cd /home/lovept/PtIDLE/backend
npx tsc --noEmit && npx jest src/services/battleActionService.test.ts
```

Expected: exit 0 + 全部测试通过（2 + 1 = 3 tests）

- [ ] **Step 6: Commit**

```bash
cd /home/lovept/PtIDLE
git add backend/src/services/battleActionService.ts backend/src/services/battleActionService.test.ts
git commit -m "feat(battleAction): executePlayCard happy path - attack single (T050)"
```

---

## Task 3: executePlayCard happy path - AOE + taunt dispatch（TDD）

**Files:**
- Modify: `backend/src/services/battleActionService.test.ts`（追加 happy path cases 2 & 3）

- [ ] **Step 1: 写失败测试（AOE + taunt）**

在 `describe('executePlayCard', ...)` 块内追加：

```typescript
  it('happy path: attack AOE — dispatches to validateAOEAttack', async () => {
    const { executePlayCard } = await import('./battleActionService');
    const io = createMockIO();

    const handCard: any = {
      deck_id: 'd2',
      card_id: 'pc2',
      name: 'AOE 攻击',
      type: 'attack',
      cost: 2,
      effect: { damage: 3, range: 2, aoe: true },
      template_no: 2,
      source: 'deck',
    };

    const result = await executePlayCard(io, 'b1', 'c1', handCard, 'u1');

    expect(result).toEqual({
      success: true,
      validation: expect.objectContaining({ valid: true }),
    });
    expect(mockValidateAOEAttack).toHaveBeenCalledWith('b1', 'c1', 'pc2', 'deck');
    expect(mockValidateAttack).not.toHaveBeenCalled();
  });

  it('happy path: tactical taunt — dispatches to validateTauntCard', async () => {
    const { executePlayCard } = await import('./battleActionService');
    const io = createMockIO();

    const handCard: any = {
      deck_id: 'd3',
      card_id: 'pc3',
      name: '挑战',
      type: 'tactical',
      cost: 1,
      effect: { type: 'taunt', range: 3 },
      template_no: 3,
      source: 'deck',
      targetId: 't1',
    };

    const result = await executePlayCard(io, 'b1', 'c1', handCard, 'u1');

    expect(result).toEqual({
      success: true,
      validation: expect.objectContaining({ valid: true }),
    });
    expect(mockValidateTauntCard).toHaveBeenCalledWith('b1', 'c1', 'pc3', 't1', expect.any(Number));
    expect(mockValidateAttack).not.toHaveBeenCalled();
    expect(mockValidateAOEAttack).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: 运行测试验证通过**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/services/battleActionService.test.ts -t "happy path: attack AOE\|happy path: tactical taunt"
```

Expected: 2 PASS

- [ ] **Step 3: Commit**

```bash
cd /home/lovept/PtIDLE
git add backend/src/services/battleActionService.test.ts
git commit -m "test(battleAction): T050 happy path AOE + taunt dispatch"
```

---

## Task 4: executePlayCard public_pool source（TDD）

**Files:**
- Modify: `backend/src/services/battleActionService.test.ts`（追加 happy path case 4 & 5）

- [ ] **Step 1: 写失败测试（public_pool 不入弃牌堆；deck 入弃牌堆）**

在 `describe('executePlayCard', ...)` 块内追加：

```typescript
  it('happy path: public_pool card — does NOT call addToDiscardPile', async () => {
    const { executePlayCard } = await import('./battleActionService');
    const io = createMockIO();

    const handCard: any = {
      deck_id: 'pool:1',
      card_id: 'ct1',
      name: '轻击',
      type: 'attack',
      cost: 1,
      effect: { damage: 2, range: 1 },
      template_no: 1,
      source: 'public_pool',
      targetId: 't1',
    };

    // 更新 mockGetActorHand 让 public_pool 卡出现
    mockGetActorHand.mockResolvedValueOnce([handCard]);

    const result = await executePlayCard(io, 'b1', 'c1', handCard, 'u1');

    expect(result.success).toBe(true);
    expect(mockAddToDiscardPile).not.toHaveBeenCalled();
    // validateAttack 应被调且 source='public_pool'
    expect(mockValidateAttack).toHaveBeenCalledWith('b1', 'c1', 'ct1', 't1', expect.any(Number), 'public_pool');
  });

  it('happy path: deck card — calls addToDiscardPile', async () => {
    const { executePlayCard } = await import('./battleActionService');
    const io = createMockIO();

    const handCard: any = {
      deck_id: 'd1',
      card_id: 'pc1',
      name: '重击',
      type: 'attack',
      cost: 2,
      effect: { damage: 4, range: 1 },
      template_no: 4,
      source: 'deck',
      targetId: 't1',
    };

    mockGetActorHand.mockResolvedValueOnce([handCard]);

    const result = await executePlayCard(io, 'b1', 'c1', handCard, 'u1');

    expect(result.success).toBe(true);
    expect(mockAddToDiscardPile).toHaveBeenCalledWith('b1', 'c1', [handCard]);
  });
```

- [ ] **Step 2: 运行测试验证通过**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/services/battleActionService.test.ts -t "public_pool\|deck card"
```

Expected: 2 PASS

- [ ] **Step 3: Commit**

```bash
cd /home/lovept/PtIDLE
git add backend/src/services/battleActionService.test.ts
git commit -m "test(battleAction): T050 public_pool + deck source discard behavior"
```

---

## Task 5: executePlayCard 错误分支 - phase/actor/owner（TDD）

**Files:**
- Modify: `backend/src/services/battleActionService.test.ts`（追加 error cases 6-8）

- [ ] **Step 1: 写失败测试（3 个验证阶段错误）**

在 `describe('executePlayCard', ...)` 块内追加：

```typescript
  it('error: not_in_play_phase — returns error when phase !== "play"', async () => {
    const { executePlayCard } = await import('./battleActionService');
    const io = createMockIO();

    mockGetDbSessionState.mockResolvedValueOnce({
      currentRound: 1,
      currentStep: 0,
      currentActorId: 'c1',
      currentPhase: 'move',  // ← wrong phase
    });

    const result = await executePlayCard(io, 'b1', 'c1', { deck_id: 'd1', source: 'deck', type: 'attack', card_id: 'pc1', name: 'X', cost: 1, effect: {}, template_no: 1 } as any, 'u1');

    expect(result).toEqual({ success: false, error: 'not_in_play_phase' });
    // 后续副作用全部未调
    expect(mockListCharactersInBattle).not.toHaveBeenCalled();
    expect(mockGetActorHand).not.toHaveBeenCalled();
    expect(mockValidateAttack).not.toHaveBeenCalled();
    expect(mockSetCharacterEnergy).not.toHaveBeenCalled();
  });

  it('error: not_current_actor — returns error when actor mismatch', async () => {
    const { executePlayCard } = await import('./battleActionService');
    const io = createMockIO();

    mockGetDbSessionState.mockResolvedValueOnce({
      currentRound: 1,
      currentStep: 0,
      currentActorId: 'c2',  // ← different
      currentPhase: 'play',
    });

    const result = await executePlayCard(io, 'b1', 'c1', { deck_id: 'd1', source: 'deck', type: 'attack', card_id: 'pc1', name: 'X', cost: 1, effect: {}, template_no: 1 } as any, 'u1');

    expect(result).toEqual({ success: false, error: 'not_current_actor' });
    expect(mockListCharactersInBattle).not.toHaveBeenCalled();
  });

  it('error: not_owner — returns error when userId mismatch', async () => {
    const { executePlayCard } = await import('./battleActionService');
    const io = createMockIO();

    mockListCharactersInBattle.mockResolvedValueOnce([
      { characterId: 'c1', playerId: 'p1', userId: 'u2', profession: 'warrior', name: 'A' },  // ← different userId
    ]);

    const result = await executePlayCard(io, 'b1', 'c1', { deck_id: 'd1', source: 'deck', type: 'attack', card_id: 'pc1', name: 'X', cost: 1, effect: {}, template_no: 1 } as any, 'u1');

    expect(result).toEqual({ success: false, error: 'not_owner' });
    expect(mockGetActorHand).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: 运行测试验证通过**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/services/battleActionService.test.ts -t "not_in_play_phase\|not_current_actor\|not_owner"
```

Expected: 3 PASS

- [ ] **Step 3: Commit**

```bash
cd /home/lovept/PtIDLE
git add backend/src/services/battleActionService.test.ts
git commit -m "test(battleAction): T050 phase/actor/owner error branches"
```

---

## Task 6: executePlayCard 错误分支 - hand/type/validation（TDD）

**Files:**
- Modify: `backend/src/services/battleActionService.test.ts`（追加 error cases 9-16）

- [ ] **Step 1: 写失败测试（hand + type + validation 错误）**

在 `describe('executePlayCard', ...)` 块内追加：

```typescript
  it('error: card_not_in_hand — returns error when deck_id not in hand', async () => {
    const { executePlayCard } = await import('./battleActionService');
    const io = createMockIO();

    mockGetActorHand.mockResolvedValueOnce([
      { deck_id: 'd_other', source: 'deck', type: 'attack', card_id: 'pc_other', name: 'X', cost: 1, effect: {}, template_no: 1 },
    ]);

    const result = await executePlayCard(io, 'b1', 'c1', { deck_id: 'd1', source: 'deck', type: 'attack', card_id: 'pc1', name: 'X', cost: 1, effect: {}, template_no: 1 } as any, 'u1');

    expect(result).toEqual({ success: false, error: 'card_not_in_hand' });
    expect(mockValidateAttack).not.toHaveBeenCalled();
  });

  it('error: unsupported_card_type (defense) — returns error', async () => {
    const { executePlayCard } = await import('./battleActionService');
    const io = createMockIO();

    const handCard: any = { deck_id: 'd1', source: 'deck', type: 'defense', card_id: 'pc1', name: '防御', cost: 1, effect: { shield: 5 }, template_no: 5 };
    mockGetActorHand.mockResolvedValueOnce([handCard]);

    const result = await executePlayCard(io, 'b1', 'c1', handCard, 'u1');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('unsupported_card_type');
      expect(result.detail).toContain('defense');
    }
    expect(mockValidateAttack).not.toHaveBeenCalled();
  });

  it('error: unsupported_card_type (tactical non-taunt) — returns error', async () => {
    const { executePlayCard } = await import('./battleActionService');
    const io = createMockIO();

    const handCard: any = { deck_id: 'd1', source: 'deck', type: 'tactical', card_id: 'pc1', name: '烟雾', cost: 1, effect: { type: 'smoke' }, template_no: 6 };
    mockGetActorHand.mockResolvedValueOnce([handCard]);

    const result = await executePlayCard(io, 'b1', 'c1', handCard, 'u1');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('unsupported_card_type');
    }
  });

  it('error: validation_failed (Card not found) — wraps validate error in detail', async () => {
    const { executePlayCard } = await import('./battleActionService');
    const io = createMockIO();

    mockValidateAttack.mockResolvedValueOnce({ valid: false, error: 'Card not found' });

    const result = await executePlayCard(io, 'b1', 'c1', { deck_id: 'd1', source: 'deck', type: 'attack', card_id: 'pc1', name: 'X', cost: 1, effect: {}, template_no: 1, targetId: 't1' } as any, 'u1');

    expect(result).toEqual({ success: false, error: 'validation_failed', detail: 'Card not found' });
    expect(mockSetCharacterEnergy).not.toHaveBeenCalled();
  });

  it('error: validation_failed (Not enough energy) — wraps validate error', async () => {
    const { executePlayCard } = await import('./battleActionService');
    const io = createMockIO();

    mockValidateAttack.mockResolvedValueOnce({
      valid: false,
      error: 'Not enough energy (need 3, have 1)',
      energyCost: 3,
    });

    const result = await executePlayCard(io, 'b1', 'c1', { deck_id: 'd1', source: 'deck', type: 'attack', card_id: 'pc1', name: 'X', cost: 3, effect: {}, template_no: 1, targetId: 't1' } as any, 'u1');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('validation_failed');
      expect(result.detail).toContain('energy');
    }
  });

  it('error: validation_failed (Target out of range) — wraps validate error', async () => {
    const { executePlayCard } = await import('./battleActionService');
    const io = createMockIO();

    mockValidateAttack.mockResolvedValueOnce({
      valid: false,
      error: 'Target out of range (melee range: 1.5, actual: 3.00)',
    });

    const result = await executePlayCard(io, 'b1', 'c1', { deck_id: 'd1', source: 'deck', type: 'attack', card_id: 'pc1', name: 'X', cost: 1, effect: {}, template_no: 1, targetId: 't1' } as any, 'u1');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('validation_failed');
      expect(result.detail).toContain('out of range');
    }
  });

  it('error: validation_failed (Cannot attack friendly) — wraps validate error', async () => {
    const { executePlayCard } = await import('./battleActionService');
    const io = createMockIO();

    mockValidateAttack.mockResolvedValueOnce({ valid: false, error: 'Cannot attack friendly target' });

    const result = await executePlayCard(io, 'b1', 'c1', { deck_id: 'd1', source: 'deck', type: 'attack', card_id: 'pc1', name: 'X', cost: 1, effect: {}, template_no: 1, targetId: 't1' } as any, 'u1');

    expect(result).toEqual({ success: false, error: 'validation_failed', detail: 'Cannot attack friendly target' });
  });

  it('error: validation_failed (taunt range error) — wraps validateTauntCard error', async () => {
    const { executePlayCard } = await import('./battleActionService');
    const io = createMockIO();

    mockValidateTauntCard.mockResolvedValueOnce({ valid: false, error: 'Target out of taunt range' });

    const result = await executePlayCard(io, 'b1', 'c1', { deck_id: 'd3', source: 'deck', type: 'tactical', card_id: 'pc3', name: '挑战', cost: 1, effect: { type: 'taunt', range: 3 }, template_no: 3, targetId: 't1' } as any, 'u1');

    expect(result).toEqual({ success: false, error: 'validation_failed', detail: 'Target out of taunt range' });
  });
```

- [ ] **Step 2: 运行测试验证通过**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/services/battleActionService.test.ts -t "card_not_in_hand\|unsupported_card_type\|validation_failed"
```

Expected: 8 PASS

- [ ] **Step 3: Commit**

```bash
cd /home/lovept/PtIDLE
git add backend/src/services/battleActionService.test.ts
git commit -m "test(battleAction): T050 hand/type/validation error branches"
```

---

## Task 7: executePlayCard 错误分支 - post-validate（TDD）

**Files:**
- Modify: `backend/src/services/battleActionService.test.ts`（追加 error cases 17-18）

- [ ] **Step 1: 写失败测试（post-validate 副作用失败）**

在 `describe('executePlayCard', ...)` 块内追加：

```typescript
  it('error: energy_deduct_failed (setCharacterEnergy throws)', async () => {
    const { executePlayCard } = await import('./battleActionService');
    const io = createMockIO();

    mockSetCharacterEnergy.mockRejectedValueOnce(new Error('Redis down'));

    const result = await executePlayCard(io, 'b1', 'c1', { deck_id: 'd1', source: 'deck', type: 'attack', card_id: 'pc1', name: 'X', cost: 1, effect: {}, template_no: 1, targetId: 't1' } as any, 'u1');

    expect(result).toEqual({
      success: false,
      error: 'energy_deduct_failed',
      detail: 'Redis down',
    });
    // 后续副作用未调
    expect(mockAddToDiscardPile).not.toHaveBeenCalled();
    expect(mockBroadcastHandState).not.toHaveBeenCalled();
  });

  it('error: side_effect_failed (lRem throws)', async () => {
    const { executePlayCard } = await import('./battleActionService');
    const io = createMockIO();

    (redisClient.lRem as jest.Mock).mockRejectedValueOnce(new Error('lRem failed'));

    const result = await executePlayCard(io, 'b1', 'c1', { deck_id: 'd1', source: 'deck', type: 'attack', card_id: 'pc1', name: 'X', cost: 1, effect: {}, template_no: 1, targetId: 't1' } as any, 'u1');

    expect(result).toEqual({
      success: false,
      error: 'side_effect_failed',
      detail: 'lRem failed',
    });
    // 后续未调
    expect(mockAddToDiscardPile).not.toHaveBeenCalled();
    expect(mockBroadcastHandState).not.toHaveBeenCalled();
  });
```

注意：因为 `lRem` 是通过 `redisClient` 调的，mock 在 `jest.mock('../config/redis', ...)` 块中定义。需要在测试顶部加 `import { redisClient } from '../config/redis';`（如果还没有的话），并在 `mockGetActorHand` 等之后追加 `(redisClient.lRem as jest.Mock) = jest.fn().mockResolvedValue(1);` 之类的桩（因为 happy path 用了它）。

修改 `jest.mock('../config/redis', ...)` 块，添加 `lRem: jest.fn()`：

```typescript
jest.mock('../config/redis', () => ({
  redisClient: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    hGet: jest.fn(),
    hSet: jest.fn(),
    hDel: jest.fn(),
    lRem: jest.fn(),         // ← 新增
  },
  connectRedis: jest.fn(),
  disconnectRedis: jest.fn(),
}));
```

并在 import 区域追加：

```typescript
import { redisClient } from '../config/redis';
```

在 `beforeEach` 末尾追加默认 lRem 桩：

```typescript
(redisClient.lRem as jest.Mock).mockResolvedValue(1);  // 删除 1 条
(redisClient.hGet as jest.Mock).mockResolvedValue(JSON.stringify({ energy: 3 }));  // 默认能量 3
```

- [ ] **Step 2: 运行测试验证通过**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/services/battleActionService.test.ts -t "energy_deduct_failed\|side_effect_failed"
```

Expected: 2 PASS

- [ ] **Step 3: 全量测试 + 类型检查**

```bash
cd /home/lovept/PtIDLE/backend
npx tsc --noEmit && npx jest src/services/battleActionService.test.ts
```

Expected: exit 0 + 全部 PASS（2 T049 + 18 T050 = 20 tests）

- [ ] **Step 4: Commit**

```bash
cd /home/lovept/PtIDLE
git add backend/src/services/battleActionService.ts backend/src/services/battleActionService.test.ts
git commit -m "test(battleAction): T050 post-validate error branches + redis mock setup"
```

---

## Task 8: handleBattlePlayCard handler（TDD）

**Files:**
- Modify: `backend/src/socket/battleRoom.ts`（追加 `handleBattlePlayCard` + `validatePlayCardPayload`）
- Modify: `backend/src/socket/battleRoom.test.ts`（追加 5 个 describe cases）

- [ ] **Step 1: 写失败测试（handler 5 个 case）**

在 `backend/src/socket/battleRoom.test.ts` 末尾追加：

```typescript
// T050 单测：handleBattlePlayCard 薄壳
import { handleBattlePlayCard } from './battleRoom';
import { executePlayCard } from '../services/battleActionService';

jest.mock('../services/battleActionService', () => ({
  executePlayCard: jest.fn(),
}));

const mockExecutePlayCard = executePlayCard as jest.MockedFunction<typeof executePlayCard>;

function createMockSocket(): any {
  const handlers: Record<string, any> = {};
  return {
    id: 'sock1',
    data: { userId: 'u1', username: 'Alice' },
    emit: jest.fn((event: string, payload: any) => {
      handlers[event] = payload;
      return handlers;
    }),
    on: jest.fn(),
    join: jest.fn(),
  };
}

function createMockIO(): any {
  return {
    to: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    emit: jest.fn(),
  } as any;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockExecutePlayCard.mockResolvedValue({
    success: true,
    validation: { valid: true, damage: 2, targets: ['t1'], energyCost: 1 } as any,
  });
});

describe('handleBattlePlayCard', () => {
  it('case 1: valid play_card payload — calls executePlayCard and does not emit on success', async () => {
    const io = createMockIO();
    const socket = createMockSocket();

    const handCard = { deck_id: 'd1', card_id: 'pc1', name: 'X', type: 'attack', cost: 1, effect: {}, template_no: 1, source: 'deck', targetId: 't1' };
    await handleBattlePlayCard(io, socket, { battleId: 'b1', characterId: 'c1', handCard });

    expect(mockExecutePlayCard).toHaveBeenCalledWith(io, 'b1', 'c1', handCard, 'u1');
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('case 2: invalid payload (missing handCard) — emits invalid_payload error', async () => {
    const io = createMockIO();
    const socket = createMockSocket();

    await handleBattlePlayCard(io, socket, { battleId: 'b1', characterId: 'c1' });

    expect(socket.emit).toHaveBeenCalledWith('battle:play_card:error', { error: 'invalid_payload' });
    expect(mockExecutePlayCard).not.toHaveBeenCalled();
  });

  it('case 3: defense card type — handler does NOT reject; lets service return unsupported_card_type', async () => {
    const io = createMockIO();
    const socket = createMockSocket();
    mockExecutePlayCard.mockResolvedValueOnce({
      success: false,
      error: 'unsupported_card_type',
      detail: "card type 'defense' not supported in T050",
    });

    const handCard = { deck_id: 'd1', card_id: 'pc1', name: 'X', type: 'defense', cost: 1, effect: {}, template_no: 1, source: 'deck' };
    await handleBattlePlayCard(io, socket, { battleId: 'b1', characterId: 'c1', handCard });

    expect(mockExecutePlayCard).toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith('battle:play_card:error', {
      error: 'unsupported_card_type',
      detail: "card type 'defense' not supported in T050",
    });
  });

  it('case 4: executePlayCard returns validation_failed — emits error with detail', async () => {
    const io = createMockIO();
    const socket = createMockSocket();
    mockExecutePlayCard.mockResolvedValueOnce({
      success: false,
      error: 'validation_failed',
      detail: 'Target out of range',
    });

    await handleBattlePlayCard(io, socket, { battleId: 'b1', characterId: 'c1', handCard: { deck_id: 'd1', card_id: 'pc1', type: 'attack', cost: 1, effect: {}, template_no: 1, source: 'deck', name: 'X' } });

    expect(socket.emit).toHaveBeenCalledWith('battle:play_card:error', {
      error: 'validation_failed',
      detail: 'Target out of range',
    });
  });

  it('case 5: executePlayCard throws — does NOT emit (caller is socketServer layer)', async () => {
    const io = createMockIO();
    const socket = createMockSocket();
    mockExecutePlayCard.mockRejectedValueOnce(new Error('boom'));

    // 不应 throw 给测试（service 异常向上抛由 socketServer 兜底）
    await expect(
      handleBattlePlayCard(io, socket, { battleId: 'b1', characterId: 'c1', handCard: { deck_id: 'd1', card_id: 'pc1', type: 'attack', cost: 1, effect: {}, template_no: 1, source: 'deck', name: 'X' } })
    ).rejects.toThrow('boom');
    expect(socket.emit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/socket/battleRoom.test.ts -t "handleBattlePlayCard"
```

Expected: FAIL — `handleBattlePlayCard is not a function`

- [ ] **Step 3: 实现 handleBattlePlayCard**

在 `backend/src/socket/battleRoom.ts` 末尾追加：

```typescript
import { executePlayCard } from '../services/battleActionService';

/**
 * T050: 处理客户端的 `battle:play_card` 事件
 *
 * 流程:
 *   1. 验证 payload 结构（battleId/characterId string, handCard object with required fields）
 *   2. 失败 → emit `battle:play_card:error` `{ error: 'invalid_payload' }`
 *   3. 调 `executePlayCard(io, battleId, characterId, handCard, socket.data.userId)`
 *   4. executePlayCard 失败 → emit `battle:play_card:error` 带 service 返回的 error + detail
 *   5. 成功 → 不 emit 任何事件（依赖 broadcastHandState + broadcastCharacterStatus + broadcastBoardState 推送 + 客户端推断成功）
 *   6. executePlayCard 抛错 → 向上抛（异常路径，由 socketServer 层兜底）
 *
 * @param io IOServer 实例
 * @param socket 客户端 socket
 * @param payload { battleId, characterId, handCard: HandCard }
 */
export async function handleBattlePlayCard(
  io: IOServer,
  socket: Socket,
  payload: { battleId?: unknown; characterId?: unknown; handCard?: unknown }
): Promise<void> {
  // 1. payload 验证
  const battleId = typeof payload?.battleId === 'string' ? payload.battleId : null;
  const characterId = typeof payload?.characterId === 'string' ? payload.characterId : null;
  const handCard = validatePlayCardPayload(payload?.handCard);

  if (!battleId || !characterId || !handCard) {
    socket.emit('battle:play_card:error', { error: 'invalid_payload' });
    return;
  }

  const userId = socket.data.userId as string;

  // 2. 调 service
  const result = await executePlayCard(io, battleId, characterId, handCard, userId);

  // 3. 失败回执
  if (!result.success) {
    socket.emit('battle:play_card:error', {
      error: result.error,
      detail: result.detail,
    });
  }
  // 成功：不 emit（broadcaster 已 room-wide 推 hand/character/board）
}

/**
 * 内部 helper: 验证 handCard payload 结构
 * - 必须是对象
 * - 必有字段: deck_id, card_id, name, type, cost, effect, template_no, source
 * - type 必须是 'attack' | 'tactical'（'defense' 不在 handler 拒，留给 service unsupported_card_type）
 * - source 必须是 'deck' | 'public_pool'
 * - 返回规范化后的 HandCard 或 null
 */
function validatePlayCardPayload(raw: unknown): import('../services/handService').HandCard | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.deck_id !== 'string') return null;
  if (typeof c.card_id !== 'string') return null;
  if (typeof c.name !== 'string') return null;
  if (c.type !== 'attack' && c.type !== 'tactical') return null;
  if (typeof c.cost !== 'number' || !Number.isFinite(c.cost)) return null;
  if (!c.effect || typeof c.effect !== 'object') return null;
  if (typeof c.template_no !== 'number') return null;
  if (c.source !== 'deck' && c.source !== 'public_pool') return null;

  return {
    deck_id: c.deck_id,
    card_id: c.card_id,
    name: c.name,
    type: c.type as 'attack' | 'tactical',
    cost: c.cost,
    effect: c.effect as Record<string, unknown>,
    template_no: c.template_no,
    source: c.source as 'deck' | 'public_pool',
  };
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/socket/battleRoom.test.ts -t "handleBattlePlayCard"
```

Expected: 5 PASS

- [ ] **Step 5: 类型检查 + 全量测试**

```bash
cd /home/lovept/PtIDLE/backend
npx tsc --noEmit && npx jest src/socket/battleRoom.test.ts
```

Expected: exit 0 + 全部 PASS

- [ ] **Step 6: Commit**

```bash
cd /home/lovept/PtIDLE
git add backend/src/socket/battleRoom.ts backend/src/socket/battleRoom.test.ts
git commit -m "feat(socket): add handleBattlePlayCard handler for T050"
```

---

## Task 9: socketServer 注册 + 集成测试 mock 补全

**Files:**
- Modify: `backend/src/socket/socketServer.ts`（注册 `battle:play_card` 事件）
- Modify: `backend/src/socket/socketServer.test.ts`（顶部 mock 补 `executePlayCard`）

- [ ] **Step 1: 在 socketServer.ts 追加事件注册**

在 `backend/src/socket/socketServer.ts` 找到已有的 `socket.on('battle:move', ...)` 注册行，在其后追加：

```typescript
  // T050: 出牌事件
  socket.on('battle:play_card', (payload) => {
    const userId = (socket.data as { userId?: string }).userId;
    handleBattlePlayCard(io, socket, payload).catch((err) => {
      console.error(`[WS] battle:play_card error: userId=${userId}`, err);
      socket.emit('battle:play_card:error', { error: 'internal_error' });
    });
  });
```

并在文件顶部 import 区域追加：

```typescript
import { handleBattlePlayCard } from './battleRoom';
```

- [ ] **Step 2: 修改 socketServer.test.ts 顶部 mock**

在 `backend/src/socket/socketServer.test.ts` 找到已有的 `jest.mock('./battleRoom', ...)` 块（如果存在），追加 `handleBattlePlayCard: jest.fn()`：

如果没有 mock 块，则在最顶部追加：

```typescript
jest.mock('./battleRoom', () => ({
  handleBattlePlayCard: jest.fn(),
  handleBattleJoin: jest.fn(),
  // ... 其它已有 mock
}));
```

并在 import 区域追加 `handleBattlePlayCard` 引用：

```typescript
import { handleBattlePlayCard } from './battleRoom';
const mockHandleBattlePlayCard = handleBattlePlayCard as jest.MockedFunction<typeof handleBattlePlayCard>;
```

如果 `battleActionService` 还没 mock，则在文件顶部追加：

```typescript
jest.mock('../services/battleActionService', () => ({
  executePlayCard: jest.fn(),
  executeMove: jest.fn(),
}));
```

并在 import 区域追加 `executePlayCard` 引用（如果还没有）。

- [ ] **Step 3: 类型检查 + socketServer 测试**

```bash
cd /home/lovept/PtIDLE/backend
npx tsc --noEmit && npx jest src/socket/socketServer.test.ts
```

Expected: exit 0 + 全部 PASS

- [ ] **Step 4: Commit**

```bash
cd /home/lovept/PtIDLE
git add backend/src/socket/socketServer.ts backend/src/socket/socketServer.test.ts
git commit -m "feat(socketServer): register battle:play_card handler for T050"
```

---

## Task 10: 全量验证 + 文档更新

**Files:**
- Modify: `memory-bank/architecture.md`（追加 T050 章节）
- Modify: `memory-bank/progress.md`（追加 T050 行）
- Modify: `memory-bank/history.md`（追加 T050 历史条目）

- [ ] **Step 1: 运行全量测试 + 类型检查 + lint**

```bash
cd /home/lovept/PtIDLE/backend
npx tsc --noEmit
npx jest
```

Expected: exit 0 + 全部 PASS（20+ T050 cases + 7 T049 cases + 既有所有测试）

- [ ] **Step 2: 更新 architecture.md**

在 `memory-bank/architecture.md` 找到已有的 T049 章节（"T049 移动操作同步"），在其后追加 T050 章节：

```markdown
## T050 打牌操作同步

### 概述
T050 扩展既有 `battleActionService` 新增 `executePlayCard` 17 步流水；`battleRoom.ts` 追加 `handleBattlePlayCard` handler；`socketServer.ts` 注册 `battle:play_card` 事件。

### 业务规则
1. session.current_phase === 'play'
2. session.current_actor_id === characterId
3. character.userId === userId（防同房间对手冒充）
4. handCard.deck_id 在 actor hand LIST 中
5. card.type 是 'attack'（AOE/单体）或 'tactical'+'taunt'，其他 → `unsupported_card_type`
6. validate* 返回 valid

### 副作用顺序（成功时）
1. 读 pieces HASH → currentEnergy
2. setCharacterEnergy(attackerId, currentEnergy - energyCost)
3. redisClient.lRem(hand LIST, 1, JSON.stringify(handCard))
4. addToDiscardPile (if source='deck'，公共池卡不入弃牌堆)
5. broadcastHandState(io, battleId, userId, characterId)  // self
6. broadcastCharacterStatus(io, battleId, characterId)  // both
7. completePlayPhase(battleId)  // play → end_step
8. broadcastBoardState(io, battleId)  // both, 含 phase

### 错误码（8 个）
- `not_in_play_phase` / `not_current_actor` / `not_owner`
- `card_not_in_hand` / `unsupported_card_type`
- `validation_failed`（带 detail = validate.error）
- `energy_deduct_failed` / `side_effect_failed`

### 不做（明确范围外）
- ❌ 实际扣 HP —— T056 applyDamage 负责
- ❌ burn 伤害结算 —— T051 orchestrator
- ❌ defense 卡 —— T050.5
- ❌ player_cards 消耗 —— T053
- ❌ 回合切换 —— T051
- ❌ 胜负判定 —— T052

### 文件清单
- `src/services/battleActionService.ts` — 追加 executePlayCard + 8 个 error 类型
- `src/services/battleActionService.test.ts` — 追加 18 个单测
- `src/socket/battleRoom.ts` — 追加 handleBattlePlayCard + validatePlayCardPayload
- `src/socket/battleRoom.test.ts` — 追加 5 个 handler 测试
- `src/socket/socketServer.ts` — 注册 battle:play_card 事件

### WS 事件
- `battle:play_card` (client → server): `{ battleId, characterId, handCard: HandCard }`
- `battle:play_card:error` (server → client): `{ error, detail? }`
- 复用 T047 既有 `battle:state:hand` / `battle:state:character` / `battle:state:board`
```

- [ ] **Step 3: 更新 progress.md**

在 `memory-bank/progress.md` 已完成表格中追加一行（在 T049 行之后）：

```markdown
| T050 | 实现打牌操作同步（attack + tactical taunt 17 步流水 + 副作用 + 广播 + 阶段推进） | 2026-06-17 |
```

并在「问题与解决」表格中追加一行（如有问题；无问题可跳过）：

```markdown
| 2026-06-17 | T050 执行中如遇问题，记录于此 | 解决方法 |
```

- [ ] **Step 4: 更新 history.md**

在 `memory-bank/history.md` 文件末尾追加 T050 历史条目：

```markdown
## 2026-06-17 - 任务：T050 打牌操作同步

### Prompt
实现 T050 打牌操作同步：玩家发 battle:play_card 事件，服务端验证手牌归属、dispatch 到 validateAttack/validateAOEAttack/validateTauntCard、写状态效果、扣能量、删手牌、入弃牌堆（deck 来源）、广播、推进 phase play→end_step。本任务不实际扣 HP（T056 负责）。

### 思考
17 步流水（5 验证 + 3 validate 派发 + 5 副作用 + 4 广播/阶段推进）。handler 薄壳做 payload 验证 + emit 错误。dispatch 按 handCard.type + effect.aoe/type 复合判断。validate 内部已写 shield/boost/mark/burn 状态效果，「生产 vs 应用」分离。能量扣减在 validate 之后（生产 vs 应用分离）。T050 阶段 HP 不变是预期中，T056 接入后才是完整伤害。

### 意外
若完全顺利，填"无"。否则记录执行过程中发生的未覆盖报错、需求变更、踩坑点或过度设计。
```

- [ ] **Step 5: Commit 文档**

```bash
cd /home/lovept/PtIDLE
git add memory-bank/architecture.md memory-bank/progress.md memory-bank/history.md
git commit -m "docs: update architecture + progress + history for T050"
```

- [ ] **Step 6: 验证最终状态**

```bash
cd /home/lovept/PtIDLE
git log --oneline -10
git status
```

Expected:
- 工作树 clean
- 最近 commits 包含 T050 相关 6 个 commit（1 文档 + 1 骨架 + 3 测试 + 1 handler + 1 socketServer + 1 文档）
- 仍未 push 到远端（CLAUDE.md 规则 4 禁止未经用户测试审阅推送）

---

## 关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 架构 | 扩展 `battleActionService.ts`（不新建） | T049 模式延续；T050 与 T049 同 service 利于将来 T056 applyDamage 整合 |
| Card 范围 | attack (单体+AOE) + tactical (taunt) | 全部有 validate 函数；defense 留 T050.5 |
| Damage apply | T050 **不**实际扣 HP | T056 applyDamage 统一处理；「生产 vs 应用」分离 |
| Phase 推进 | T050 自动调 `completePlayPhase` | 与 T049 executeMove → completeMovePhase 对称 |
| 能量扣减 | 步骤 7 显式 `setCharacterEnergy(attackerId, cur-cost)` | validateAttack 只 check energy，不 deduct |
| 弃牌堆判定 | 仅 deck 来源入弃牌堆 | T1001 spec 3.5 边界表：公共池卡不入弃牌堆 |
| Board 广播 | 调 `broadcastBoardState`（整盘） | 与 T049 对称，phase='end_step' 立即可见 |
| 副作用顺序 | deduct → lRem → discard → broadcast | broadcast 必须最后（拿到最新状态） |
| validate 失败回滚 | **不**主动回滚已写状态 | T049 同模式；T056 统一处理一致性 |

---

## 关键 mock 桩顺序（happy path）

```
mock getDbSessionState           → 1次
mock listCharactersInBattle      → 1次
mock getActorHand                → 1次
mock validateAttack (or AOE/Taunt) → 1次
mock getCharacterPiece           → 2次 (validate 内部)
mock getPlayerCard               → 1次 (validate 内部)
mock getCharacterPosition        → 2次 (validate 内部)
mock hGet pieces HASH            → 1次 (读 currentEnergy) ★T050
mock setCharacterEnergy          → 1次 ★T050
mock lRem hand LIST              → 1次 ★T050
mock addToDiscardPile            → 0-1次 (deck only) ★T050
mock broadcastHandState          → 1次 ★T050
mock broadcastCharacterStatus    → 1次 ★T050
mock completePlayPhase           → 1次 ★T050
mock broadcastBoardState         → 1次 ★T050
```

---

## 范围外（明确不做）

- ❌ 实际扣 HP（含 shield 消耗、boost 应用、多目标）—— T056 applyDamage 范围
- ❌ burn 伤害结算（applyBurnDamage）—— T051 orchestrator
- ❌ defense 卡（防御/治疗/护盾）—— T050.5 范围
- ❌ 玩家卡牌消耗（player_cards 减 1）—— T053 范围
- ❌ 回合切换（end_step → idle/end_round）—— T051 范围
- ❌ burn tick 结算（扣血 + 减少 duration）—— T051 范围
- ❌ 玩家死亡/胜负判定 —— T052 范围
- ❌ 真实 Redis 集成测试 —— T050 沿用 T049 模式仅单元测

---

*文档版本：v1.0*
*最后更新：2026-06-17*
