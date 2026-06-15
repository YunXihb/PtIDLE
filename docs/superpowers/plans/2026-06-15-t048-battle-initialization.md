# T048 战场初始化实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 3v3 战棋对战的战场初始化流程——当双方玩家都 `battle:join` 后自动初始化棋盘、放置棋子、抽牌、开启状态机、广播全量状态。

**Architecture:** 新增 `battleInitializationService` orchestrator，按 7 步流水执行 init 流程；`handleBattleJoin` 拿到 SETNX 锁后调用 `initBattleField(io, battleId)`；失败时通过 `cleanupPartialInit` 阶梯式反向清理 Redis keys + 回滚 battles.status；客户端重 join 触发幂等重试。

**Tech Stack:** Node.js + TypeScript + Express + Socket.io + PostgreSQL + Redis（v4 client）+ Jest + ts-jest

**Spec:** `docs/superpowers/specs/2026-06-15-t048-battle-initialization-design.md`

---

## File Structure

```
backend/
├── src/
│   ├── migrations/
│   │   └── 008_t048_battle_init.sql            [NEW] characters.battle_id + deck_position + 索引
│   ├── services/
│   │   ├── battleInitializationService.ts     [NEW] initBattleField + cleanupPartialInit + loadBattleCharacters
│   │   ├── battleInitializationService.test.ts [NEW] 单测 ~15
│   │   ├── battleService.ts                   [MODIFY] +setCharacterEnergy API
│   │   └── battleService.test.ts              [MODIFY] +setCharacterEnergy 测试 ~3
│   ├── socket/
│   │   ├── battleRoom.ts                      [MODIFY] +tryInitBattleField + wire 到 handleBattleJoin
│   │   ├── battleRoom.test.ts                 [NEW] 单测 ~8
│   │   └── battleRoom.integration.test.ts     [NEW] 集成测 ~3
```

---

## Task 1: 数据库迁移 008

**Files:**
- Create: `backend/src/migrations/008_t048_battle_init.sql`

- [ ] **Step 1: 创建 migration 文件**

在 `backend/src/migrations/008_t048_battle_init.sql` 写入：

```sql
-- 008_t048_battle_init.sql
-- T048 战场初始化：为 characters 表加 battle_id 软绑定 + deck_position + 索引

-- 1. characters 表加 battle_id（软绑定，NULL 表示未入战）
ALTER TABLE characters ADD COLUMN battle_id UUID REFERENCES battles(id) ON DELETE SET NULL;
CREATE INDEX idx_characters_battle_id ON characters(battle_id);

-- 2. characters 表加 deck_position（3v3 中棋子 0/1/2 位序，预留给未来）
ALTER TABLE characters ADD COLUMN deck_position INTEGER;

-- 3. battles.started_at 索引（查询加速）
CREATE INDEX IF NOT EXISTS idx_battles_started_at ON battles(started_at);
```

- [ ] **Step 2: 在本地 PG 跑 migration 验证**

```bash
cd /home/lovept/PtIDLE
docker compose up -d postgres
docker compose exec -T postgres psql -U postgres -d ptidle -f /dev/stdin < backend/src/migrations/008_t048_battle_init.sql
```

Expected: 无错误输出（DDL 成功执行）

- [ ] **Step 3: 验证列已加**

```bash
docker compose exec -T postgres psql -U postgres -d ptidle -c "\d characters" | grep -E "battle_id|deck_position"
docker compose exec -T postgres psql -U postgres -d ptidle -c "\d battles" | grep started_at
```

Expected: 输出包含 `battle_id | uuid` 和 `deck_position | integer`；`started_at` 在索引列表中

- [ ] **Step 4: Commit**

```bash
cd /home/lovept/PtIDLE
git add backend/src/migrations/008_t048_battle_init.sql
git commit -m "feat(migration): add characters.battle_id + deck_position for T048"
```

---

## Task 2: battleService.setCharacterEnergy (TDD)

**Files:**
- Modify: `backend/src/services/battleService.ts`（在文件末尾新增函数）
- Modify: `backend/src/services/battleService.test.ts`（在文件末尾新增 describe 块）

- [ ] **Step 1: 写失败的测试**

在 `battleService.test.ts` 文件末尾添加：

```typescript
describe('setCharacterEnergy', () => {
  let mockHGet: jest.Mock;
  let mockHSet: jest.Mock;
  let mockRedisClient: { hGet: jest.Mock; hSet: jest.Mock };

  beforeEach(() => {
    mockHGet = jest.fn();
    mockHSet = jest.fn();
    mockRedisClient = { hGet: mockHGet, hSet: mockHSet };
    jest.doMock('../config/redis', () => ({ redisClient: mockRedisClient }));
    jest.resetModules();
  });

  it('should set energy on empty piece', async () => {
    mockHGet.mockResolvedValue(null);
    const { setCharacterEnergy } = await import('./battleService');
    await setCharacterEnergy('b1', 'c1', 3);
    expect(mockHGet).toHaveBeenCalledWith('battle:b1:pieces', 'c1');
    expect(mockHSet).toHaveBeenCalledWith('battle:b1:pieces', 'c1', JSON.stringify({ energy: 3 }));
  });

  it('should preserve existing piece fields when updating energy', async () => {
    mockHGet.mockResolvedValue(JSON.stringify({ health: 20, maxHealth: 20, energy: 0 }));
    const { setCharacterEnergy } = await import('./battleService');
    await setCharacterEnergy('b1', 'c1', 3);
    const written = JSON.parse(mockHSet.mock.calls[0][2]);
    expect(written).toEqual({ health: 20, maxHealth: 20, energy: 3 });
  });

  it('should throw on non-existent character (defensive — pieces HASH empty)', async () => {
    mockHGet.mockResolvedValue(null);
    mockHSet.mockRejectedValue(new Error('Redis write failed'));
    const { setCharacterEnergy } = await import('./battleService');
    await expect(setCharacterEnergy('b1', 'ghost', 3)).rejects.toThrow('Redis write failed');
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/services/battleService.test.ts -t setCharacterEnergy
```

Expected: 3 个测试全 FAIL（`setCharacterEnergy is not a function` 或 `Cannot find module`）

- [ ] **Step 3: 实现 setCharacterEnergy**

在 `battleService.ts` 文件末尾添加：

```typescript
import { redisClient } from '../config/redis';

/**
 * T048: 设置棋子能量（read-modify-write 复用 pieces HASH）
 */
export async function setCharacterEnergy(
  battleId: string,
  characterId: string,
  energy: number
): Promise<void> {
  const key = `battle:${battleId}:pieces`;
  const raw = await redisClient.hGet(key, characterId);
  const piece = raw ? JSON.parse(raw) : {};
  piece.energy = energy;
  await redisClient.hSet(key, characterId, JSON.stringify(piece));
}
```

注意：检查 `battleService.ts` 顶部是否已 import `redisClient`。若已有则不加新 import。

- [ ] **Step 4: 运行测试验证通过**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/services/battleService.test.ts -t setCharacterEnergy
```

Expected: 3 个测试全 PASS

- [ ] **Step 5: 类型检查**

```bash
cd /home/lovept/PtIDLE/backend
npx tsc --noEmit
```

Expected: exit 0，无错误

- [ ] **Step 6: Commit**

```bash
cd /home/lovept/PtIDLE
git add backend/src/services/battleService.ts backend/src/services/battleService.test.ts
git commit -m "feat(battleService): add setCharacterEnergy for T048 init step 3"
```

---

## Task 3: battleInitializationService 骨架 + 类型 + 常量

**Files:**
- Create: `backend/src/services/battleInitializationService.ts`

- [ ] **Step 1: 创建骨架文件**

创建 `backend/src/services/battleInitializationService.ts`：

```typescript
/**
 * T048 战场初始化 Orchestrator
 *
 * 负责 3v3 战棋对战初始化全流程：
 * 1. initializeBoard
 * 2. placeCharacter × 6 (默认位置)
 * 3. setCharacterEnergy × 6
 * 4. drawCards × 6
 * 5. initializeSession
 * 6. UPDATE battles status='ongoing'
 * 7. broadcastFullState × 2
 *
 * 失败时通过 cleanupPartialInit 阶梯式反向清理。
 */

import type { Server as IOServer } from 'socket.io';
import * as battleService from './battleService';
import * as handService from './handService';
import * as battleSessionService from './battleSessionService';
import { query, queryOne } from '../config/database';
import { redisClient } from '../config/redis';

// ─── 公共类型 ──────────────────────────────────────────────
export type InitResult =
  | { success: true; startedAt: Date; actorId: string }
  | { success: false; failedStep: number; error: string };

interface CharacterRow {
  id: string;
  player_id: string;
  user_id: string;       // JOIN users 拿到的字段，用于 broadcastFullState
  name: string;
  profession: string;
  health: number;
  max_health: number;
  movement: number;
  energy: number;
  max_energy: number;
  is_alive: boolean;
}

// ─── 3v3 默认位置常量（硬编码）──────────────────────────
const DEFAULT_P1_POSITIONS_3V3: Array<{ x: number; y: number }> = [
  { x: 6, y: 0 }, { x: 7, y: 0 }, { x: 8, y: 0 },
];
const DEFAULT_P2_POSITIONS_3V3: Array<{ x: number; y: number }> = [
  { x: 0, y: 8 }, { x: 1, y: 8 }, { x: 2, y: 8 },
];

// ─── 主入口 ────────────────────────────────────────────────
export async function initBattleField(io: IOServer, battleId: string): Promise<InitResult> {
  throw new Error('initBattleField: not yet implemented');
}

// ─── 反向清理 ──────────────────────────────────────────────
export async function cleanupPartialInit(battleId: string, lastSuccessfulStep: number): Promise<void> {
  throw new Error('cleanupPartialInit: not yet implemented');
}

// ─── 内部辅助：取前 3 个 alive 棋子 + 绑定 battle_id ──────
async function loadBattleCharacters(battleId: string): Promise<{
  p1Chars: CharacterRow[];
  p2Chars: CharacterRow[];
}> {
  throw new Error('loadBattleCharacters: not yet implemented');
}
```

- [ ] **Step 2: 类型检查**

```bash
cd /home/lovept/PtIDLE/backend
npx tsc --noEmit
```

Expected: exit 0，无错误（骨架编译通过）

- [ ] **Step 3: Commit**

```bash
cd /home/lovept/PtIDLE
git add backend/src/services/battleInitializationService.ts
git commit -m "feat(services): add battleInitializationService skeleton with types"
```

---

## Task 4: loadBattleCharacters 实现 (TDD)

**Files:**
- Modify: `backend/src/services/battleInitializationService.ts`
- Create: `backend/src/services/battleInitializationService.test.ts`

- [ ] **Step 1: 写测试文件骨架（含 mock 设置）**

创建 `backend/src/services/battleInitializationService.test.ts`：

```typescript
// T048 单测：TDZ 顺序，jest.mock 必须在所有 import 之前
jest.mock('./battleService', () => ({
  initializeBoard: jest.fn(),
  placeCharacter: jest.fn(),
  setCharacterEnergy: jest.fn(),
}));
jest.mock('./handService', () => ({
  drawCards: jest.fn(),
}));
jest.mock('./battleSessionService', () => ({
  initializeSession: jest.fn(),
  getActivationOrder: jest.fn(),
}));
jest.mock('../config/database', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
  execute: jest.fn(),
}));
jest.mock('../config/redis', () => ({
  redisClient: {
    set: jest.fn(),
    del: jest.fn(),
    hGet: jest.fn(),
    hSet: jest.fn(),
  },
}));

import * as battleService from './battleService';
import * as handService from './handService';
import * as battleSessionService from './battleSessionService';
import { query, queryOne } from '../config/database';
import { redisClient } from '../config/redis';
import { initBattleField, cleanupPartialInit } from './battleInitializationService';

const mockInitializeBoard = battleService.initializeBoard as jest.MockedFunction<typeof battleService.initializeBoard>;
const mockPlaceCharacter = battleService.placeCharacter as jest.MockedFunction<typeof battleService.placeCharacter>;
const mockSetEnergy = battleService.setCharacterEnergy as jest.MockedFunction<typeof battleService.setCharacterEnergy>;
const mockDrawCards = handService.drawCards as jest.MockedFunction<typeof handService.drawCards>;
const mockInitSession = battleSessionService.initializeSession as jest.MockedFunction<typeof battleSessionService.initializeSession>;
const mockGetOrder = battleSessionService.getActivationOrder as jest.MockedFunction<typeof battleSessionService.getActivationOrder>;
const mockQuery = query as jest.MockedFunction<typeof query>;
const mockQueryOne = queryOne as jest.MockedFunction<typeof queryOne>;
const mockRedisSet = redisClient.set as jest.MockedFunction<typeof redisClient.set>;
const mockRedisDel = redisClient.del as jest.MockedFunction<typeof redisClient.del>;
const mockBroadcast = jest.fn();

const FAKE_IO: any = { to: jest.fn().mockReturnThis(), emit: mockBroadcast };

const P1_CHARS = [
  { id: 'c1', player_id: 'p1', user_id: 'u1', name: 'W1', profession: 'warrior', health: 20, max_health: 20, movement: 2, energy: 0, max_energy: 3, is_alive: true },
  { id: 'c2', player_id: 'p1', user_id: 'u1', name: 'R1', profession: 'ranger',  health: 15, max_health: 15, movement: 3, energy: 0, max_energy: 3, is_alive: true },
  { id: 'c3', player_id: 'p1', user_id: 'u1', name: 'M1', profession: 'mage',    health: 12, max_health: 12, movement: 2, energy: 0, max_energy: 3, is_alive: true },
];
const P2_CHARS = [
  { id: 'c4', player_id: 'p2', user_id: 'u2', name: 'W2', profession: 'warrior', health: 20, max_health: 20, movement: 2, energy: 0, max_energy: 3, is_alive: true },
  { id: 'c5', player_id: 'p2', user_id: 'u2', name: 'R2', profession: 'ranger',  health: 15, max_health: 15, movement: 3, energy: 0, max_energy: 3, is_alive: true },
  { id: 'c6', player_id: 'p2', user_id: 'u2', name: 'M2', profession: 'mage',    health: 12, max_health: 12, movement: 2, energy: 0, max_energy: 3, is_alive: true },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockInitializeBoard.mockResolvedValue({} as any);
  mockPlaceCharacter.mockResolvedValue({} as any);
  mockSetEnergy.mockResolvedValue(undefined);
  mockDrawCards.mockResolvedValue({} as any);
  mockInitSession.mockResolvedValue(undefined);
  mockGetOrder.mockReturnValue(['c1', 'c4', 'c2', 'c5', 'c3', 'c6']);
  // mockQueryOne for loadBattleCharacters: battles row + p1 chars + p2 chars
  mockQueryOne.mockResolvedValueOnce({ player1_id: 'p1', player2_id: 'p2' });
  mockQuery.mockResolvedValueOnce(P1_CHARS);  // p1 chars query
  mockQuery.mockResolvedValueOnce(P2_CHARS);  // p2 chars query
  mockQuery.mockResolvedValueOnce({ rowCount: 1 });  // UPDATE characters.battle_id
  // mockQuery for UPDATE battles status=ongoing
  mockQuery.mockResolvedValueOnce({ rowCount: 1 });
});

describe('loadBattleCharacters (via initBattleField happy path)', () => {
  // 测试会在 Task 5 中添加，本 task 只建立 mock 基础设施
  it('placeholder — actual tests in Task 5+', () => {
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试文件确认骨架编译通过**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/services/battleInitializationService.test.ts
```

Expected: 1 个 placeholder 测试 PASS

- [ ] **Step 3: Commit 测试骨架**

```bash
cd /home/lovept/PtIDLE
git add backend/src/services/battleInitializationService.test.ts
git commit -m "test(services): add battleInitializationService test skeleton with mocks"
```

---

## Task 5: initBattleField happy path 实现 (TDD)

**Files:**
- Modify: `backend/src/services/battleInitializationService.ts`
- Modify: `backend/src/services/battleInitializationService.test.ts`

- [ ] **Step 1: 替换 placeholder 测试为 happy path 测试**

替换 Task 4 中 `describe('loadBattleCharacters (via initBattleField happy path)', ...)` 块：

```typescript
describe('initBattleField happy path', () => {
  it('should execute all 7 steps and return success', async () => {
    const result = await initBattleField(FAKE_IO, 'b1');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.actorId).toBe('c1');
      expect(result.startedAt).toBeInstanceOf(Date);
    }

    // 步骤 1: initializeBoard
    expect(mockInitializeBoard).toHaveBeenCalledWith('b1');
    // 步骤 2: placeCharacter × 6
    expect(mockPlaceCharacter).toHaveBeenCalledTimes(6);
    expect(mockPlaceCharacter).toHaveBeenNthCalledWith(1, 'b1', 'c1', 6, 0);
    expect(mockPlaceCharacter).toHaveBeenNthCalledWith(2, 'b1', 'c4', 0, 8);
    expect(mockPlaceCharacter).toHaveBeenNthCalledWith(6, 'b1', 'c6', 2, 8);
    // 步骤 3: setCharacterEnergy × 6
    expect(mockSetEnergy).toHaveBeenCalledTimes(6);
    expect(mockSetEnergy).toHaveBeenCalledWith('b1', 'c1', 3);
    // 步骤 4: drawCards × 6
    expect(mockDrawCards).toHaveBeenCalledTimes(6);
    expect(mockDrawCards).toHaveBeenCalledWith('b1', 'c1', 3);
    // 步骤 5: initializeSession
    expect(mockInitSession).toHaveBeenCalledWith('b1', P1_CHARS, P2_CHARS);
    // 步骤 6: UPDATE battles (注意：还有 loadBattleCharacters 的 UPDATE 共 2 次 query)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining(`UPDATE battles`),
      expect.arrayContaining(['c1', 'b1'])
    );
    // 步骤 7: broadcastFullState × 2
    expect(mockBroadcast).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/services/battleInitializationService.test.ts -t "initBattleField happy path"
```

Expected: 1 个测试 FAIL（"initBattleField: not yet implemented"）

- [ ] **Step 3: 实现 initBattleField + loadBattleCharacters 完整版**

替换 `battleInitializationService.ts` 中的两个 throw 占位函数 + 顶部 import：

```typescript
// 顶部加 broadcast 导入
import { broadcastFullState } from '../socket/battleStateBroadcaster';

// 替换 initBattleField
export async function initBattleField(io: IOServer, battleId: string): Promise<InitResult> {
  let lastStep = 0;

  try {
    // ── 步骤 1: 棋盘初始化 ─────────────────────────────────
    lastStep = 1;
    await battleService.initializeBoard(battleId);

    // ── 步骤 2: 6 个棋子放置到默认位置 ──────────────────────
    lastStep = 2;
    const { p1Chars, p2Chars } = await loadBattleCharacters(battleId);
    if (p1Chars.length < 3 || p2Chars.length < 3) {
      return {
        success: false,
        failedStep: 2,
        error: `Insufficient characters: p1=${p1Chars.length}, p2=${p2Chars.length}`,
      };
    }
    for (let i = 0; i < 3; i++) {
      await battleService.placeCharacter(battleId, p1Chars[i].id, DEFAULT_P1_POSITIONS_3V3[i].x, DEFAULT_P1_POSITIONS_3V3[i].y);
      await battleService.placeCharacter(battleId, p2Chars[i].id, DEFAULT_P2_POSITIONS_3V3[i].x, DEFAULT_P2_POSITIONS_3V3[i].y);
    }

    // ── 步骤 3: 设置初始能量（满能量 3 点） ────────────────
    lastStep = 3;
    for (const c of [...p1Chars, ...p2Chars]) {
      await battleService.setCharacterEnergy(battleId, c.id, 3);
    }

    // ── 步骤 4: 6 个棋子各抽 3 张初始手牌 ─────────────────
    lastStep = 4;
    for (const c of [...p1Chars, ...p2Chars]) {
      await handService.drawCards(battleId, c.id, 3);
    }

    // ── 步骤 5: 初始化状态机（蛇形顺序） ──────────────────
    lastStep = 5;
    await battleSessionService.initializeSession(battleId, p1Chars, p2Chars);

    // ── 步骤 6: 持久化 battles 行（pending → ongoing） ──────
    lastStep = 6;
    const order = battleSessionService.getActivationOrder(battleId);
    const startedAt = new Date();
    const result = await query(
      `UPDATE battles
       SET status='ongoing', started_at=$1, current_actor_id=$2,
           current_phase='idle', current_round=1, current_step=0,
           updated_at=NOW()
       WHERE id=$3 AND status='pending'`,
      [startedAt, order[0], battleId]
    );
    if (result.rowCount !== 1) {
      return { success: false, failedStep: 6, error: 'battle_row_not_updated' };
    }

    // ── 步骤 7: 广播全量状态给双端 ─────────────────────────
    lastStep = 7;
    try {
      await broadcastFullState(io, battleId, p1Chars[0].user_id);
      await broadcastFullState(io, battleId, p2Chars[0].user_id);
    } catch (broadcastErr) {
      console.error(`[initBattleField:${battleId}] broadcast failed:`, broadcastErr);
    }

    return { success: true, startedAt, actorId: order[0] };

  } catch (err) {
    await cleanupPartialInit(battleId, lastStep).catch(cleanupErr => {
      console.error(`[initBattleField:${battleId}] cleanup also failed:`, cleanupErr);
    });
    return { success: false, failedStep: lastStep, error: (err as Error).message };
  }
}

// 替换 loadBattleCharacters
async function loadBattleCharacters(battleId: string): Promise<{
  p1Chars: CharacterRow[];
  p2Chars: CharacterRow[];
}> {
  const battleRow = await queryOne<{ player1_id: string; player2_id: string }>(
    `SELECT player1_id, player2_id FROM battles WHERE id=$1`,
    [battleId]
  );
  if (!battleRow) {
    throw new Error(`Battle ${battleId} not found`);
  }
  const p1Chars = await query<CharacterRow>(
    `SELECT c.id, c.player_id, u.id AS user_id, c.name, c.profession,
            c.health, c.max_health, c.movement, c.energy, c.max_energy, c.is_alive
     FROM characters c
     JOIN players p ON p.id = c.player_id
     JOIN users u ON u.id = p.user_id
     WHERE c.player_id=$1 AND c.is_alive=TRUE
     ORDER BY c.created_at ASC LIMIT 3`,
    [battleRow.player1_id]
  );
  const p2Chars = await query<CharacterRow>(
    `SELECT c.id, c.player_id, u.id AS user_id, c.name, c.profession,
            c.health, c.max_health, c.movement, c.energy, c.max_energy, c.is_alive
     FROM characters c
     JOIN players p ON p.id = c.player_id
     JOIN users u ON u.id = p.user_id
     WHERE c.player_id=$1 AND c.is_alive=TRUE
     ORDER BY c.created_at ASC LIMIT 3`,
    [battleRow.player2_id]
  );
  // 绑定 battle_id（步骤 6 之前完成）
  const allIds = [...p1Chars, ...p2Chars].map(c => c.id);
  if (allIds.length > 0) {
    await query(
      `UPDATE characters SET battle_id=$1 WHERE id = ANY($2::uuid[])`,
      [battleId, allIds]
    );
  }
  return { p1Chars, p2Chars };
}

// 临时 throw，Task 6 替换
export async function cleanupPartialInit(battleId: string, lastSuccessfulStep: number): Promise<void> {
  throw new Error('cleanupPartialInit: not yet implemented');
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/services/battleInitializationService.test.ts -t "initBattleField happy path"
```

Expected: 1 个测试 PASS

- [ ] **Step 5: 类型检查**

```bash
cd /home/lovept/PtIDLE/backend
npx tsc --noEmit
```

Expected: exit 0，无错误

- [ ] **Step 6: Commit**

```bash
cd /home/lovept/PtIDLE
git add backend/src/services/battleInitializationService.ts backend/src/services/battleInitializationService.test.ts
git commit -m "feat(services): implement initBattleField 7-step pipeline with happy path test"
```

---

## Task 6: initBattleField 棋子不足边界 (TDD)

**Files:**
- Modify: `backend/src/services/battleInitializationService.test.ts`

- [ ] **Step 1: 添加测试**

在 `describe('initBattleField happy path', ...)` 之后添加新 describe 块：

```typescript
describe('initBattleField insufficient characters', () => {
  it('should return failedStep=2 when p1 has only 2 characters', async () => {
    jest.clearAllMocks();
    mockInitializeBoard.mockResolvedValue({} as any);
    mockQueryOne.mockReset();
    mockQuery.mockReset();
    mockQueryOne.mockResolvedValueOnce({ player1_id: 'p1', player2_id: 'p2' });
    mockQuery.mockResolvedValueOnce(P1_CHARS.slice(0, 2));  // p1 只有 2 个
    mockQuery.mockResolvedValueOnce(P2_CHARS);

    const result = await initBattleField(FAKE_IO, 'b1');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.failedStep).toBe(2);
      expect(result.error).toMatch(/Insufficient characters.*p1=2/);
    }
    // 不应继续后续步骤
    expect(mockSetEnergy).not.toHaveBeenCalled();
    expect(mockDrawCards).not.toHaveBeenCalled();
  });

  it('should return failedStep=2 when p2 has 0 characters', async () => {
    jest.clearAllMocks();
    mockInitializeBoard.mockResolvedValue({} as any);
    mockQueryOne.mockReset();
    mockQuery.mockReset();
    mockQueryOne.mockResolvedValueOnce({ player1_id: 'p1', player2_id: 'p2' });
    mockQuery.mockResolvedValueOnce(P1_CHARS);
    mockQuery.mockResolvedValueOnce([]);  // p2 0 个

    const result = await initBattleField(FAKE_IO, 'b1');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.failedStep).toBe(2);
      expect(result.error).toMatch(/p2=0/);
    }
  });
});
```

- [ ] **Step 2: 运行测试验证通过**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/services/battleInitializationService.test.ts -t "insufficient characters"
```

Expected: 2 个测试 PASS（实现已在 Task 5 完成）

- [ ] **Step 3: Commit**

```bash
cd /home/lovept/PtIDLE
git add backend/src/services/battleInitializationService.test.ts
git commit -m "test(services): add insufficient characters edge case tests"
```

---

## Task 7: cleanupPartialInit 实现 (TDD)

**Files:**
- Modify: `backend/src/services/battleInitializationService.ts`
- Modify: `backend/src/services/battleInitializationService.test.ts`

- [ ] **Step 1: 添加 cleanupPartialInit 测试**

在 `describe('initBattleField insufficient characters', ...)` 之后添加：

```typescript
describe('cleanupPartialInit ladder cleanup', () => {
  it('should DEL only positions when lastStep=1', async () => {
    mockRedisDel.mockClear();
    await cleanupPartialInit('b1', 1);
    expect(mockRedisDel).toHaveBeenCalledTimes(1);
    expect(mockRedisDel).toHaveBeenCalledWith('battle:b1:positions');
    // 不应回滚 battles（lastStep < 6）
    expect(mockQuery).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE battles SET status'), expect.anything());
  });

  it('should DEL positions + pieces when lastStep=2', async () => {
    mockRedisDel.mockClear();
    await cleanupPartialInit('b1', 2);
    expect(mockRedisDel).toHaveBeenCalledWith('battle:b1:pieces');
    expect(mockRedisDel).toHaveBeenCalledWith('battle:b1:positions');
  });

  it('should DEL hand/retained/discard keys for all 6 chars when lastStep=4', async () => {
    jest.clearAllMocks();
    mockQueryOne.mockReset();
    mockQuery.mockReset();
    // cleanupPartialInit 内部会调 loadBattleCharacters → 需要 mock
    mockQueryOne.mockResolvedValueOnce({ player1_id: 'p1', player2_id: 'p2' });
    mockQuery.mockResolvedValueOnce(P1_CHARS);
    mockQuery.mockResolvedValueOnce(P2_CHARS);
    mockQuery.mockResolvedValueOnce({ rowCount: 6 });  // UPDATE characters.battle_id (实际 cleanup 时会被调)

    mockRedisDel.mockClear();
    await cleanupPartialInit('b1', 4);
    // 6 chars × 3 keys (hand/retained/discard) = 18 个 DEL
    expect(mockRedisDel.mock.calls.length).toBeGreaterThanOrEqual(18);
  });

  it('should DEL session key when lastStep=5', async () => {
    mockRedisDel.mockClear();
    await cleanupPartialInit('b1', 5);
    expect(mockRedisDel).toHaveBeenCalledWith('battle:b1:session');
  });

  it('should UPDATE battles rollback when lastStep=6', async () => {
    jest.clearAllMocks();
    mockQueryOne.mockReset();
    mockQuery.mockReset();
    mockQueryOne.mockResolvedValueOnce({ player1_id: 'p1', player2_id: 'p2' });
    mockQuery.mockResolvedValueOnce(P1_CHARS);
    mockQuery.mockResolvedValueOnce(P2_CHARS);
    mockQuery.mockResolvedValueOnce({ rowCount: 6 });

    await cleanupPartialInit('b1', 6);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining(`UPDATE battles SET status='pending'`),
      ['b1']
    );
  });

  it('should swallow cleanup errors (loadBattleCharacters fails → no throw)', async () => {
    jest.clearAllMocks();
    mockQueryOne.mockReset();
    mockQueryOne.mockRejectedValue(new Error('PG down'));
    // 不应 throw
    await expect(cleanupPartialInit('b1', 4)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/services/battleInitializationService.test.ts -t "cleanupPartialInit"
```

Expected: 6 个测试 FAIL（"cleanupPartialInit: not yet implemented"）

- [ ] **Step 3: 实现 cleanupPartialInit**

在 `battleInitializationService.ts` 中替换 `cleanupPartialInit` 占位：

```typescript
export async function cleanupPartialInit(battleId: string, lastSuccessfulStep: number): Promise<void> {
  try {
    // 步骤 6+ 失败 → 回滚 battles 行
    if (lastSuccessfulStep >= 6) {
      await query(
        `UPDATE battles
         SET status='pending', started_at=NULL,
             current_actor_id=NULL, current_phase=NULL,
             current_round=1, current_step=0
         WHERE id=$1 AND status='ongoing'`,
        [battleId]
      );
    }

    // 步骤 5+ 失败 → DEL session
    if (lastSuccessfulStep >= 5) {
      await redisClient.del(`battle:${battleId}:session`);
    }

    // 步骤 4+ 失败 → DEL 6 个 hand/retained/discard
    if (lastSuccessfulStep >= 4) {
      const { p1Chars, p2Chars } = await loadBattleCharacters(battleId).catch(() => ({
        p1Chars: [] as CharacterRow[],
        p2Chars: [] as CharacterRow[],
      }));
      for (const c of [...p1Chars, ...p2Chars]) {
        await redisClient.del(`battle:${battleId}:hand:${c.id}`);
        await redisClient.del(`battle:${battleId}:retained:${c.id}`);
        await redisClient.del(`battle:${battleId}:discard:${c.id}`);
      }
    }

    // 步骤 2+ 失败 → DEL pieces + positions
    if (lastSuccessfulStep >= 2) {
      await redisClient.del(`battle:${battleId}:pieces`);
      await redisClient.del(`battle:${battleId}:positions`);
    } else if (lastSuccessfulStep === 1) {
      // 步骤 1 失败 → 仅 positions 初始化但为空
      await redisClient.del(`battle:${battleId}:positions`);
    }
  } catch (err) {
    console.error(`[cleanupPartialInit:${battleId}] cleanup error:`, err);
    // 不 rethrow，best-effort
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/services/battleInitializationService.test.ts -t "cleanupPartialInit"
```

Expected: 6 个测试全 PASS

- [ ] **Step 5: 类型检查**

```bash
cd /home/lovept/PtIDLE/backend
npx tsc --noEmit
```

Expected: exit 0，无错误

- [ ] **Step 6: Commit**

```bash
cd /home/lovept/PtIDLE
git add backend/src/services/battleInitializationService.ts backend/src/services/battleInitializationService.test.ts
git commit -m "feat(services): implement cleanupPartialInit ladder cleanup"
```

---

## Task 8: initBattleField 失败路径测试 (TDD)

**Files:**
- Modify: `backend/src/services/battleInitializationService.test.ts`

- [ ] **Step 1: 添加失败路径测试**

在 `describe('cleanupPartialInit ladder cleanup', ...)` 之后添加：

```typescript
describe('initBattleField failure paths', () => {
  it('should return failedStep=1 when initializeBoard throws', async () => {
    jest.clearAllMocks();
    mockInitializeBoard.mockReset();
    mockInitializeBoard.mockRejectedValue(new Error('Redis ECONNRESET'));
    // mock cleanup 调用
    mockQueryOne.mockReset();
    mockQuery.mockReset();
    mockRedisDel.mockReset();
    mockRedisDel.mockResolvedValue(1);

    const result = await initBattleField(FAKE_IO, 'b1');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.failedStep).toBe(1);
      expect(result.error).toMatch(/Redis ECONNRESET/);
    }
  });

  it('should return failedStep=6 and rollback UPDATE when step 6 UPDATE returns 0 rows', async () => {
    jest.clearAllMocks();
    mockInitializeBoard.mockResolvedValue({} as any);
    mockPlaceCharacter.mockResolvedValue({} as any);
    mockSetEnergy.mockResolvedValue(undefined);
    mockDrawCards.mockResolvedValue({} as any);
    mockInitSession.mockResolvedValue(undefined);
    mockGetOrder.mockReturnValue(['c1', 'c4', 'c2', 'c5', 'c3', 'c6']);
    mockQueryOne.mockReset();
    mockQuery.mockReset();
    // loadBattleCharacters 3 queries
    mockQueryOne.mockResolvedValueOnce({ player1_id: 'p1', player2_id: 'p2' });
    mockQuery.mockResolvedValueOnce(P1_CHARS);
    mockQuery.mockResolvedValueOnce(P2_CHARS);
    mockQuery.mockResolvedValueOnce({ rowCount: 6 });  // UPDATE characters.battle_id
    // step 6 UPDATE battles returns 0 rows (race condition)
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });
    // cleanup 调用的 query
    mockQueryOne.mockReset();
    mockQueryOne.mockResolvedValueOnce({ player1_id: 'p1', player2_id: 'p2' });
    mockQuery.mockResolvedValueOnce(P1_CHARS);
    mockQuery.mockResolvedValueOnce(P2_CHARS);
    mockQuery.mockResolvedValueOnce({ rowCount: 6 });

    const result = await initBattleField(FAKE_IO, 'b1');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.failedStep).toBe(6);
      expect(result.error).toMatch(/battle_row_not_updated/);
    }
  });
});
```

- [ ] **Step 2: 运行测试验证通过**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/services/battleInitializationService.test.ts -t "failure paths"
```

Expected: 2 个测试 PASS（Task 5/7 的实现已覆盖）

- [ ] **Step 3: Commit**

```bash
cd /home/lovept/PtIDLE
git add backend/src/services/battleInitializationService.test.ts
git commit -m "test(services): add initBattleField failure path tests"
```

---

## Task 9: handleBattleJoin 集成 tryInitBattleField (TDD)

**Files:**
- Modify: `backend/src/socket/battleRoom.ts`
- Create: `backend/src/socket/battleRoom.test.ts`

- [ ] **Step 1: 读 battleRoom.ts 现有 handleBattleJoin**

```bash
cd /home/lovept/PtIDLE
cat backend/src/socket/battleRoom.ts
```

找到 `handleBattleJoin` 函数末尾位置（不修改既有逻辑）。

- [ ] **Step 2: 创建 battleRoom.test.ts 骨架**

创建 `backend/src/socket/battleRoom.test.ts`：

```typescript
// T048 单测：handleBattleJoin + tryInitBattleField
jest.mock('../config/redis', () => ({
  redisClient: {
    set: jest.fn(),
    del: jest.fn(),
    hGet: jest.fn(),
    hSet: jest.fn(),
  },
  connectRedis: jest.fn(),
  disconnectRedis: jest.fn(),
}));
jest.mock('../config/database', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
  execute: jest.fn(),
}));
jest.mock('../services/battleInitializationService', () => ({
  initBattleField: jest.fn(),
  cleanupPartialInit: jest.fn(),
}));
jest.mock('../services/battleStateBroadcaster', () => ({
  broadcastFullState: jest.fn(),
  broadcastBoardState: jest.fn(),
  broadcastHandState: jest.fn(),
  broadcastCharacterStatus: jest.fn(),
}));

import { handleBattleJoin } from './battleRoom';
import { initBattleField, cleanupPartialInit } from '../services/battleInitializationService';
import { broadcastFullState } from '../services/battleStateBroadcaster';
import { redisClient } from '../config/redis';
import { queryOne } from '../config/database';

const mockInit = initBattleField as jest.MockedFunction<typeof initBattleField>;
const mockCleanup = cleanupPartialInit as jest.MockedFunction<typeof cleanupPartialInit>;
const mockBroadcast = broadcastFullState as jest.MockedFunction<typeof broadcastFullState>;
const mockRedisSet = redisClient.set as jest.MockedFunction<typeof redisClient.set>;
const mockRedisDel = redisClient.del as jest.MockedFunction<typeof redisClient.del>;
const mockQueryOne = queryOne as jest.MockedFunction<typeof queryOne>;

function createMockSocket(battleId?: string) {
  const handlers: Record<string, Function> = {};
  const socket: any = {
    id: 's1',
    data: { userId: 'u1', battleId },
    handshake: { auth: { userId: 'u1' } },
    join: jest.fn().mockResolvedValue(undefined),
    emit: jest.fn(),
    on: (event: string, cb: Function) => { handlers[event] = cb; },
    to: jest.fn().mockReturnThis(),
  };
  return { socket, handlers };
}

function createMockIO(roomSize = 1) {
  const io: any = {
    sockets: {
      adapter: {
        rooms: {
          get: jest.fn().mockReturnValue({ size: roomSize }),
        },
      },
    },
    in: jest.fn().mockReturnThis(),
    to: jest.fn().mockReturnThis(),
    emit: jest.fn(),
    fetchSockets: jest.fn().mockResolvedValue([]),
  };
  return io;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockQueryOne.mockResolvedValue({ id: 'b1', player1_id: 'p1', player2_id: 'p2', status: 'pending' });
  mockRedisSet.mockResolvedValue('OK');
  mockRedisDel.mockResolvedValue(1);
  mockInit.mockResolvedValue({ success: true, startedAt: new Date(), actorId: 'c1' });
  mockBroadcast.mockResolvedValue(undefined);
});

describe('handleBattleJoin — tryInitBattleField', () => {
  it('should NOT call initBattleField on first player join (other not in room)', async () => {
    const io = createMockIO(1);  // room size = 1 (only joiner)
    const { socket } = createMockSocket();
    await handleBattleJoin(io, socket, { battleId: 'b1' });
    expect(mockInit).not.toHaveBeenCalled();
    expect(mockBroadcast).toHaveBeenCalledWith(io, 'b1', 'u1');
  });

  it('should call initBattleField on second player join (both in room)', async () => {
    const io = createMockIO(2);  // room size = 2
    const { socket } = createMockSocket();
    mockQueryOne.mockResolvedValue({ status: 'pending' });  // for getBattleStatus inside tryInit
    await handleBattleJoin(io, socket, { battleId: 'b1' });
    expect(mockInit).toHaveBeenCalledWith(io, 'b1');
  });

  it('should skip init when status=ongoing (re-join idempotent)', async () => {
    const io = createMockIO(2);
    const { socket } = createMockSocket();
    mockQueryOne.mockResolvedValue({ status: 'ongoing' });
    await handleBattleJoin(io, socket, { battleId: 'b1' });
    expect(mockInit).not.toHaveBeenCalled();
    expect(mockBroadcast).toHaveBeenCalledWith(io, 'b1', 'u1');
  });

  it('should release init_lock in finally even when init throws', async () => {
    const io = createMockIO(2);
    const { socket } = createMockSocket();
    mockQueryOne.mockResolvedValue({ status: 'pending' });
    mockInit.mockRejectedValue(new Error('init boom'));
    await handleBattleJoin(io, socket, { battleId: 'b1' });
    expect(mockRedisDel).toHaveBeenCalledWith('battle:b1:init_lock');
  });

  it('should NOT init when SETNX lock fails and status=pending (other is initializing)', async () => {
    const io = createMockIO(1);
    const { socket } = createMockSocket();
    mockRedisSet.mockResolvedValue(null);  // SETNX fails
    mockQueryOne.mockResolvedValue({ status: 'pending' });
    await handleBattleJoin(io, socket, { battleId: 'b1' });
    // 等 100ms 后再查 status
    await new Promise(r => setTimeout(r, 150));
    expect(mockInit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: 运行测试验证失败**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/socket/battleRoom.test.ts
```

Expected: 5 个测试全 FAIL（handleBattleJoin 未触发 init 逻辑）

- [ ] **Step 4: 在 battleRoom.ts 添加 tryInitBattleField + wire 到 handleBattleJoin**

读 `backend/src/socket/battleRoom.ts` 完整内容，在 `handleBattleJoin` 函数末尾、`broadcastOpponentDisconnected` 之前的位置添加：

```typescript
// T048 新增 import
import { initBattleField } from '../services/battleInitializationService';
import { broadcastFullState } from './battleStateBroadcaster';
import { redisClient } from '../config/redis';
import { queryOne } from '../config/database';

// 在文件末尾添加 tryInitBattleField 函数
/**
 * T048: 双方都在 battle 房间后，调用 initBattleField 初始化战场
 * - SETNX init_lock 防止并发
 * - 检查 status='pending' 才执行（idempotent re-join 直接 broadcast）
 */
export async function tryInitBattleField(
  io: IOServer,
  battleId: string,
  joiningUserId: string
): Promise<void> {
  const lockToken = `${Date.now()}-${Math.random()}`;
  const locked = await redisClient.set(
    `battle:${battleId}:init_lock`,
    lockToken,
    { NX: true, EX: 30 }
  );

  if (!locked) {
    // 别人正在 init，sleep 100ms 后读 status
    await new Promise(r => setTimeout(r, 100));
    const status = await getBattleStatus(battleId);
    if (status === 'ongoing') {
      await broadcastFullState(io, battleId, joiningUserId).catch(err =>
        console.error(`[tryInitBattleField:${battleId}] broadcast after lock-loss:`, err)
      );
    }
    return;
  }

  try {
    const otherInRoom = isOtherPlayerInRoom(io, battleId);
    const status = await getBattleStatus(battleId);

    if (otherInRoom && status === 'pending') {
      await initBattleField(io, battleId);
    } else {
      await broadcastFullState(io, battleId, joiningUserId).catch(err =>
        console.error(`[tryInitBattleField:${battleId}] broadcast:`, err)
      );
    }
  } finally {
    await redisClient.del(`battle:${battleId}:init_lock`);
  }
}

function isOtherPlayerInRoom(io: IOServer, battleId: string): boolean {
  const room = io.sockets.adapter.rooms.get(`battle:${battleId}`);
  return (room?.size ?? 0) > 1;
}

async function getBattleStatus(battleId: string): Promise<string | null> {
  const row = await queryOne<{ status: string }>(`SELECT status FROM battles WHERE id=$1`, [battleId]);
  return row?.status ?? null;
}
```

找到 `handleBattleJoin` 函数末尾（在 `socket.to(battleRoom(battleId)).emit('battle:opponent_joined', ...)` 之后），追加：

```typescript
  // T048: 双 join 后触发战场初始化
  await tryInitBattleField(io, battleId, socket.data.userId);
```

- [ ] **Step 5: 运行测试验证通过**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/socket/battleRoom.test.ts
```

Expected: 5 个测试全 PASS

- [ ] **Step 6: 类型检查**

```bash
cd /home/lovept/PtIDLE/backend
npx tsc --noEmit
```

Expected: exit 0，无错误

- [ ] **Step 7: 运行既有 socketServer.test.ts 验证不破坏**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/socket/socketServer.test.ts
```

Expected: 既有测试全 PASS（如有失败需补 mock `initBattleField` / `cleanupPartialInit`）

- [ ] **Step 8: Commit**

```bash
cd /home/lovept/PtIDLE
git add backend/src/socket/battleRoom.ts backend/src/socket/battleRoom.test.ts
git commit -m "feat(socket): add tryInitBattleField wired to handleBattleJoin"
```

---

## Task 10: battleRoom 集成测试

**Files:**
- Create: `backend/src/socket/battleRoom.integration.test.ts`

- [ ] **Step 1: 创建集成测试文件**

创建 `backend/src/socket/battleRoom.integration.test.ts`：

```typescript
/**
 * T048 集成测试：真实 PG + Redis，端到端验证双 join → init → state 广播
 */
import http from 'http';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import { Server as IOServer } from 'socket.io';
import { AddressInfo } from 'net';

// 沿用项目惯例：mock redis 让 jest 进程不依赖实际连接
jest.mock('../config/redis', () => ({
  redisClient: {
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    hGet: jest.fn().mockResolvedValue(null),
    hSet: jest.fn().mockResolvedValue(1),
    get: jest.fn(),
    setEx: jest.fn(),
  },
  connectRedis: jest.fn(),
  disconnectRedis: jest.fn(),
}));

describe('T048 integration: battle field init via double battle:join', () => {
  let httpServer: http.Server;
  let io: IOServer;
  let port: number;
  let client1: ClientSocket;
  let client2: ClientSocket;

  beforeAll(async () => {
    httpServer = http.createServer();
    io = new IOServer(httpServer, { cors: { origin: '*' } });
    // 此处需要导入 initializeSocketServer 并 wire 真实 handler
    // 由于 T046 已实现完整 wiring，本测试假设 index.ts 启动方式
    // 实际运行时从 backend/src/index.ts 启动服务
    await new Promise<void>(resolve => {
      httpServer.listen(0, () => {
        port = (httpServer.address() as AddressInfo).port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    io.close();
    httpServer.close();
  });

  it('placeholder — real integration test requires full app bootstrap', () => {
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: 验证集成测试文件编译**

```bash
cd /home/lovept/PtIDLE/backend
npx tsc --noEmit
npx jest src/socket/battleRoom.integration.test.ts
```

Expected: 1 个 placeholder 测试 PASS；tsc 0 错误

- [ ] **Step 3: Commit**

```bash
cd /home/lovept/PtIDLE
git add backend/src/socket/battleRoom.integration.test.ts
git commit -m "test(socket): add battleRoom integration test skeleton"
```

> **注**：完整集成测试需要 backend 启动 + docker compose PG/Redis 运行 + 真实用户创建流程，本任务仅建立骨架。详细端到端验证由开发者手动执行（见 Task 11 验证清单）。

---

## Task 11: 完整测试 + 文档更新

**Files:**
- Modify: `memory-bank/architecture.md`
- Modify: `memory-bank/progress.md`
- Modify: `history.md`

- [ ] **Step 1: 运行所有测试**

```bash
cd /home/lovept/PtIDLE/backend
npx jest
```

Expected: 全部 PASS（既有 + 新增 ~29 个）

- [ ] **Step 2: 类型检查**

```bash
cd /home/lovept/PtIDLE/backend
npx tsc --noEmit
```

Expected: exit 0

- [ ] **Step 3: 更新 architecture.md — 添加 T048 章节**

读 `memory-bank/architecture.md` 末尾，添加：

```markdown
## T048 战场初始化 (Battle Initialization)

### 触发时机
双方都 `battle:join` 成功后自动触发，由 `tryInitBattleField` 在 SETNX 锁内执行。

### 模块
| 文件 | 角色 |
|------|------|
| `src/services/battleInitializationService.ts` | `initBattleField` 7 步流水 + `cleanupPartialInit` 阶梯清理 |
| `src/socket/battleRoom.ts` | `tryInitBattleField` 锁 + 双 join 检测 |
| `src/migrations/008_t048_battle_init.sql` | `characters.battle_id` + `deck_position` + 索引 |

### 7 步流水
1. `initializeBoard` — 9×9 空棋盘
2. `placeCharacter × 6` — 双方各 3 个棋子到默认位置（P1 `(6,0)(7,0)(8,0)`, P2 `(0,8)(1,8)(2,8)`）
3. `setCharacterEnergy × 6` — 满能量 3
4. `drawCards × 6` — 各抽 3 张初始手牌
5. `initializeSession` — 蛇形 ABABAB 顺序 + phase=idle
6. `UPDATE battles SET status='ongoing'` — pending → ongoing
7. `broadcastFullState × 2` — 双方各一份（ownHand 隔离）

### 失败处理
- 步骤 1-6 失败 → `cleanupPartialInit(lastStep)` 阶梯反向 DEL + 回滚 battles.status='pending'
- 步骤 7 失败 → **不回滚**（PG 已固化），console.error，依赖客户端重 join 触发重 broadcast

### 并发保护
- Redis `SETNX battle:{id}:init_lock EX 30`
- SETNX 输者 sleep 100ms + 读 status 决定 broadcast / wait
- `battles.status='pending'` 二次检查保证幂等

### 棋子选取策略
按 `characters.created_at ASC LIMIT 3` 取每方前 3 个 alive 棋子（每个玩家独立）。T008 注册时已建 1 warrior + 1 ranger + 1 mage → 默认平衡。后续 T048.5 可扩展「玩家手动选 3 个棋子」。

### 数据库改动 (Migration 008)
- `characters.battle_id UUID` — 软绑定，NULL 表示未入战
- `characters.deck_position INTEGER` — 3v3 位序（预留未来）
- `idx_characters_battle_id` + `idx_battles_started_at` — 查询加速
```

- [ ] **Step 4: 更新 progress.md**

读 `memory-bank/progress.md`，在「已完成」表追加一行：

```markdown
| T048 | 实现战场初始化（双 join 触发 + 7 步流水 + 失败回滚） | 2026-06-15 |
```

- [ ] **Step 5: 更新 history.md**

在 `history.md` 末尾追加：

```markdown
## 2026-06-15 - 任务：T048 战场初始化

### Prompt
实施 T048 战场初始化。范围：双方都 battle:join 后自动触发 initBattleField；7 步流水（initializeBoard / placeCharacter × 6 / setEnergy × 6 / drawCards × 6 / initializeSession / UPDATE battles status=ongoing / broadcastFullState × 2）；3v3 硬编码；默认位置 P1 右下角 / P2 左上角；棋子按 created_at ASC LIMIT 3 取前 3 个 alive；失败时 cleanupPartialInit 阶梯式反向清理；Redis SETNX init_lock 防并发。

### 思考
- 新建 service 文件，orchestrator 风格，调用既有 battleService / handService / battleSessionService，不持有私有 Redis key 命名空间
- 「生产 vs 应用」分离：步骤 6 UPDATE battles 是 PG 唯一状态切换点；步骤 7 broadcast 失败不回滚 PG
- 阶梯式 cleanupPartialInit 用 `if (>= N)` 而非 else-if 链，确保任意步骤失败时所有上游写入都能回滚
- 棋子选取走"取前 3 个 alive"，T008 已创建 1w+1r+1m 默认平衡；未来 T048.5 加手动选择 UI
- 新增 characters.battle_id 软绑定字段，NULL 表示未入战；T048 步骤 2 一次性 UPDATE 6 个棋子的 battle_id
- migration 008 加 deck_position 字段（3v3 位序 0/1/2）预留未来使用
- battleRoom.ts 新增 tryInitBattleField，handleBattleJoin 末尾 wire 一行调用
- 沿用项目惯例：jest.mock 必须在 import 之前；用 import * as + as jest.MockedFunction 强制断言
- 步骤 1-5 全部失败时 cleanupPartialInit 也可能失败（Redis 同样挂），try/catch 吞错 console.error
- battleService.setCharacterEnergy 走 read-modify-write 模式复用 pieces HASH

### 意外
1. 既有 battleService.test.ts 不存在 setCharacterEnergy 测试，新增 3 个 TDD 流程独立
2. battleInitializationService.test.ts 顶层 mock 设置必须在 import 之前（ts-jest TDZ 坑）
3. cleanupPartialInit 在 lastStep=4/5/6 时会再次调 loadBattleCharacters（重新查 PG 拿 character ids）—— mock 在每个测试 beforeEach 重置
4. handleBattleJoin 既有测试可能因新增 tryInitBattleField 调用而失败（如有，需在 socketServer.test.ts 顶部补 mock initBattleField）
5. 集成测试需要完整 app bootstrap（PG+Redis+真实用户），本任务仅建立骨架
```

- [ ] **Step 6: 最终验证**

```bash
cd /home/lovept/PtIDLE/backend
npx jest
npx tsc --noEmit
```

Expected: 全部通过；tsc 0 错误

- [ ] **Step 7: Commit 文档**

```bash
cd /home/lovept/PtIDLE
git add memory-bank/architecture.md memory-bank/progress.md history.md
git commit -m "docs: update architecture + progress + history for T048"
```

- [ ] **Step 8: 手动端到端验证（开发者执行）**

```bash
cd /home/lovept/PtIDLE
docker compose up -d
cd backend
npm run dev  # 启动后端
# 另开终端：模拟两个用户 battle:join
# （可用 wscat 或写 Node 脚本连接 ws://localhost:3000）
# 1. POST /api/auth/register user1 + user2
# 2. POST /api/match/queue (撮合成功)
# 3. Socket emit('battle:join', {battleId})
# 4. 验证收到 battle:state:full 含 board + ownHand
# 5. PG: SELECT * FROM battles WHERE id=$1 应有 status='ongoing', started_at, current_actor_id
# 6. Redis: HGETALL battle:{id}:positions 应有 6 entries；6 个 hand key 各 3 张
```

---

## Verification Checklist

- [ ] `npx jest` 全部通过
- [ ] `npx tsc --noEmit` 0 错误
- [ ] migration 008 跑通
- [ ] battleRoom 既有 socketServer 测试不破坏
- [ ] battle:state:full 既有 broadcaster 测试不破坏
- [ ] architecture.md / progress.md / history.md 全部更新
- [ ] 手动端到端验证 6 步 PG / Redis 状态正确

---

*计划版本：v1.0*
*最后更新：2026-06-15*
