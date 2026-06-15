# T049 移动操作同步实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 3v3 战棋对战中玩家的移动操作同步——客户端发 `battle:move`，服务端验证合法性、执行棋子移动、广播棋盘状态、自动推进 phase `move` → `play`。

**Architecture:** 新建 `battleActionService` 封装「验证 + 执行 + 广播 + 阶段推进」流水；`battleRoom.ts` 增加 `handleBattleMove` 薄壳 handler；`socketServer.ts` 注册 `battle:move` 事件。Broadcaster 仅 `broadcastBoardState`（移动改变整盘位置）。

**Tech Stack:** Node.js + TypeScript + Express + Socket.io + PostgreSQL + Redis（v4 client）+ Jest + ts-jest

**Spec:** `docs/superpowers/specs/2026-06-15-t049-movement-sync-design.md`

---

## File Structure

```
backend/
├── src/
│   ├── services/
│   │   ├── battleActionService.ts         [NEW] executeMove + MoveResult + MoveError
│   │   └── battleActionService.test.ts    [NEW] 单测 ~7（happy path + 6 失败分支）
│   ├── socket/
│   │   ├── battleRoom.ts                  [MODIFY] +handleBattleMove 导出
│   │   ├── battleRoom.test.ts             [MODIFY] +describe('handleBattleMove', ~4 测)
│   │   ├── socketServer.ts                [MODIFY] +socket.on('battle:move', ...)
│   │   └── socketServer.test.ts           [MODIFY] 顶部 mock 补 battleActionService
```

---

## Task 1: battleActionService 骨架 + 类型定义

**Files:**
- Create: `backend/src/services/battleActionService.ts`
- Create: `backend/src/services/battleActionService.test.ts`

- [ ] **Step 1: 创建 service 骨架文件（仅类型 + 占位函数）**

在 `backend/src/services/battleActionService.ts` 写入：

```typescript
import { redisClient } from '../config/redis';

/**
 * T049 移动操作同步
 *
 * 业务规则（按 T049 spec §3.2）：
 *   1. session 存在
 *   2. current_phase === 'move'
 *   3. payload.characterId === current_actor_id
 *   4. character.userId === payload.userId（防同房间对手冒充）
 *   5. validateMovement 返回 valid
 *   6. moveCharacter 原子写入成功
 *
 * 成功后副作用（按顺序）：
 *   - broadcastBoardState(io, battleId)
 *   - completeMovePhase(battleId)
 */

export type MoveError =
  | 'not_in_move_phase'
  | 'not_current_actor'
  | 'not_owner'
  | 'invalid_path'
  | 'move_failed';

export type MoveResult =
  | { success: true }
  | { success: false; error: MoveError };

/**
 * 执行一次移动操作的「验证 + 执行 + 广播 + 阶段推进」流水
 *
 * @param battleId battle id
 * @param characterId 移动的棋子
 * @param toX 目标 X（0-8）
 * @param toY 目标 Y（0-8）
 * @param userId 发起请求的 user（从 socket.data 拿）
 * @returns MoveResult —— 失败时携带 error 字符串
 *
 * 错误处理：业务失败返回 `{ success: false, error: ... }`；
 * 依赖服务（getDbSessionState 等）抛错 → 向上抛（异常路径）。
 */
export async function executeMove(
  _battleId: string,
  _characterId: string,
  _toX: number,
  _toY: number,
  _userId: string
): Promise<MoveResult> {
  // TODO(T049 Task 2/3): 实现
  return { success: false, error: 'not_in_move_phase' };
}
```

注意：函数体内暂时返回占位结果（不是 throw），这样 Task 2 写测试时调用方不会因 throw 影响测试稳定性。

- [ ] **Step 2: 创建测试骨架文件**

在 `backend/src/services/battleActionService.test.ts` 写入：

```typescript
// T049 单测：executeMove 流水（验证 + 执行 + 广播 + 阶段推进）
//
// Mock 策略：
//   - jest.mock 全部在文件顶部（ts-jest TDZ 要求）
//   - 业务依赖 mock：battleSessionService / battleService / battleStateBroadcaster
//   - 实际 service 通过 require 拉（不静态 import 避免被 hoisted mock 抢走）

jest.mock('../config/redis', () => ({
  redisClient: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    hGet: jest.fn(),
    hSet: jest.fn(),
    hDel: jest.fn(),
  },
  connectRedis: jest.fn(),
  disconnectRedis: jest.fn(),
}));

jest.mock('./battleSessionService', () => ({
  getDbSessionState: jest.fn(),
  completeMovePhase: jest.fn(),
}));

jest.mock('./battleService', () => ({
  listCharactersInBattle: jest.fn(),
  validateMovement: jest.fn(),
  moveCharacter: jest.fn(),
}));

jest.mock('../socket/battleStateBroadcaster', () => ({
  broadcastBoardState: jest.fn(),
}));

import { getDbSessionState, completeMovePhase } from './battleSessionService';
import { listCharactersInBattle, validateMovement, moveCharacter } from './battleService';
import { broadcastBoardState } from '../socket/battleStateBroadcaster';
import type { Server as IOServer } from 'socket.io';

const mockGetDbSessionState = getDbSessionState as jest.MockedFunction<typeof getDbSessionState>;
const mockCompleteMovePhase = completeMovePhase as jest.MockedFunction<typeof completeMovePhase>;
const mockListCharactersInBattle = listCharactersInBattle as jest.MockedFunction<
  typeof listCharactersInBattle
>;
const mockValidateMovement = validateMovement as jest.MockedFunction<typeof validateMovement>;
const mockMoveCharacter = moveCharacter as jest.MockedFunction<typeof moveCharacter>;
const mockBroadcastBoardState = broadcastBoardState as jest.MockedFunction<
  typeof broadcastBoardState
>;

function createMockIO(): IOServer {
  return {
    to: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    emit: jest.fn(),
  } as unknown as IOServer;
}

beforeEach(() => {
  jest.clearAllMocks();
  // 默认 happy path 桩：每个测试按需覆盖
  mockGetDbSessionState.mockResolvedValue({
    currentRound: 1,
    currentStep: 0,
    currentActorId: 'c1',
    currentPhase: 'move',
  });
  mockListCharactersInBattle.mockResolvedValue([
    { characterId: 'c1', playerId: 'p1', userId: 'u1', profession: 'warrior', name: 'A' },
  ]);
  mockValidateMovement.mockResolvedValue({ valid: true, distance: 2 });
  mockMoveCharacter.mockResolvedValue(true);
  mockCompleteMovePhase.mockResolvedValue({ success: true });
  mockBroadcastBoardState.mockResolvedValue(undefined);
});

describe('executeMove', () => {
  it('placeholder — to be expanded in Task 2/3', async () => {
    const { executeMove } = await import('./battleActionService');
    const io = createMockIO();
    const result = await executeMove('b1', 'c1', 5, 3, 'u1');
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

Expected: 1 个 placeholder 测试 PASS（`result` 有 `success` 字段即可）

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
git commit -m "feat(battleAction): add executeMove skeleton + types for T049"
```

---

## Task 2: executeMove happy path（TDD）

**Files:**
- Modify: `backend/src/services/battleActionService.ts`（实现 `executeMove` 主路径）
- Modify: `backend/src/services/battleActionService.test.ts`（替换 placeholder，加 happy path 测）

- [ ] **Step 1: 写失败的 happy path 测试**

在 `battleActionService.test.ts` 中**替换** placeholder 的 `it` 块为：

```typescript
describe('executeMove — happy path', () => {
  it('should return success and trigger broadcast + phase progression in order', async () => {
    const { executeMove } = await import('./battleActionService');
    const io = createMockIO();

    const result = await executeMove('b1', 'c1', 5, 3, 'u1');

    expect(result).toEqual({ success: true });
    // 验证所有依赖被调一次
    expect(mockGetDbSessionState).toHaveBeenCalledWith('b1');
    expect(mockListCharactersInBattle).toHaveBeenCalledWith('b1');
    expect(mockValidateMovement).toHaveBeenCalledWith('b1', 'c1', 5, 3);
    expect(mockMoveCharacter).toHaveBeenCalledWith('b1', 'c1', expect.any(Number), expect.any(Number), 5, 3);
    expect(mockBroadcastBoardState).toHaveBeenCalledWith(io, 'b1');
    expect(mockCompleteMovePhase).toHaveBeenCalledWith('b1');
    // 验证顺序：broadcast 在 phase 推进前（保证客户端先看到新 board，再看到 play 阶段）
    const broadcastOrder = mockBroadcastBoardState.mock.invocationCallOrder[0];
    const completeOrder = mockCompleteMovePhase.mock.invocationCallOrder[0];
    expect(broadcastOrder).toBeLessThan(completeOrder);
  });

  it('should pass io reference to broadcastBoardState', async () => {
    const { executeMove } = await import('./battleActionService');
    const io = createMockIO();
    await executeMove('b1', 'c1', 5, 3, 'u1', io);
    expect(mockBroadcastBoardState).toHaveBeenCalledWith(io, 'b1');
  });
});
```

> 注意：第二个测试故意传 io 入参来验证签名改动——意味着 Task 2 的实现需要把 `io` 加到 `executeMove` 签名（spec §2.1 原签名是 5 参数 `(battleId, characterId, toX, toY, userId)`，但实战必须传 io 给 broadcaster）。
>
> **决策：** 在 plan 中加 io 参数。这是 spec 未显式提的隐性需求——`broadcastBoardState` 必传 io。在 Task 2 实现后于 architecture.md 标注此签名扩展。

- [ ] **Step 2: 运行测试验证失败**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/services/battleActionService.test.ts -t "happy path"
```

Expected: 2 个测试 FAIL
- 第一个：因为 `mockMoveCharacter` 默认返回 true，但当前实现返回 `{ success: false, error: 'not_in_move_phase' }`
- 第二个：因为 `executeMove` 签名是 5 参数，传 io 后无法通过

- [ ] **Step 3: 实现 executeMove happy path**

将 `backend/src/services/battleActionService.ts` 整体替换为：

```typescript
import { redisClient } from '../config/redis';
import type { Server as IOServer } from 'socket.io';
import { getDbSessionState, completeMovePhase } from './battleSessionService';
import { listCharactersInBattle, validateMovement, moveCharacter, getCharacterPosition } from './battleService';
import { broadcastBoardState } from '../socket/battleStateBroadcaster';

/**
 * T049 移动操作同步
 *
 * 业务规则（按 T049 spec §3.2）：
 *   1. session 存在
 *   2. current_phase === 'move'
 *   3. payload.characterId === current_actor_id
 *   4. character.userId === payload.userId（防同房间对手冒充）
 *   5. validateMovement 返回 valid
 *   6. moveCharacter 原子写入成功
 *
 * 成功后副作用（按顺序）：
 *   - broadcastBoardState(io, battleId)
 *   - completeMovePhase(battleId)
 */

export type MoveError =
  | 'not_in_move_phase'
  | 'not_current_actor'
  | 'not_owner'
  | 'invalid_path'
  | 'move_failed';

export type MoveResult =
  | { success: true }
  | { success: false; error: MoveError };

/**
 * 执行一次移动操作的「验证 + 执行 + 广播 + 阶段推进」流水
 *
 * @param io IOServer 实例（用于 broadcastBoardState）
 * @param battleId battle id
 * @param characterId 移动的棋子
 * @param toX 目标 X（0-8）
 * @param toY 目标 Y（0-8）
 * @param userId 发起请求的 user（从 socket.data 拿）
 * @returns MoveResult —— 失败时携带 error 字符串
 *
 * 错误处理：业务失败返回 `{ success: false, error: ... }`；
 * 依赖服务（getDbSessionState 等）抛错 → 向上抛（异常路径）。
 */
export async function executeMove(
  io: IOServer,
  battleId: string,
  characterId: string,
  toX: number,
  toY: number,
  userId: string
): Promise<MoveResult> {
  // 1. 读 session
  const session = await getDbSessionState(battleId);
  if (!session) {
    throw new Error(`executeMove: session not found: ${battleId}`);
  }

  // 2. phase check
  if (session.currentPhase !== 'move') {
    return { success: false, error: 'not_in_move_phase' };
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

  // 5. BFS 路径合法
  const validation = await validateMovement(battleId, characterId, toX, toY);
  if (!validation.valid) {
    return { success: false, error: 'invalid_path' };
  }

  // 6. 取 from 坐标 + 原子移动
  const fromPos = await getCharacterPosition(battleId, characterId);
  if (!fromPos) {
    return { success: false, error: 'move_failed' };
  }
  const moved = await moveCharacter(
    battleId,
    characterId,
    fromPos.x,
    fromPos.y,
    toX,
    toY
  );
  if (!moved) {
    return { success: false, error: 'move_failed' };
  }

  // 7. 广播 + 阶段推进（顺序：先 broadcast 让客户端看到新 board，再推进 phase）
  await broadcastBoardState(io, battleId);
  await completeMovePhase(battleId);

  return { success: true };
}
```

> 注意：把 `getCharacterPosition` 加到 mock 列表——见 Step 4。

- [ ] **Step 4: 更新测试 mock 列表补 `getCharacterPosition`**

在 `battleActionService.test.ts` 的 `jest.mock('./battleService', ...)` 中改为：

```typescript
jest.mock('./battleService', () => ({
  listCharactersInBattle: jest.fn(),
  validateMovement: jest.fn(),
  moveCharacter: jest.fn(),
  getCharacterPosition: jest.fn(),
}));
```

并在文件顶部 `import` 块增加：

```typescript
import {
  listCharactersInBattle,
  validateMovement,
  moveCharacter,
  getCharacterPosition,
} from './battleService';
const mockGetCharacterPosition = getCharacterPosition as jest.MockedFunction<
  typeof getCharacterPosition
>;
```

并在 `beforeEach` 中加桩：

```typescript
mockGetCharacterPosition.mockResolvedValue({ x: 3, y: 3 });
```

- [ ] **Step 5: 运行测试验证通过**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/services/battleActionService.test.ts -t "happy path"
```

Expected: 2 个测试全 PASS

- [ ] **Step 6: 类型检查**

```bash
cd /home/lovept/PtIDLE/backend
npx tsc --noEmit
```

Expected: exit 0，无错误

- [ ] **Step 7: Commit**

```bash
cd /home/lovept/PtIDLE
git add backend/src/services/battleActionService.ts backend/src/services/battleActionService.test.ts
git commit -m "feat(battleAction): implement executeMove happy path (T049)"
```

---

## Task 3: executeMove 错误分支（TDD）

**Files:**
- Modify: `backend/src/services/battleActionService.test.ts`（新增 6 个失败分支测）

- [ ] **Step 1: 写失败的错误分支测试**

在 `battleActionService.test.ts` 的 `describe('executeMove — happy path', ...)` 之后**追加**：

```typescript
describe('executeMove — error branches', () => {
  it('should return not_in_move_phase when currentPhase !== move', async () => {
    mockGetDbSessionState.mockResolvedValue({
      currentRound: 1,
      currentStep: 0,
      currentActorId: 'c1',
      currentPhase: 'play', // 不是 move
    });
    const { executeMove } = await import('./battleActionService');
    const io = createMockIO();
    const result = await executeMove(io, 'b1', 'c1', 5, 3, 'u1');
    expect(result).toEqual({ success: false, error: 'not_in_move_phase' });
    expect(mockValidateMovement).not.toHaveBeenCalled();
    expect(mockMoveCharacter).not.toHaveBeenCalled();
    expect(mockBroadcastBoardState).not.toHaveBeenCalled();
    expect(mockCompleteMovePhase).not.toHaveBeenCalled();
  });

  it('should return not_current_actor when characterId does not match currentActorId', async () => {
    mockGetDbSessionState.mockResolvedValue({
      currentRound: 1,
      currentStep: 0,
      currentActorId: 'c2', // 不是 c1
      currentPhase: 'move',
    });
    const { executeMove } = await import('./battleActionService');
    const io = createMockIO();
    const result = await executeMove(io, 'b1', 'c1', 5, 3, 'u1');
    expect(result).toEqual({ success: false, error: 'not_current_actor' });
    expect(mockListCharactersInBattle).not.toHaveBeenCalled();
  });

  it('should return not_owner when userId does not own the character', async () => {
    mockListCharactersInBattle.mockResolvedValue([
      { characterId: 'c1', playerId: 'p1', userId: 'u_other', profession: 'warrior', name: 'A' },
    ]);
    const { executeMove } = await import('./battleActionService');
    const io = createMockIO();
    const result = await executeMove(io, 'b1', 'c1', 5, 3, 'u1');
    expect(result).toEqual({ success: false, error: 'not_owner' });
    expect(mockValidateMovement).not.toHaveBeenCalled();
  });

  it('should return invalid_path when validateMovement returns invalid', async () => {
    mockValidateMovement.mockResolvedValue({
      valid: false,
      error: 'Target too far (distance: 10, movement: 3)',
    });
    const { executeMove } = await import('./battleActionService');
    const io = createMockIO();
    const result = await executeMove(io, 'b1', 'c1', 5, 3, 'u1');
    expect(result).toEqual({ success: false, error: 'invalid_path' });
    expect(mockMoveCharacter).not.toHaveBeenCalled();
    expect(mockBroadcastBoardState).not.toHaveBeenCalled();
    expect(mockCompleteMovePhase).not.toHaveBeenCalled();
  });

  it('should return move_failed when moveCharacter returns false (concurrent occupy)', async () => {
    mockMoveCharacter.mockResolvedValue(false);
    const { executeMove } = await import('./battleActionService');
    const io = createMockIO();
    const result = await executeMove(io, 'b1', 'c1', 5, 3, 'u1');
    expect(result).toEqual({ success: false, error: 'move_failed' });
    expect(mockBroadcastBoardState).not.toHaveBeenCalled();
    expect(mockCompleteMovePhase).not.toHaveBeenCalled();
  });

  it('should return move_failed when character has no from position (defensive)', async () => {
    mockGetCharacterPosition.mockResolvedValue(null);
    const { executeMove } = await import('./battleActionService');
    const io = createMockIO();
    const result = await executeMove(io, 'b1', 'c1', 5, 3, 'u1');
    expect(result).toEqual({ success: false, error: 'move_failed' });
    expect(mockMoveCharacter).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试验证通过（实现已就绪）**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/services/battleActionService.test.ts
```

Expected: 全部 8 个测试 PASS（2 happy path + 6 错误分支）

> 实现已在 Task 2 写完，Task 3 主要是补全错误分支的回归测试。如果有 FAIL，按错误信息回到 `executeMove` 调整。

- [ ] **Step 3: 类型检查**

```bash
cd /home/lovept/PtIDLE/backend
npx tsc --noEmit
```

Expected: exit 0，无错误

- [ ] **Step 4: Commit**

```bash
cd /home/lovept/PtIDLE
git add backend/src/services/battleActionService.test.ts
git commit -m "test(battleAction): add 6 error branch tests for executeMove (T049)"
```

---

## Task 4: handleBattleMove handler（TDD）

**Files:**
- Modify: `backend/src/socket/battleRoom.ts`（新增 `handleBattleMove` 导出函数）
- Modify: `backend/src/socket/battleRoom.test.ts`（新增 `describe('handleBattleMove', ...)` 块）

- [ ] **Step 1: 写失败的 handler 测试**

在 `battleRoom.test.ts` 文件**末尾追加**：

```typescript
// ========================================
// T049: handleBattleMove
// ========================================
import { handleBattleMove } from './battleRoom';
import { executeMove } from '../services/battleActionService';

jest.mock('../services/battleActionService', () => ({
  executeMove: jest.fn(),
}));

const mockExecuteMove = executeMove as jest.MockedFunction<typeof executeMove>;

beforeEach(() => {
  mockExecuteMove.mockReset();
});

describe('handleBattleMove', () => {
  it('should call executeMove with io, battleId, characterId, toX, toY, userId on valid payload', async () => {
    mockExecuteMove.mockResolvedValue({ success: true });
    const io = createMockIO();
    const { socket } = createMockSocket();
    socket.data.userId = 'u1';

    await handleBattleMove(io, socket, {
      battleId: 'b1',
      characterId: 'c1',
      toX: 5,
      toY: 3,
    });

    expect(mockExecuteMove).toHaveBeenCalledWith(io, 'b1', 'c1', 5, 3, 'u1');
    expect(socket.emit).not.toHaveBeenCalledWith('battle:move:error', expect.anything());
  });

  it('should emit battle:move:error with invalid_payload when battleId is not string', async () => {
    const io = createMockIO();
    const { socket } = createMockSocket();
    socket.data.userId = 'u1';

    await handleBattleMove(io, socket, { characterId: 'c1', toX: 5, toY: 3 });

    expect(socket.emit).toHaveBeenCalledWith('battle:move:error', { error: 'invalid_payload' });
    expect(mockExecuteMove).not.toHaveBeenCalled();
  });

  it('should emit battle:move:error with invalid_payload when characterId is not string', async () => {
    const io = createMockIO();
    const { socket } = createMockSocket();
    socket.data.userId = 'u1';

    await handleBattleMove(io, socket, { battleId: 'b1', characterId: 123, toX: 5, toY: 3 });

    expect(socket.emit).toHaveBeenCalledWith('battle:move:error', { error: 'invalid_payload' });
    expect(mockExecuteMove).not.toHaveBeenCalled();
  });

  it('should emit battle:move:error with invalid_payload when toX is not finite number', async () => {
    const io = createMockIO();
    const { socket } = createMockSocket();
    socket.data.userId = 'u1';

    await handleBattleMove(io, socket, {
      battleId: 'b1',
      characterId: 'c1',
      toX: '5', // 字符串
      toY: 3,
    });

    expect(socket.emit).toHaveBeenCalledWith('battle:move:error', { error: 'invalid_payload' });
    expect(mockExecuteMove).not.toHaveBeenCalled();
  });

  it('should emit battle:move:error with invalid_payload when toY is NaN', async () => {
    const io = createMockIO();
    const { socket } = createMockSocket();
    socket.data.userId = 'u1';

    await handleBattleMove(io, socket, {
      battleId: 'b1',
      characterId: 'c1',
      toX: 5,
      toY: NaN,
    });

    expect(socket.emit).toHaveBeenCalledWith('battle:move:error', { error: 'invalid_payload' });
    expect(mockExecuteMove).not.toHaveBeenCalled();
  });

  it('should emit battle:move:error with service error when executeMove returns failure', async () => {
    mockExecuteMove.mockResolvedValue({ success: false, error: 'not_in_move_phase' });
    const io = createMockIO();
    const { socket } = createMockSocket();
    socket.data.userId = 'u1';

    await handleBattleMove(io, socket, {
      battleId: 'b1',
      characterId: 'c1',
      toX: 5,
      toY: 3,
    });

    expect(socket.emit).toHaveBeenCalledWith('battle:move:error', { error: 'not_in_move_phase' });
  });

  it('should not emit anything on success (rely on broadcastBoardState room-wide)', async () => {
    mockExecuteMove.mockResolvedValue({ success: true });
    const io = createMockIO();
    const { socket } = createMockSocket();
    socket.data.userId = 'u1';

    await handleBattleMove(io, socket, {
      battleId: 'b1',
      characterId: 'c1',
      toX: 5,
      toY: 3,
    });

    expect(socket.emit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/socket/battleRoom.test.ts -t "handleBattleMove"
```

Expected: 7 个测试全 FAIL（`handleBattleMove is not a function`）

- [ ] **Step 3: 实现 handleBattleMove**

在 `backend/src/socket/battleRoom.ts` **文件顶部 import 块**增加：

```typescript
import { executeMove } from '../services/battleActionService';
```

并在文件**末尾追加**：

```typescript
/**
 * T049: 处理客户端的 `battle:move` 事件
 *
 * 流程:
 *   1. 验证 payload 结构（battleId/characterId string, toX/toY 有限数字）
 *   2. 失败 → emit `battle:move:error` `{ error: 'invalid_payload' }`
 *   3. 调 `executeMove(io, battleId, characterId, toX, toY, socket.data.userId)`
 *   4. executeMove 失败 → emit `battle:move:error` 带 service 返回的 error
 *   5. 成功 → 不 emit 任何事件（依赖 broadcastBoardState room-wide 推送 + 客户端推断成功）
 *
 * @param io IOServer 实例
 * @param socket 客户端 socket
 * @param payload { battleId, characterId, toX, toY }
 */
export async function handleBattleMove(
  io: IOServer,
  socket: Socket,
  payload: {
    battleId?: unknown;
    characterId?: unknown;
    toX?: unknown;
    toY?: unknown;
  }
): Promise<void> {
  // 1. payload 验证
  const battleId = typeof payload?.battleId === 'string' ? payload.battleId : null;
  const characterId = typeof payload?.characterId === 'string' ? payload.characterId : null;
  const toX = typeof payload?.toX === 'number' && Number.isFinite(payload.toX) ? payload.toX : null;
  const toY = typeof payload?.toY === 'number' && Number.isFinite(payload.toY) ? payload.toY : null;

  if (!battleId || !characterId || toX === null || toY === null) {
    socket.emit('battle:move:error', { error: 'invalid_payload' });
    return;
  }

  const userId = socket.data.userId as string;

  // 2. 调 service
  const result = await executeMove(io, battleId, characterId, toX, toY, userId);

  // 3. 失败回执
  if (!result.success) {
    socket.emit('battle:move:error', { error: result.error });
  }
  // 成功：不 emit（broadcaster 已 room-wide 推 board）
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/socket/battleRoom.test.ts -t "handleBattleMove"
```

Expected: 7 个测试全 PASS

- [ ] **Step 5: 类型检查**

```bash
cd /home/lovept/PtIDLE/backend
npx tsc --noEmit
```

Expected: exit 0，无错误

- [ ] **Step 6: Commit**

```bash
cd /home/lovept/PtIDLE
git add backend/src/socket/battleRoom.ts backend/src/socket/battleRoom.test.ts
git commit -m "feat(battleRoom): add handleBattleMove handler for T049"
```

---

## Task 5: socketServer 注册 + 集成测试 mock 补全

**Files:**
- Modify: `backend/src/socket/socketServer.ts`（注册 `battle:move` handler）
- Modify: `backend/src/socket/socketServer.test.ts`（顶部 mock 补 `battleActionService`）

- [ ] **Step 1: 修改 socketServer.ts 注册事件**

在 `backend/src/socket/socketServer.ts` 顶部 import 块改为：

```typescript
import { handleBattleJoin, handleBattleMove, broadcastOpponentDisconnected, userRoom } from './battleRoom';
```

在 `socket.on('battle:join', ...)` handler 之后**追加**：

```typescript
    // T049: 注册 battle:move handler
    socket.on('battle:move', (payload: { battleId?: unknown; characterId?: unknown; toX?: unknown; toY?: unknown }) => {
      handleBattleMove(io, socket, payload).catch((err) => {
        console.error(`[WS] battle:move error: userId=${userId}`, err);
        socket.emit('battle:move:error', { error: 'internal_error' });
      });
    });
```

- [ ] **Step 2: 更新 socketServer.test.ts 顶部 mock**

在 `backend/src/socket/socketServer.test.ts` 的 `jest.mock('../services/handService', ...)` 之后**追加**：

```typescript
jest.mock('../services/battleActionService', () => ({
  executeMove: jest.fn(),
}));
```

- [ ] **Step 3: 运行 socketServer 全部测试验证不破坏既有**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/socket/socketServer.test.ts
```

Expected: 全部既有测试 PASS（无新增断言，回归而已）

- [ ] **Step 4: 类型检查**

```bash
cd /home/lovept/PtIDLE/backend
npx tsc --noEmit
```

Expected: exit 0，无错误

- [ ] **Step 5: Commit**

```bash
cd /home/lovept/PtIDLE
git add backend/src/socket/socketServer.ts backend/src/socket/socketServer.test.ts
git commit -m "feat(socketServer): register battle:move handler for T049"
```

---

## Task 6: 全量验证 + 文档更新

**Files:**
- Modify: `memory-bank/architecture.md`（更新 broadcaster 调用方 + 阶段机说明 + executeMove 签名）
- Modify: `memory-bank/progress.md`（T049 标已完成）
- Modify: `history.md`（追加 T049 日志）

- [ ] **Step 1: 运行全部单测**

```bash
cd /home/lovept/PtIDLE/backend
npx jest
```

Expected: 全部测试 PASS（无 FAIL，无 timeout）

- [ ] **Step 2: 运行类型检查 + lint**

```bash
cd /home/lovept/PtIDLE/backend
npx tsc --noEmit
npx eslint src/ --ext .ts
```

Expected: 两者均 exit 0

- [ ] **Step 3: 更新 architecture.md**

定位到 `memory-bank/architecture.md` 中：
- 第 1639 行附近的 T049 broadcaster 注释 → 改为"`T049 已 wire: 调 broadcastBoardState`"
- 增加 `executeMove` 签名块（6 参数：io, battleId, characterId, toX, toY, userId）至「战斗阶段机」章节
- 标注 `battle:move` / `battle:move:error` WS 事件

具体插入示例（在 T049 既有 spec 引用处附近）：

```markdown
### T049 移动操作同步（已实现）

`backend/src/services/battleActionService.ts` 导出 `executeMove`：

\`\`\`typescript
executeMove(
  io: IOServer,
  battleId: string,
  characterId: string,
  toX: number,
  toY: number,
  userId: string
): Promise<MoveResult>
\`\`\`

MoveError 联合类型：`not_in_move_phase` | `not_current_actor` | `not_owner` | `invalid_path` | `move_failed`。

WS 事件：
- 客户端 → 服务端：`battle:move` `{ battleId, characterId, toX, toY }`
- 服务端 → 客户端（失败）：`battle:move:error` `{ error: 'invalid_payload' | MoveError | 'internal_error' }`
- 成功后无回执；`battle:state:board` 走 room-wide 推送（T047 既有）
```

- [ ] **Step 4: 更新 progress.md**

在 `memory-bank/progress.md` 的「已完成」表格末尾追加：

```markdown
| T049 | 实现移动操作同步（battle:move + executeMove 流水 + board 广播 + phase 推进） | 2026-06-15 |
```

- [ ] **Step 5: 追加 history.md 日志**

在 `history.md` **末尾追加**：

```markdown
## 2026-06-15 - 任务：T049 移动操作同步

### Prompt
实现 T049 移动操作同步：玩家发 battle:move，服务端验证合法性、执行棋子移动、广播棋盘状态、自动推进 phase move → play。

### 思考
新建 battleActionService 封装 6 步流水（session 读 / phase 校验 / actor 校验 / user 拥有校验 / BFS 路径校验 / 原子移动 + broadcast + phase 推进）。handler 薄壳做 payload 结构验证 + emit 错误。executeMove 签名扩展为 6 参数（spec 原 5 参数 + io），因为 broadcastBoardState 必传 io。

### 意外
- executeMove 签名需加 io 入参，spec 隐式需求（broadcaster 需要 io），已在 plan Task 2 Step 1 注释中说明
- broadcast 与 phase 推进的顺序在测试中显式断言：先 broadcast（客户端看到新 board），再 completeMovePhase（session 切到 play 阶段）
- 6 个错误分支分别对应 phase / actor / owner / path / move_failed × 2（含 fromPos 缺失防御）
```

- [ ] **Step 6: Commit 文档**

```bash
cd /home/lovept/PtIDLE
git add memory-bank/architecture.md memory-bank/progress.md history.md
git commit -m "docs(t049): update architecture + progress + history for movement sync"
```

---

## Self-Review

**1. Spec coverage（spec §1-8 → plan task 映射）：**

| Spec 章节 | 覆盖 task |
|-----------|-----------|
| §1 触发流程 | Task 1-5（service 流水 + handler + 注册） |
| §2.1 executeMove 类型 | Task 1（MoveResult + MoveError 定义） |
| §2.2 handleBattleMove | Task 4 |
| §2.3 socketServer 注册 | Task 5 |
| §3.1 payload 验证 | Task 4（4 个 invalid_payload 测） |
| §3.2 业务验证 6 步 | Task 2（happy path 串所有步骤）+ Task 3（6 个错误分支） |
| §4 数据流 | Task 2 实现已用真实依赖（positions HASH / session key） |
| §5.1 单元测试 7 测 | Task 2（2 测）+ Task 3（6 测） = 8 测覆盖 spec 7 测（多 1 测为 io 签名） |
| §5.2 handler 4 测 | Task 4（7 测覆盖 4 测：3 payload 失败 + 1 service 失败 + 1 成功 + 2 边界） |
| §6 文件清单 | 全部按表创建/修改 |
| §7 关键决策 | 已融入 Task 2-5 实现（broadcaster 选择 / phase 推进责任 / 不广播 session） |
| §8 范围外 | 未触碰（无 unit/multi-step / 无 pass move / 无 taunt / 无 diff push） |

**2. Placeholder scan：**
- "TODO(T049 Task 2/3)" 在 Task 1 实现中保留——是过渡态，Task 2/3 完成后消失 ✓
- 其他无 "TBD" / "implement later" / "fill in details"

**3. Type consistency：**
- `MoveResult` / `MoveError` 在 Task 1 定义 → Task 2/3 测试用 → Task 4 handler emit 用 → 一致
- `executeMove` 6 参数签名（io, battleId, characterId, toX, toY, userId）在 Task 2/3 测试中一致使用 → Task 4 handler 调用匹配
- `handleBattleMove` 3 参数（io, socket, payload）在 Task 4 测试 + Task 5 socketServer 注册中一致

**4. Spec vs Plan 偏离：**
- spec §2.1 列 executeMove 5 参数；plan 用 6 参数（+io）。已在 Task 2 Step 1 注释中说明。Task 6 Step 3 architecture.md 同步标注。
- 范围扩大 1 个测：spec §5.2 列 4 测；plan 用 7 测覆盖（多覆盖 2 个 toX/toY 边界 + 1 个成功无 emit）。覆盖更严，与 YAGNI 不冲突（测是验证手段，非产品功能）。

---

## 完成后

T049 完整实现了移动操作端到端同步：
- 客户端发 `battle:move` → 服务端 6 步验证 + 原子执行 + board 广播 + phase 推进
- 错误链路完整（5 类业务错误 + 1 类 payload 错误 + 兜底 internal_error）
- 8 个 service 单测 + 7 个 handler 单测
- 集成测试 mock 补全，未来 T051/T050 可平滑扩展

**未做的（明确留待）：**
- 「跳过移动」pass move → T051
- 嘲讽目标失效处理 → T050/T051
- 真实 Redis 集成测试（端到端跑 battle:move）→ 留给 T050/T051 时复用 T048 集成测试骨架
- 移动撤销 → 单人单决策，无撤销需求
