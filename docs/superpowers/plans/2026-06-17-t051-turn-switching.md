# T051 回合切换 Orchestrator 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 3v3 战棋对战的回合切换 orchestrator —— 服务端级联触发「保留手牌 → (last step?) burn+effect tick + 切 round → 推进 step → 切换 actor → 抽牌」流水；新增 `battle:skip_play` 客户端事件让玩家跳过 play 阶段。T050 的 `executePlayCard` 末尾自动调用本任务的 `executeEndStep` 完成 play → end_step 级联。

**Architecture:** 扩展既有 `battleActionService` 新增 `executeEndStep`（11 步主流水）和 `executeRoundEnd`（5 步子流水，由 `executeEndStep` 在 last step 时调用）。扩展 `professionMechanicService` 新增 `tickBurnDamageOnTarget` helper（applyBurnDamage + 减 HP + 写回）。扩展 `battleStateBroadcaster` 新增 `broadcastSessionState`。新增 `handleBattleSkipPlay` handler；`socketServer` 注册 `battle:skip_play` 事件。

**Tech Stack:** Node.js + TypeScript + Express + Socket.io + PostgreSQL + Redis（v4 client）+ Jest + ts-jest

**Spec:** `docs/superpowers/specs/2026-06-17-t051-turn-switching-design.md`

---

## File Structure

```
backend/
├── src/
│   ├── services/
│   │   ├── battleActionService.ts            [MODIFY] +executeEndStep + executeRoundEnd + StepEndResult + StepEndError
│   │   │                                          + 1-line wire T050 executePlayCard 末尾
│   │   ├── battleActionService.test.ts       [MODIFY] +15 单测 (5 happy + 8 error + 2 special)
│   │   ├── professionMechanicService.ts      [MODIFY] +tickBurnDamageOnTarget 导出
│   │   └── professionMechanicService.test.ts [MODIFY] +4 tickBurnDamageOnTarget 单测
│   ├── socket/
│   │   ├── battleStateBroadcaster.ts         [MODIFY] +broadcastSessionState 导出
│   │   ├── battleStateBroadcaster.test.ts    [MODIFY] +1 broadcastSessionState case
│   │   ├── battleRoom.ts                     [MODIFY] +handleBattleSkipPlay 导出
│   │   ├── battleRoom.test.ts                [MODIFY] +6 handleBattleSkipPlay describe cases
│   │   ├── socketServer.ts                   [MODIFY] +socket.on('battle:skip_play', ...)
│   │   └── socketServer.test.ts              [MODIFY] 顶部 mock 补 executeEndStep
```

---

## Task 1: tickBurnDamageOnTarget helper（TDD 基础 — 后续任务依赖）

**Files:**
- Modify: `backend/src/services/professionMechanicService.ts` (在 `applyBurnDamage` 之后追加)
- Modify: `backend/src/services/professionMechanicService.test.ts` (在文件末尾追加 describe 块)

- [ ] **Step 1: 写测试 — happy path (target 有 burn effect, HP 减 1, is_alive 不变)**

在 `backend/src/services/professionMechanicService.test.ts` 顶部既有 mock setup 之后追加（**注意 ts-jest TDZ pitfall**：mock 块 + const mockXxx 必须先于 import；如该文件 mock 已存在则直接追加）：

```typescript
// 追加 mock imports
jest.mock('./battleService', () => ({
  // ... 已有 mock ...
}));

import { tickBurnDamageOnTarget } from './professionMechanicService';

const mockTickBurnDamageOnTarget = tickBurnDamageOnTarget as jest.MockedFunction<typeof tickBurnDamageOnTarget>;
```

实际查看文件顶部 mock 结构后调整（**注意：ts-jest TDZ pitfall**，所有 `jest.mock(...)` + `const mockXxx` 必须在 import 之前）。

在 `describe('tickBurnDamageOnTarget', ...)` 块中写 4 个 case：

```typescript
describe('tickBurnDamageOnTarget', () => {
  it('happy path: 1 burn effect → HP 减 1', async () => {
    // mock applyBurnDamage → { totalDamage: 1, burnCount: 1, burnEffectIds: ['b1'] }
    // mock hGet piece → { health: 10, is_alive: true, ... }
    // mock hSet 验证写入 { health: 9, is_alive: true, ... }
    // const result = await tickBurnDamageOnTarget('b1', 'c1', 1);
    // expect(result).toEqual({ totalDamage: 1, newHp: 9, isDead: false });
  });

  it('target 死亡: HP 减到 0 → is_alive=false', async () => {
    // mock applyBurnDamage → { totalDamage: 3, burnCount: 3 }
    // mock hGet piece → { health: 3, is_alive: true }
    // expect result.isDead === true
    // expect hSet 写入 { health: 0, is_alive: false }
  });

  it('no burn effects: totalDamage=0 → no HP change, isDead=false', async () => {
    // mock applyBurnDamage → { totalDamage: 0, burnCount: 0, burnEffectIds: [] }
    // 不调 hGet / hSet
    // expect result.newHp === piece.health (未读取)
    // 注：若 totalDamage=0 直接 return，不读写 piece
  });

  it('read piece 失败: 抛错（异常路径）', async () => {
    // mock applyBurnDamage → { totalDamage: 1 }
    // mock hGet throws
    // expect tickBurnDamageOnTarget throws
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/services/professionMechanicService.test.ts -t "tickBurnDamageOnTarget"
```

Expected: 4 tests FAIL（`tickBurnDamageOnTarget` is not a function）

- [ ] **Step 3: 实现 `tickBurnDamageOnTarget`**

在 `backend/src/services/professionMechanicService.ts` 文件末尾（`applyBurnDamage` 之后）追加：

```typescript
/**
 * T051 回合切换：给单个 target 结算 burn 伤害
 *
 * 流程：
 *   1. 调 applyBurnDamage 算 totalDamage
 *   2. 若 totalDamage === 0 → return { totalDamage: 0, newHp: <unchanged>, isDead: false }（no-op）
 *   3. 读 pieces HASH 拿 current piece（含 health）
 *   4. newHp = piece.health - totalDamage
 *   5. isDead = newHp <= 0
 *   6. 更新 piece: health = newHp, is_alive = !isDead
 *   7. 写回 HASH
 *   8. return { totalDamage, newHp, isDead }
 *
 * @param battleId battle id
 * @param targetId 目标 character id
 * @param currentRound 当前 battle round（用于 applyBurnDamage 过滤过期 effect）
 * @returns { totalDamage, newHp, isDead }
 *
 * 错误处理：Redis 抛错 → 向上抛（异常路径），由 orchestrator 兜底。
 */
export async function tickBurnDamageOnTarget(
  battleId: string,
  targetId: string,
  currentRound: number
): Promise<{ totalDamage: number; newHp: number; isDead: boolean }> {
  // 1. 算伤害
  const burnResult = await applyBurnDamage(battleId, targetId, currentRound);

  // 2. 无 burn effect → no-op
  if (burnResult.totalDamage === 0) {
    return { totalDamage: 0, newHp: -1, isDead: false };  // -1 sentinel 表示"未读取"
  }

  // 3. 读 piece
  const key = `battle:${battleId}:pieces`;
  const raw = await redisClient.hGet(key, targetId);
  if (!raw) {
    throw new Error(`tickBurnDamageOnTarget: piece not found for targetId=${targetId} in battle=${battleId}`);
  }
  const piece = JSON.parse(raw) as { health: number; is_alive: boolean; [key: string]: unknown };

  // 4-5. 算新 HP + 死亡判定
  const newHp = piece.health - burnResult.totalDamage;
  const isDead = newHp <= 0;

  // 6. 更新 piece
  piece.health = newHp;
  piece.is_alive = !isDead;

  // 7. 写回
  await redisClient.hSet(key, targetId, JSON.stringify(piece));

  return { totalDamage: burnResult.totalDamage, newHp, isDead };
}
```

注意：需在文件顶部追加 `import { redisClient } from '../config/redis';`（如尚未 import）。

- [ ] **Step 4: 运行测试验证通过**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/services/professionMechanicService.test.ts -t "tickBurnDamageOnTarget"
```

Expected: 4 tests PASS

- [ ] **Step 5: 提交**

```bash
git add backend/src/services/professionMechanicService.ts backend/src/services/professionMechanicService.test.ts
git commit -m "feat(professionMechanic): add tickBurnDamageOnTarget helper for T051"
```

---

## Task 2: executeEndStep + executeRoundEnd 骨架 + 类型

**Files:**
- Modify: `backend/src/services/battleActionService.ts` (在 `executePlayCard` 之后追加)
- Modify: `backend/src/services/battleActionService.test.ts` (在文件末尾追加 describe 块)

- [ ] **Step 1: 追加类型定义到 `battleActionService.ts`**

在 `backend/src/services/battleActionService.ts` 末尾追加（**先追加 import**）：

```typescript
import {
  getDbSessionState,
  completeMovePhase,
  completePlayPhase,
  endCurrentStep,
  activateCurrentUnit,
  completeDrawPhase,
  endCurrentRound,
} from './battleSessionService';
import type { BattleSessionState } from './battleSessionService';
import { retainHandOnStepEnd, drawCards } from './handService';
import { tickBurnDamageOnTarget } from './professionMechanicService';
import { broadcastSessionState } from './battleStateBroadcaster';
```

在 `executePlayCard` 函数体之后追加：

```typescript
/**
 * T051 回合切换 orchestrator
 *
 * 业务规则（按 T051 spec §1.2）：
 *   1. session 存在
 *   2. current_phase === 'play' OR 'move'
 *   3. retainHandOnStepEnd 保留 1 张手牌
 *   4. if (isLastStepInRound) → executeRoundEnd
 *   5. endCurrentStep
 *   6. activateCurrentUnit (snake draft)
 *   7. drawCards
 *   8. completeDrawPhase
 *   9. 末尾重读 session
 *  10. broadcastSessionState
 *  11. broadcastBoardState
 */

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

/**
 * T051: 完整 step-end orchestrator (11 步)
 *
 * @param io IOServer 实例（用于 broadcaster）
 * @param battleId battle id
 * @returns StepEndResult —— 失败时携带 error 字符串
 *
 * 错误处理：业务失败返回 `{ success: false, error: ... }`；
 * 依赖服务抛错 → 向上抛（异常路径），由 socketServer 层兜底。
 */
export async function executeEndStep(
  _io: IOServer,
  _battleId: string
): Promise<StepEndResult> {
  // TDD STUB: Task 2 仅放占位实现（让 import 不报错 + 测试可执行）。
  // Task 3 替换为 mid-round happy path, Task 4 追加 last-step 路由, Task 5 补 error branches。
  return { success: false, error: 'not_in_play_or_move_phase' };
}

/**
 * T051: Round-end sub-orchestrator (5 步)
 *
 * @param io IOServer 实例
 * @param battleId battle id
 * @param stateBefore executeEndStep 传入的 session（用于拿 currentRound）
 *
 * 错误处理：依赖抛错 → 向上抛；HP 变化不回滚（与 T050 一致）。
 */
export async function executeRoundEnd(
  _io: IOServer,
  _battleId: string,
  _stateBefore: BattleSessionState
): Promise<void> {
  // TDD STUB: Task 2 占位。Task 4 替换为完整 5 步实现。
}
```

- [ ] **Step 2: 追加 mock setup 到 `battleActionService.test.ts`**

在文件顶部 mock setup 区域追加（**注意 ts-jest TDZ pitfall**：所有 mock 块和 const mockXxx 在 import 之前）：

修改 `jest.mock('./battleSessionService', ...)` 块（已有）追加：
- `endCurrentStep: jest.fn()`
- `activateCurrentUnit: jest.fn()`
- `completeDrawPhase: jest.fn()`
- `endCurrentRound: jest.fn()`

修改 `jest.mock('./handService', ...)` 块追加：
- `retainHandOnStepEnd: jest.fn()`
- `drawCards: jest.fn()`

新增 `jest.mock('./professionMechanicService', ...)` 块：
```typescript
jest.mock('./professionMechanicService', () => ({
  tickBurnDamageOnTarget: jest.fn(),
}));
```

修改 `jest.mock('../socket/battleStateBroadcaster', ...)` 块追加：
- `broadcastSessionState: jest.fn()`

新增 `jest.mock('../config/redis', ...)` 块（如已存在则不重复）追加：
- `hGet: jest.fn()`

追加 import：
```typescript
import { tickBurnDamageOnTarget } from './professionMechanicService';
import { retainHandOnStepEnd, drawCards } from './handService';
import { endCurrentStep, activateCurrentUnit, completeDrawPhase, endCurrentRound } from './battleSessionService';
import { broadcastSessionState } from './battleStateBroadcaster';
import { listCharactersInBattle } from './battleService';
```

追加 mock 引用：
```typescript
const mockTickBurnDamageOnTarget = tickBurnDamageOnTarget as jest.MockedFunction<typeof tickBurnDamageOnTarget>;
const mockRetainHandOnStepEnd = retainHandOnStepEnd as jest.MockedFunction<typeof retainHandOnStepEnd>;
const mockDrawCards = drawCards as jest.MockedFunction<typeof drawCards>;
const mockEndCurrentStep = endCurrentStep as jest.MockedFunction<typeof endCurrentStep>;
const mockActivateCurrentUnit = activateCurrentUnit as jest.MockedFunction<typeof activateCurrentUnit>;
const mockCompleteDrawPhase = completeDrawPhase as jest.MockedFunction<typeof completeDrawPhase>;
const mockEndCurrentRound = endCurrentRound as jest.MockedFunction<typeof endCurrentRound>;
const mockBroadcastSessionState = broadcastSessionState as jest.MockedFunction<typeof broadcastSessionState>;
```

在 `beforeEach` 末尾追加 T051 默认 happy path 桩（**注意：不要清空前面 T049/T050 的 default**）：

```typescript
// T051 默认 happy path 桩
mockTickBurnDamageOnTarget.mockResolvedValue({ totalDamage: 0, newHp: -1, isDead: false });
mockRetainHandOnStepEnd.mockResolvedValue(undefined);
mockDrawCards.mockResolvedValue(undefined);
mockEndCurrentStep.mockResolvedValue(undefined);
mockActivateCurrentUnit.mockResolvedValue(undefined);
mockCompleteDrawPhase.mockResolvedValue(undefined);
mockEndCurrentRound.mockResolvedValue(undefined);
mockBroadcastSessionState.mockResolvedValue(undefined);
mockListCharactersInBattle.mockResolvedValue([
  { characterId: 'c1', playerId: 'p1', userId: 'u1', profession: 'warrior', name: 'p1-c1' },
  { characterId: 'c2', playerId: 'p1', userId: 'u1', profession: 'ranger', name: 'p1-c2' },
  { characterId: 'c3', playerId: 'p1', userId: 'u1', profession: 'mage', name: 'p1-c3' },
  { characterId: 'c4', playerId: 'p2', userId: 'u2', profession: 'warrior', name: 'p2-c4' },
  { characterId: 'c5', playerId: 'p2', userId: 'u2', profession: 'ranger', name: 'p2-c5' },
  { characterId: 'c6', playerId: 'p2', userId: 'u2', profession: 'mage', name: 'p2-c6' },
]);
```

- [ ] **Step 3: 追加 placeholder describe 块**

在文件末尾的 describe 块（已有 `describe('executePlayCard', ...)`）之后追加：

```typescript
describe('executeEndStep', () => {
  it('placeholder — to be expanded in Task 3-5', async () => {
    const { executeEndStep } = await import('./battleActionService');
    const io = createMockIO();
    // 默认 getDbSessionState 返回 phase='play', currentStep=2, currentRound=1, currentActorId='c1'
    mockGetDbSessionState.mockResolvedValue({
      battleId: 'b1',
      currentRound: 1,
      currentStep: 2,
      currentPhase: 'play',
      currentActorId: 'c1',
    } as any);
    const result = await executeEndStep(io, 'b1');
    expect(result).toHaveProperty('success');
  });
});
```

注意：placeholder 期望 `not_in_play_or_move_phase` error（Task 2 默认实现）；后续 Task 3-5 覆盖 happy path。

- [ ] **Step 4: 运行测试验证骨架可执行**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/services/battleActionService.test.ts
```

Expected: T049 + T050 + T051 placeholder 全 PASS

- [ ] **Step 5: 类型检查**

```bash
cd /home/lovept/PtIDLE/backend
npx tsc --noEmit
```

Expected: 0 errors

- [ ] **Step 6: 提交**

```bash
git add backend/src/services/battleActionService.ts backend/src/services/battleActionService.test.ts
git commit -m "feat(battleAction): T051 executeEndStep + executeRoundEnd skeleton + types"
```

---

## Task 3: executeEndStep mid-round happy path（TDD）

**Files:**
- Modify: `backend/src/services/battleActionService.ts` (替换 `executeEndStep` 函数体)
- Modify: `backend/src/services/battleActionService.test.ts` (追加 happy path tests)

- [ ] **Step 1: 追加 happy path 测试**

在 `describe('executeEndStep', ...)` 块中替换 placeholder，追加 3 个 happy path cases：

```typescript
describe('executeEndStep', () => {
  // mock 辅助函数
  const setupMidRoundState = () => {
    mockGetDbSessionState
      .mockResolvedValueOnce({  // 第 1 次: 步骤 1 读 session
        battleId: 'b1', currentRound: 1, currentStep: 2, currentPhase: 'play', currentActorId: 'c1',
      } as any)
      .mockResolvedValueOnce({  // 第 2 次: 步骤 9 末尾重读
        battleId: 'b1', currentRound: 1, currentStep: 3, currentPhase: 'draw', currentActorId: 'c4',
      } as any);
  };

  it('mid-round happy path (step 0-4/6) → 不调 executeRoundEnd, endStep → activate → draw → completeDrawPhase → 2 broadcast', async () => {
    setupMidRoundState();
    const { executeEndStep } = await import('./battleActionService');
    const io = createMockIO();
    const result = await executeEndStep(io, 'b1');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.state.currentStep).toBe(3);
    }
    expect(mockRetainHandOnStepEnd).toHaveBeenCalledTimes(1);
    expect(mockEndCurrentStep).toHaveBeenCalledTimes(1);
    expect(mockActivateCurrentUnit).toHaveBeenCalledTimes(1);
    expect(mockDrawCards).toHaveBeenCalledTimes(1);
    expect(mockCompleteDrawPhase).toHaveBeenCalledTimes(1);
    expect(mockEndCurrentRound).not.toHaveBeenCalled();
    expect(mockTickBurnDamageOnTarget).not.toHaveBeenCalled();
  });

  it('retain 失败 → error: retain_failed, endStep 未调', async () => {
    setupMidRoundState();
    mockRetainHandOnStepEnd.mockRejectedValueOnce(new Error('retain fail'));
    const { executeEndStep } = await import('./battleActionService');
    const result = await executeEndStep(createMockIO(), 'b1');
    expect(result).toEqual({ success: false, error: 'retain_failed', detail: 'retain fail' });
    expect(mockEndCurrentStep).not.toHaveBeenCalled();
  });

  it('end_step 失败 → error: end_step_failed, activate 未调', async () => {
    setupMidRoundState();
    mockEndCurrentStep.mockRejectedValueOnce(new Error('end step fail'));
    const { executeEndStep } = await import('./battleActionService');
    const result = await executeEndStep(createMockIO(), 'b1');
    expect(result).toEqual({ success: false, error: 'end_step_failed', detail: 'end step fail' });
    expect(mockActivateCurrentUnit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试验证 mid-round happy path 失败**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/services/battleActionService.test.ts -t "executeEndStep" -t "mid-round"
```

Expected: 1 test FAIL（mid-round happy path 期望 success 但当前 stub 返回 error）

- [ ] **Step 3: 实现 executeEndStep 主体（mid-round 部分）**

替换 `executeEndStep` 函数体：

```typescript
export async function executeEndStep(
  io: IOServer,
  battleId: string
): Promise<StepEndResult> {
  // 1. 读 session
  const state = await getDbSessionState(battleId);
  if (!state) {
    throw new Error(`executeEndStep: session not found: ${battleId}`);
  }

  // 2. phase check
  if (state.currentPhase !== 'play' && state.currentPhase !== 'move') {
    return { success: false, error: 'not_in_play_or_move_phase' };
  }

  // 3. retain 手牌
  try {
    await retainHandOnStepEnd(battleId, state.currentActorId!);
  } catch (err) {
    return { success: false, error: 'retain_failed', detail: (err as Error).message };
  }

  // 4. (last step?) executeRoundEnd
  // TDD STUB: Task 3 暂跳过 last-step 路由。Task 4 追加 `if (state.currentStep === 5) { await executeRoundEnd(...) }`

  // 5. endCurrentStep
  try {
    await endCurrentStep(battleId);
  } catch (err) {
    return { success: false, error: 'end_step_failed', detail: (err as Error).message };
  }

  // 6. activateCurrentUnit
  try {
    await activateCurrentUnit(battleId);
  } catch (err) {
    return { success: false, error: 'activate_failed', detail: (err as Error).message };
  }

  // 7. drawCards
  const updatedState = await getDbSessionState(battleId);
  if (!updatedState || !updatedState.currentActorId) {
    return { success: false, error: 'draw_failed' };
  }
  try {
    await drawCards(battleId, updatedState.currentActorId);
  } catch (err) {
    return { success: false, error: 'draw_failed', detail: (err as Error).message };
  }

  // 8. completeDrawPhase
  try {
    await completeDrawPhase(battleId);
  } catch (err) {
    return { success: false, error: 'complete_phase_failed', detail: (err as Error).message };
  }

  // 9. 末尾重读 session
  const finalState = await getDbSessionState(battleId);
  if (!finalState) {
    throw new Error(`executeEndStep: final state read failed: ${battleId}`);
  }

  // 10-11. 广播
  await broadcastSessionState(io, battleId, finalState);
  await broadcastBoardState(io, battleId);

  return { success: true, state: finalState };
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/services/battleActionService.test.ts -t "executeEndStep"
```

Expected: 3 executeEndStep tests PASS（mid-round happy + retain failed + end_step failed）

- [ ] **Step 5: 提交**

```bash
git add backend/src/services/battleActionService.ts backend/src/services/battleActionService.test.ts
git commit -m "feat(battleAction): T051 executeEndStep mid-round happy path + 2 error branches"
```

---

## Task 4: executeEndStep last-step + executeRoundEnd（TDD）

**Files:**
- Modify: `backend/src/services/battleActionService.ts` (替换 `executeEndStep` 步骤 4 + 完整 `executeRoundEnd`)

- [ ] **Step 1: 追加 last-step 测试**

在 `describe('executeEndStep', ...)` 末尾追加 3 个 last-step cases：

```typescript
it('last-step happy path (step 5/6) → executeRoundEnd 触发, endCurrentRound 1 次', async () => {
  mockGetDbSessionState
    .mockResolvedValueOnce({  // 步骤 1 读
      battleId: 'b1', currentRound: 1, currentStep: 5, currentPhase: 'play', currentActorId: 'c6',
    } as any)
    .mockResolvedValueOnce({  // 步骤 7 draw 前重读
      battleId: 'b1', currentRound: 1, currentStep: 5, currentPhase: 'play', currentActorId: 'c6',
    } as any)
    .mockResolvedValueOnce({  // 步骤 9 末尾重读
      battleId: 'b1', currentRound: 2, currentStep: 0, currentPhase: 'draw', currentActorId: 'c1',
    } as any);
  const { executeEndStep } = await import('./battleActionService');
  const result = await executeEndStep(createMockIO(), 'b1');
  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.state.currentRound).toBe(2);
    expect(result.state.currentStep).toBe(0);
  }
  expect(mockEndCurrentRound).toHaveBeenCalledTimes(1);
  // round-end 推送 2 次（executeRoundEnd 内 + executeEndStep 内）
  expect(mockBroadcastSessionState).toHaveBeenCalledTimes(2);
});

it('executeRoundEnd 失败 → error: round_end_failed, end_step 未调', async () => {
  mockGetDbSessionState.mockResolvedValueOnce({
    battleId: 'b1', currentRound: 1, currentStep: 5, currentPhase: 'play', currentActorId: 'c6',
  } as any);
  mockEndCurrentRound.mockRejectedValueOnce(new Error('round end fail'));
  const { executeEndStep } = await import('./battleActionService');
  const result = await executeEndStep(createMockIO(), 'b1');
  expect(result).toEqual({ success: false, error: 'round_end_failed', detail: 'round end fail' });
  expect(mockEndCurrentStep).not.toHaveBeenCalled();
});

it('executeRoundEnd 调 tickBurnDamageOnTarget 6 次（每个 char）', async () => {
  mockGetDbSessionState
    .mockResolvedValueOnce({
      battleId: 'b1', currentRound: 1, currentStep: 5, currentPhase: 'play', currentActorId: 'c6',
    } as any)
    .mockResolvedValueOnce({
      battleId: 'b1', currentRound: 1, currentStep: 5, currentPhase: 'play', currentActorId: 'c6',
    } as any)
    .mockResolvedValueOnce({
      battleId: 'b1', currentRound: 2, currentStep: 0, currentPhase: 'draw', currentActorId: 'c1',
    } as any);
  const { executeEndStep } = await import('./battleActionService');
  await executeEndStep(createMockIO(), 'b1');
  expect(mockTickBurnDamageOnTarget).toHaveBeenCalledTimes(6);
  // 验证每个 charId 都传入
  const calledWith = mockTickBurnDamageOnTarget.mock.calls.map(c => c[1]);
  expect(calledWith).toEqual(expect.arrayContaining(['c1', 'c2', 'c3', 'c4', 'c5', 'c6']));
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/services/battleActionService.test.ts -t "executeEndStep" -t "last-step"
```

Expected: 3 tests FAIL（last-step 不会触发 executeRoundEnd，当前 stub 直接 end_step）

- [ ] **Step 3: 实现 executeRoundEnd 完整主体**

替换 `executeRoundEnd` 函数体：

```typescript
export async function executeRoundEnd(
  io: IOServer,
  battleId: string,
  stateBefore: BattleSessionState
): Promise<void> {
  // 1. 给所有 6 角色结算 burn 伤害（listCharactersInBattle 已 mock）
  const characters = await listCharactersInBattle(battleId);
  // 并行结算（独立查询）
  await Promise.all(
    characters.map((c) =>
      tickBurnDamageOnTarget(battleId, c.characterId, stateBefore.currentRound)
    )
  );

  // 2. tick 所有 effect（每个角色一次）
  // 注：tickEffects 是 per-character helper，需要逐个调
  for (const c of characters) {
    await tickEffects(battleId, c.characterId, stateBefore.currentRound);
  }

  // 3. endCurrentRound
  await endCurrentRound(battleId);

  // 4-5. 广播
  const newState = await getDbSessionState(battleId);
  if (!newState) {
    throw new Error(`executeRoundEnd: state read failed: ${battleId}`);
  }
  await broadcastSessionState(io, battleId, newState);
  await broadcastBoardState(io, battleId);
}
```

注意：需追加 `import { tickEffects } from './statusEffectService';`

- [ ] **Step 4: 在 executeEndStep 步骤 4 加入 last-step 路由**

替换 `executeEndStep` 步骤 4 注释：

```typescript
  // 4. (last step?) executeRoundEnd
  // 蛇形激活 3v3 有 6 步 (currentStep 0-5), last = currentStep === 5
  if (state.currentStep === 5) {
    try {
      await executeRoundEnd(io, battleId, state);
    } catch (err) {
      return { success: false, error: 'round_end_failed', detail: (err as Error).message };
    }
  }
```

- [ ] **Step 5: 顶部 mock 补 tickEffects**

修改既有 `jest.mock('./statusEffectService', ...)` 块追加 `tickEffects: jest.fn()`（如不存在则新增）。追加 import 和 mock 引用：

```typescript
import { tickEffects } from './statusEffectService';
const mockTickEffects = tickEffects as jest.MockedFunction<typeof tickEffects>;
```

在 `beforeEach` 末尾追加：
```typescript
mockTickEffects.mockResolvedValue([]);
```

- [ ] **Step 6: 运行测试验证通过**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/services/battleActionService.test.ts -t "executeEndStep"
```

Expected: 6 executeEndStep tests PASS（3 mid-round + 3 last-step）

- [ ] **Step 7: 提交**

```bash
git add backend/src/services/battleActionService.ts backend/src/services/battleActionService.test.ts
git commit -m "feat(battleAction): T051 executeRoundEnd + last-step routing in executeEndStep"
```

---

## Task 5: executeEndStep 剩余错误分支（TDD）

**Files:**
- Modify: `backend/src/services/battleActionService.test.ts` (追加 4 个 case)

- [ ] **Step 1: 追加剩余错误分支测试**

```typescript
describe('executeEndStep error branches', () => {
  const setupState = () => mockGetDbSessionState
    .mockResolvedValueOnce({
      battleId: 'b1', currentRound: 1, currentStep: 2, currentPhase: 'play', currentActorId: 'c1',
    } as any);

  it('currentPhase=idle → error: not_in_play_or_move_phase, retain 未调', async () => {
    setupState();
    mockGetDbSessionState.mockReset();
    mockGetDbSessionState.mockResolvedValueOnce({
      battleId: 'b1', currentRound: 1, currentStep: 0, currentPhase: 'idle', currentActorId: null,
    } as any);
    const { executeEndStep } = await import('./battleActionService');
    const result = await executeEndStep(createMockIO(), 'b1');
    expect(result).toEqual({ success: false, error: 'not_in_play_or_move_phase' });
    expect(mockRetainHandOnStepEnd).not.toHaveBeenCalled();
  });

  it('activate 失败 → error: activate_failed', async () => {
    setupState();
    mockActivateCurrentUnit.mockRejectedValueOnce(new Error('activate fail'));
    const { executeEndStep } = await import('./battleActionService');
    const result = await executeEndStep(createMockIO(), 'b1');
    expect(result).toEqual({ success: false, error: 'activate_failed', detail: 'activate fail' });
  });

  it('drawCards 失败 → error: draw_failed', async () => {
    setupState();
    mockGetDbSessionState
      .mockReset()
      .mockResolvedValueOnce({  // 步骤 1
        battleId: 'b1', currentRound: 1, currentStep: 2, currentPhase: 'play', currentActorId: 'c1',
      } as any)
      .mockResolvedValueOnce({  // 步骤 7 重读
        battleId: 'b1', currentRound: 1, currentStep: 3, currentPhase: 'draw', currentActorId: 'c4',
      } as any);
    mockDrawCards.mockRejectedValueOnce(new Error('draw fail'));
    const { executeEndStep } = await import('./battleActionService');
    const result = await executeEndStep(createMockIO(), 'b1');
    expect(result).toEqual({ success: false, error: 'draw_failed', detail: 'draw fail' });
  });

  it('completeDrawPhase 失败 → error: complete_phase_failed', async () => {
    setupState();
    mockGetDbSessionState
      .mockReset()
      .mockResolvedValueOnce({
        battleId: 'b1', currentRound: 1, currentStep: 2, currentPhase: 'play', currentActorId: 'c1',
      } as any)
      .mockResolvedValueOnce({
        battleId: 'b1', currentRound: 1, currentStep: 3, currentPhase: 'draw', currentActorId: 'c4',
      } as any);
    mockCompleteDrawPhase.mockRejectedValueOnce(new Error('phase fail'));
    const { executeEndStep } = await import('./battleActionService');
    const result = await executeEndStep(createMockIO(), 'b1');
    expect(result).toEqual({ success: false, error: 'complete_phase_failed', detail: 'phase fail' });
  });
});
```

- [ ] **Step 2: 运行测试验证全部通过**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/services/battleActionService.test.ts -t "executeEndStep"
```

Expected: 10 executeEndStep tests PASS（3 mid-round + 3 last-step + 4 error branches）

- [ ] **Step 3: 提交**

```bash
git add backend/src/services/battleActionService.test.ts
git commit -m "test(battleAction): T051 executeEndStep 4 剩余错误分支"
```

---

## Task 6: broadcastSessionState + broadcaster test

**Files:**
- Modify: `backend/src/socket/battleStateBroadcaster.ts` (追加 `broadcastSessionState` 导出)
- Modify: `backend/src/socket/battleStateBroadcaster.test.ts` (追加 1 个 test)

- [ ] **Step 1: 写测试 — broadcastSessionState 推 4 字段**

在 `backend/src/socket/battleStateBroadcaster.test.ts` 文件末尾追加：

```typescript
import { broadcastSessionState } from './battleStateBroadcaster';

describe('broadcastSessionState', () => {
  it('emit battle:state:session 到 battle room, payload 含 4 字段', async () => {
    const mockEmit = jest.fn();
    const mockTo = jest.fn().mockReturnValue({ emit: mockEmit });
    const io = { to: mockTo } as any;
    const state = {
      battleId: 'b1',
      currentRound: 2,
      currentStep: 0,
      currentActorId: 'c1',
      currentPhase: 'draw',
    } as any;
    await broadcastSessionState(io, 'b1', state);
    expect(mockTo).toHaveBeenCalledWith('battle:b1');
    expect(mockEmit).toHaveBeenCalledWith('battle:state:session', {
      battleId: 'b1',
      currentRound: 2,
      currentStep: 0,
      currentActorId: 'c1',
      currentPhase: 'draw',
    });
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/socket/battleStateBroadcaster.test.ts -t "broadcastSessionState"
```

Expected: 1 test FAIL（broadcastSessionState is not a function）

- [ ] **Step 3: 实现 broadcastSessionState**

在 `backend/src/socket/battleStateBroadcaster.ts` 末尾追加（**注意**：`battleRoom` 是相对路径；需 import）：

```typescript
/**
 * T051: 广播 session 状态变化（currentRound/currentStep/currentActorId/currentPhase）
 * 走 battle room（双方共有）
 *
 * 用途：executeEndStep / executeRoundEnd 末尾推送 session 元数据。
 * 区别于 broadcastBoardState：后者含完整 character 状态，前者只推 4 字段。
 */
export async function broadcastSessionState(
  io: IOServer,
  battleId: string,
  state: {
    currentRound: number;
    currentStep: number;
    currentActorId: string | null;
    currentPhase: string;
  }
): Promise<void> {
  io.to(`battle:${battleId}`).emit('battle:state:session', {
    battleId,
    currentRound: state.currentRound,
    currentStep: state.currentStep,
    currentActorId: state.currentActorId,
    currentPhase: state.currentPhase,
  });
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/socket/battleStateBroadcaster.test.ts -t "broadcastSessionState"
```

Expected: 1 test PASS

- [ ] **Step 5: 提交**

```bash
git add backend/src/socket/battleStateBroadcaster.ts backend/src/socket/battleStateBroadcaster.test.ts
git commit -m "feat(broadcaster): T051 broadcastSessionState 新增"
```

---

## Task 7: handleBattleSkipPlay handler（TDD）

**Files:**
- Modify: `backend/src/socket/battleRoom.ts` (追加 `handleBattleSkipPlay` 导出)
- Modify: `backend/src/socket/battleRoom.test.ts` (追加 6 个 describe cases)

- [ ] **Step 1: 写测试 — 6 个 cases**

在 `backend/src/socket/battleRoom.test.ts` 末尾追加：

```typescript
import { handleBattleSkipPlay } from './battleRoom';

describe('handleBattleSkipPlay', () => {
  let mockSocket: any;
  let mockIo: any;
  let mockEmit: jest.Mock;

  beforeEach(() => {
    mockEmit = jest.fn();
    mockSocket = { data: { userId: 'u1' }, emit: mockEmit };
    mockIo = {} as any;
  });

  it('valid payload → executeEndStep 被调', async () => {
    const { executeEndStep } = require('../services/battleActionService');
    (executeEndStep as jest.Mock).mockResolvedValue({ success: true, state: {} as any });
    await handleBattleSkipPlay(mockIo, mockSocket, { battleId: 'b1' });
    expect(executeEndStep).toHaveBeenCalledWith(mockIo, 'b1');
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it('invalid payload (缺 battleId) → emit battle:skip_play:error invalid_payload', async () => {
    await handleBattleSkipPlay(mockIo, mockSocket, {});
    expect(mockEmit).toHaveBeenCalledWith('battle:skip_play:error', { error: 'invalid_payload' });
  });

  it('invalid payload (battleId 非 string) → emit invalid_payload', async () => {
    await handleBattleSkipPlay(mockIo, mockSocket, { battleId: 123 });
    expect(mockEmit).toHaveBeenCalledWith('battle:skip_play:error', { error: 'invalid_payload' });
  });

  it('executeEndStep 失败 → emit error + detail', async () => {
    const { executeEndStep } = require('../services/battleActionService');
    (executeEndStep as jest.Mock).mockResolvedValue({
      success: false, error: 'not_in_play_or_move_phase', detail: 'phase=idle',
    });
    await handleBattleSkipPlay(mockIo, mockSocket, { battleId: 'b1' });
    expect(mockEmit).toHaveBeenCalledWith('battle:skip_play:error', {
      error: 'not_in_play_or_move_phase', detail: 'phase=idle',
    });
  });

  it('executeEndStep 抛错 → 不 emit（socketServer 兜底）', async () => {
    const { executeEndStep } = require('../services/battleActionService');
    (executeEndStep as jest.Mock).mockRejectedValue(new Error('boom'));
    await expect(handleBattleSkipPlay(mockIo, mockSocket, { battleId: 'b1' }))
      .rejects.toThrow('boom');
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it('executeEndStep 成功 → 不 emit（依赖 broadcast 两连）', async () => {
    const { executeEndStep } = require('../services/battleActionService');
    (executeEndStep as jest.Mock).mockResolvedValue({ success: true, state: {} as any });
    await handleBattleSkipPlay(mockIo, mockSocket, { battleId: 'b1' });
    expect(mockEmit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/socket/battleRoom.test.ts -t "handleBattleSkipPlay"
```

Expected: 6 tests FAIL

- [ ] **Step 3: 实现 handleBattleSkipPlay**

在 `backend/src/socket/battleRoom.ts` 末尾追加：

```typescript
import { executeEndStep } from '../services/battleActionService';

// ... 既有 import + handler 之后追加:

/**
 * T051 Task 7: 处理客户端的 `battle:skip_play` 事件
 *
 * 流程:
 *   1. 验证 payload 结构（battleId 是 string）
 *   2. 失败 → emit `battle:skip_play:error` `{ error: 'invalid_payload' }`
 *   3. 调 `executeEndStep(io, battleId)`
 *   4. executeEndStep 失败 → emit `battle:skip_play:error` 带 error + detail
 *   5. 成功 → 不 emit（依赖 broadcastSessionState + broadcastBoardState 推送）
 *   6. executeEndStep 抛错 → 向上抛（异常路径，由 socketServer 层兜底）
 *
 * 注意：handler 不做 actor 归属检查（依赖 phase machine 锁）。
 */
export async function handleBattleSkipPlay(
  io: IOServer,
  socket: Socket,
  payload: { battleId?: unknown }
): Promise<void> {
  // 1. payload 验证
  const battleId = typeof payload?.battleId === 'string' ? payload.battleId : null;
  if (!battleId) {
    socket.emit('battle:skip_play:error', { error: 'invalid_payload' });
    return;
  }

  // 2. 调 service
  const result = await executeEndStep(io, battleId);

  // 3. 失败回执
  if (!result.success) {
    socket.emit('battle:skip_play:error', {
      error: result.error,
      detail: result.detail,
    });
  }
  // 成功: 不 emit（依赖 broadcaster 推送 session + board）
}
```

注意：实际写代码时把 `import { executeEndStep }` 加到文件顶部既有 import 区域，与 executeMove/executePlayCard 并列。

- [ ] **Step 4: 运行测试验证通过**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/socket/battleRoom.test.ts -t "handleBattleSkipPlay"
```

Expected: 6 tests PASS

- [ ] **Step 5: 提交**

```bash
git add backend/src/socket/battleRoom.ts backend/src/socket/battleRoom.test.ts
git commit -m "feat(battleRoom): T051 handleBattleSkipPlay handler"
```

---

## Task 8: socketServer 注册 + 集成测试 mock 补全

**Files:**
- Modify: `backend/src/socket/socketServer.ts` (注册 `battle:skip_play` 事件)
- Modify: `backend/src/socket/socketServer.test.ts` (顶部 mock 补 `executeEndStep`)

- [ ] **Step 1: 修改 socketServer.ts**

在 `backend/src/socket/socketServer.ts` 顶部 import 区域追加：

```typescript
import { handleBattleSkipPlay } from './battleRoom';
```

在 `handleBattlePlayCard` 注册附近追加 `handleBattleSkipPlay` 注册：

```typescript
socket.on('battle:skip_play', (payload) => {
  const userId = socket.data.userId as string;
  handleBattleSkipPlay(io, socket, payload).catch((err) => {
    console.error(`[WS] battle:skip_play error: userId=${userId}`, err);
    socket.emit('battle:skip_play:error', { error: 'internal_error' });
  });
});
```

- [ ] **Step 2: 修改 socketServer.test.ts**

在文件顶部 `jest.mock('../services/battleActionService', ...)` 块追加 `executeEndStep: jest.fn()`。

在 `beforeEach` 或既有集成测试 setup 追加默认 mock：

```typescript
(executeEndStep as jest.Mock).mockResolvedValue({ success: true, state: {} as any });
```

如既有 setup 已有 `(executeMove as jest.Mock)` 和 `(executePlayCard as jest.Mock)`，则在它们之后追加 `executeEndStep` 默认 mock。

- [ ] **Step 3: 验证既有集成测试仍通过**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/socket/socketServer.test.ts src/socket/battleRoom.integration.test.ts
```

Expected: 既有测试 PASS（mock 默认值已提供）

- [ ] **Step 4: 提交**

```bash
git add backend/src/socket/socketServer.ts backend/src/socket/socketServer.test.ts
git commit -m "feat(socket): T051 battle:skip_play event registered"
```

---

## Task 9: T050 executePlayCard 末尾 wire executeEndStep

**Files:**
- Modify: `backend/src/services/battleActionService.ts` (executePlayCard 末尾追加一行)

- [ ] **Step 1: 修改 executePlayCard 末尾**

在 `executePlayCard` 函数的最后 return 之前追加：

```typescript
  // 12. T051 wire-up: completePlayPhase 后自动级联 executeEndStep
  // 注：T050 spec §4.5 已规划但当时 T051 未实现。T051 Task 9 wire up。
  // 失败由 socketServer 兜底（log + 不 emit，因为 T050 本无成功 emit）
  await executeEndStep(io, battleId);
```

注意：保持 11-12-13 顺序——completePlayPhase (11) → executeEndStep (12) → broadcastBoardState (13)。

将 `broadcastBoardState(io, battleId);` 移到 `executeEndStep` 之后，因为 executeEndStep 内部已经推 board 了，再调一次会重复推送：

```typescript
  // 11. 阶段推进
  await completePlayPhase(battleId);

  // 12. T051 wire-up: 自动级联 executeEndStep
  await executeEndStep(io, battleId);

  // 13. executeEndStep 已推 board, 无需重复 broadcastBoardState

  return { success: true, validation };
```

- [ ] **Step 2: 验证 T050 executePlayCard 测试仍通过**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/services/battleActionService.test.ts -t "executePlayCard"
```

Expected: 既有 T050 executePlayCard tests 仍 PASS

注意：T050 测试 default mock 中 `getDbSessionState` 返回的 state 可能与新 wire-up 不兼容。如失败，**修改 T050 default mock** 让 `getDbSessionState` 第二次 mock 返回 `currentPhase: 'end_step'`（这样 executeEndStep 步骤 2 不会走 happy path 而是 return not_in_play_or_move_phase，但 executePlayCard 不会因为这个 return 而失败——只记 log）。

如需修改 default mock，在 `beforeEach` 中调整 T050 区块：
```typescript
// T050 default getDbSessionState 改: 步骤 1 + 步骤 9 末尾重读
mockGetDbSessionState.mockResolvedValue({
  battleId: 'b1', currentRound: 1, currentStep: 0, currentPhase: 'play', currentActorId: 'c1',
} as any);
```

**关键**：executePlayCard 步骤 1 读 state 时 `currentPhase: 'play'` 触发 happy path；executeEndStep 步骤 1 读 state 时同样 `currentPhase: 'play'`，但 T050 default mock 不再 mock executeEndStep 内部需要的步骤——所以 executeEndStep 内部调用 retainHandOnStepEnd 等会失败。需在 T050 default mock 块追加：

```typescript
mockRetainHandOnStepEnd.mockResolvedValue(undefined);
mockEndCurrentStep.mockResolvedValue(undefined);
mockActivateCurrentUnit.mockResolvedValue(undefined);
mockDrawCards.mockResolvedValue(undefined);
mockCompleteDrawPhase.mockResolvedValue(undefined);
mockEndCurrentRound.mockResolvedValue(undefined);
mockTickEffects.mockResolvedValue([]);
mockTickBurnDamageOnTarget.mockResolvedValue({ totalDamage: 0, newHp: -1, isDead: false });
```

如遇 mock 链问题，**在每个 T050 happy path test 的 mockResolvedValueOnce 链末尾**追加 `currentPhase: 'end_step'` 的 mock（或保留为 `'play'` 触发 executeEndStep 走 happy path，但需要上面所有 mock 返回正常值）。

- [ ] **Step 3: 提交**

```bash
git add backend/src/services/battleActionService.ts backend/src/services/battleActionService.test.ts
git commit -m "feat(battleAction): T051 wire executeEndStep at end of T050 executePlayCard"
```

---

## Task 10: 全量验证 + 文档更新

**Files:**
- Modify: `memory-bank/progress.md` (追加 T051 完成行)
- Modify: `memory-bank/architecture.md` (追加 T051 章节)
- Modify: `memory-bank/history.md` (追加 T051 日志)
- Push: 等待用户验证测试后再 push (CLAUDE.md Rule 4)

- [ ] **Step 1: 跑全套单测**

```bash
cd /home/lovept/PtIDLE/backend
npx jest
```

Expected: 562 + 15 + 6 + 1 + 6 + 4 = ~594 个 tests PASS, 5 个 pre-existing authController 失败（已知）

- [ ] **Step 2: 类型检查**

```bash
cd /home/lovept/PtIDLE/backend
npx tsc --noEmit
```

Expected: 0 errors

- [ ] **Step 3: 更新 progress.md**

在 `memory-bank/progress.md` 的「已完成」表格末尾追加：

```markdown
| T051 | 实现回合切换 orchestrator（executeEndStep 11 步 + executeRoundEnd 5 步 + tickBurnDamageOnTarget + battle:skip_play 事件） | 2026-06-17 |
```

- [ ] **Step 4: 更新 architecture.md**

在 `memory-bank/architecture.md` 中查找 T050 章节位置（line 1831+），在 T050 章节之后追加 T051 章节（约 100-150 行，参考 T050 章节结构）：

- 第 1 节：触发流程图
- 第 2 节：模块设计（battleActionService / professionMechanicService / battleStateBroadcaster / battleRoom / socketServer）
- 第 3 节：关键设计决策
- 第 4 节：T056 集成要点（说明 executeEndStep 是 T056 applyDamage 之外的新 HP 操作点）

- [ ] **Step 5: 更新 history.md**

在 `memory-bank/history.md` 末尾追加（按既有格式）：

```markdown
## 2026-06-17 - 任务：T051 回合切换 orchestrator

### Prompt
按 CLAUDE.md 3 步循环: 阅读 memory-bank → 消除歧义(4 个问题) → Ask/Plan 模式确认 T051 方案 → 写 spec → 写 plan → 实施。

### 思考
- 选项 B (两个独立 orchestrator) 镜像 T049/T050 模式, 单一职责
- 用户 4 个问题答案: 服务端级联 / 允许 skip-play / 每 round 末结算 / 每 round 末 tick
- 关键发现: applyBurnDamage 只算伤害不算 HP, 需新增 tickBurnDamageOnTarget helper
- broadcastSessionState 独立事件 (频率高, 不应塞进 board)

### 意外
- applyBurnDamage 不扣 HP, 需新增 tickBurnDamageOnTarget 局部 apply (15 行 helper)
- last step 时 broadcast 触发 2 次 (round-end + step-end), by design
- T050 executePlayCard wire-up 时 T050 default mock 需补 executeEndStep 链

### 范围外
- T049 executeMove 末尾级联 (T051.5 决定)
- step 超时 AFK (future)
- T056 applyDamage (attack/AOE 实际伤害)
```

- [ ] **Step 6: 提交**

```bash
git add memory-bank/progress.md memory-bank/architecture.md memory-bank/history.md
git commit -m "docs: T051 architecture + progress + history update"
```

- [ ] **Step 7: 等待用户测试 + 审阅后再 push (CLAUDE.md Rule 4)**

告知用户："T051 实施完成, 10 个 commit, 32 个新测试 pass. 请在本地跑 `npx jest` 验证后再决定 push."

---

*计划版本：v1.0*
*最后更新：2026-06-17*
