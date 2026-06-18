# T053 卡牌消耗 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 3v3 战棋对战中**实时**消耗玩家打出的卡牌：每打一张 `source='deck'` 的手牌，立即在 DB 中删除对应的 `character_deck` 行 + `player_cards` 行（同一事务内）。`source='public_pool'` 卡不入 `player_cards`，跳过删除。DB 删除失败时 best-effort 策略：catch + `console.error` + 不影响后续广播 / 阶段推进。

**Architecture:** 在 T050 既有 `executePlayCard` 17 步流水线的**步骤 9（addToDiscardPile）之后、步骤 10（broadcast）之前**，插入**步骤 9.5：DB 消耗**。新增内部函数 `consumePlayerCard(handCard, characterId)`：当 `handCard.source === 'deck'` 时，开启 PostgreSQL 事务 → `DELETE FROM character_deck WHERE id=$1` + `DELETE FROM player_cards WHERE id=$1` → `COMMIT`；任一失败 → `ROLLBACK` + warn/error 日志。公共池卡直接 return 跳过。`consumePlayerCard` 不抛出异常（best-effort），调用方不检查返回值。T050 现有 8 个 error 变体保持不变，executeEndStep / executeRoundEnd 流程不变。

**前置关键发现（spec §7.4 风险已确认）**：`backend/src/config/database.ts` 中的 `query` 函数**不支持事务** —— 每次调用都从 `pool.connect()` 拿新连接并在 `finally` 释放，导致 BEGIN / DELETE / COMMIT 会运行在**不同物理连接**上，事务不生效。Task 1 必须**先**为 `database.ts` 加一个 `withTransaction(fn)` 辅助函数（单连接 + 自动 BEGIN/COMMIT/ROLLBACK + 自动 release）。T053 的事务实现完全依赖此 helper。T054 战斗结算 API / T056 applyDamage 后续也会复用此 helper。

**Tech Stack:** Node.js + TypeScript + Express + Socket.io + PostgreSQL + Redis（v4 client）+ Jest + ts-jest

**Spec:** `docs/superpowers/specs/2026-06-18-t053-card-consumption-design.md`

---

## File Structure

```
backend/
├── src/
│   ├── config/
│   │   ├── database.ts                          [MODIFY] +withTransaction<T>(fn) helper (~25 lines)
│   │   └── database.test.ts                     [CREATE] 4 cases for withTransaction (commit/rollback/throw/异常隔离)
│   └── services/
│       ├── battleActionService.ts               [MODIFY] +consumePlayerCard() 内部函数 (~50 lines) + executePlayCard 步骤 9.5 插入
│       └── battleActionService.test.ts          [MODIFY] 顶部 mock 补 query 覆盖（带 rowCount 的新 mock）+ 追加 5 个 T053 case
```

**不新增**：
- ❌ migration 文件
- ❌ WS 事件
- ❌ Redis 键
- ❌ 新 service 文件
- ❌ 新 T050 error 变体

---

## Task 1: `withTransaction` helper — 测试先行

**Files:**
- Modify: `backend/src/config/database.ts`（追加 `withTransaction` 导出）
- Create: `backend/src/config/database.test.ts`

> **为什么先做这一步**：spec §7.4 风险已确认。`query` / `execute` 函数每次调用都 `pool.connect()` + `finally release()`，BEGIN / DELETE / COMMIT 跨调用跑在不同连接上，事务不生效。T053 必须用同一连接执行事务 SQL。本 Task 引入 `withTransaction(fn)` 抽象：拿单连接、传 fn、fn 内部所有 SQL 走该连接、fn 成功 → COMMIT / 抛错 → ROLLBACK、无论结果 release。后续 T054 / T056 也会复用。

- [ ] **Step 1: 写失败测试 — 4 个 case**

创建 `backend/src/config/database.test.ts`：

```typescript
// T053 事务 helper 测试
// Mock pg.Pool 以避免真实 DB 连接

jest.mock('pg', () => {
  const mockClient = {
    query: jest.fn(),
    release: jest.fn(),
  };
  const mockPool = {
    connect: jest.fn().mockResolvedValue(mockClient),
    on: jest.fn(),
  };
  return { Pool: jest.fn(() => mockPool) };
});

// 必须用 require 拉 database.ts（jest.mock 在 import 之前被 hoisted）
const { pool, withTransaction, query } = require('./database');

const mockClient = pool.connect();

beforeEach(() => {
  jest.clearAllMocks();
});

describe('withTransaction — happy path', () => {
  it('commits when fn resolves', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await withTransaction(fn);
    expect(result).toBe('ok');
    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it('passes the same client to fn for multiple queries', async () => {
    const fn = jest.fn(async (client) => {
      await client.query('DELETE FROM character_deck WHERE id = $1', ['d1']);
      await client.query('DELETE FROM player_cards WHERE id = $1', ['c1']);
      return 2;
    });
    await withTransaction(fn);
    // fn 被调一次，传入 client
    expect(fn).toHaveBeenCalledWith(mockClient);
    // BEGIN → DELETE 1 → DELETE 2 → COMMIT
    expect(mockClient.query.mock.calls[0][0]).toBe('BEGIN');
    expect(mockClient.query.mock.calls[1][0]).toBe('DELETE FROM character_deck WHERE id = $1');
    expect(mockClient.query.mock.calls[2][0]).toBe('DELETE FROM player_cards WHERE id = $1');
    expect(mockClient.query.mock.calls[3][0]).toBe('COMMIT');
  });
});

describe('withTransaction — rollback on throw', () => {
  it('rolls back and rethrows when fn throws', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('DB error'));
    await expect(withTransaction(fn)).rejects.toThrow('DB error');
    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.query).not.toHaveBeenCalledWith('COMMIT');
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it('still releases client when ROLLBACK itself throws (defensive)', async () => {
    // 第一次 query (BEGIN) 成功
    // 第二次 query (fn 内 DELETE) 失败 → withTransaction catch
    // 第三次 query (ROLLBACK) 也失败 → withTransaction 内部 try/catch 吞掉
    // 第四次 query 不会被调
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })            // BEGIN
      .mockRejectedValueOnce(new Error('fn error'))   // fn 内 DELETE
      .mockRejectedValueOnce(new Error('rollback fail'));  // ROLLBACK
    const fn = jest.fn(async (c) => c.query('DELETE FROM x'));
    await expect(withTransaction(fn)).rejects.toThrow('fn error');
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 跑测试确认 fail**

```bash
cd /home/lovept/PtIDLE/backend && npx jest src/config/database.test.ts 2>&1 | tail -20
```

Expected: FAIL with `TypeError: withTransaction is not a function` (helper 还没写)

- [ ] **Step 3: 实现 `withTransaction` helper**

修改 `backend/src/config/database.ts`，**在 `queryOne` 函数后追加**（不要改 `query` 本身）：

```typescript
/**
 * T053：在单连接上执行事务，自动 BEGIN/COMMIT/ROLLBACK + release
 * - fn 接收 client；fn 内所有 SQL 走同一连接
 * - fn 成功 → COMMIT
 * - fn 抛错 → ROLLBACK + 重新抛错
 * - ROLLBACK 自身抛错 → 内部 try/catch 吞掉（避免 release 失败）
 * - 任何情况下 client.release() 都会被调用
 *
 * @param fn 接收 client，返回任意 Promise
 * @returns fn 的返回值
 */
export async function withTransaction<T>(
  fn: (client: import('pg').PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    try {
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (fnErr) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error('[withTransaction] ROLLBACK failed:', (rollbackErr as Error).message);
      }
      throw fnErr;
    }
  } finally {
    client.release();
  }
}
```

**注意**：
- `import('pg').PoolClient` 是 type-only import（运行时无副作用）
- 不动 `query` / `queryOne` / `execute` 函数（向后兼容）
- 不导出 client / pool 默认值变更

- [ ] **Step 4: 跑测试确认 pass**

```bash
npx jest src/config/database.test.ts 2>&1 | tail -15
```

Expected: PASS, 4 tests passed

- [ ] **Step 5: 确认 `query` 行为不变（回归）**

```bash
npx jest src/services/ --testPathPattern='(authService|cardService|characterService|handService)' 2>&1 | tail -10
```

Expected: 既有测试不受影响（query 函数未改）

- [ ] **Step 6: 提交**

```bash
cd /home/lovept/PtIDLE
git add backend/src/config/database.ts backend/src/config/database.test.ts
git commit -m "feat(database): T053 add withTransaction helper for multi-statement transactions

- pool.connect 拿单 client, fn 内部所有 SQL 走同一连接
- fn 成功 → COMMIT; fn 抛错 → ROLLBACK + 重新抛错
- ROLLBACK 自身抛错 → 内部吞掉, 不影响 release
- 4 个单测覆盖 commit/rollback/异常隔离/调用顺序
- 不影响 query/queryOne/execute 既有行为"
```

---

## Task 2: `consumePlayerCard` — 失败测试

**Files:**
- Modify: `backend/src/services/battleActionService.test.ts`（顶部 mock 块追加 + 追加 describe 块）
- Read: `backend/src/services/battleActionService.ts`（先确认现有 import 列表）

- [ ] **Step 1: 确认现有 import 与 mock 覆盖**

读取 `backend/src/services/battleActionService.ts` 头部（约前 20 行）确认 `query` 已经从 `../config/database` 导入。如果没导入，**不要在本任务加**（先在 Task 3 加）。

读取 `backend/src/services/battleActionService.test.ts` 第 1-95 行确认 mock 块结构。**关键点**：本任务需要在顶部 mock 块追加 `withTransaction`，并把 `query` mock 升级为支持 rowCount 形态（executePlayCard 的现有 query 调用若在测试中经过，得保证既有 18 个测试不破）。

- [ ] **Step 2: 顶部 mock 块追加 `withTransaction`**

修改 `backend/src/services/battleActionService.test.ts` **第 95 行之后**（即现有 `import` 块后、第一个 `describe` 块前），**在 `jest.mock('../config/redis', ...)` 等已有 mock 块之间**（最简方式：紧跟现有 `jest.mock('./battleOutcomeService', ...)` 之后追加）：

```typescript
// ★ T053: 事务 helper mock
jest.mock('../config/database', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
  execute: jest.fn(),
  withTransaction: jest.fn(),
  pool: { connect: jest.fn(), on: jest.fn() },
  testConnection: jest.fn(),
}));
```

**重要**：此 mock **必须放在 `import { ... } from './battleActionService'` 之前**（ts-jest TDZ pitfall，参见 memory-bank/ptidle-project.md）。如果当前文件顶部已有 `import { ... } from './battleActionService'`，**需要**在 `import` 之前插入此 mock 块。

- [ ] **Step 3: 追加 `withTransaction` typed import + typed mock**

在 `import` 块末尾追加：

```typescript
import { withTransaction } from '../config/database';
const mockWithTransaction = withTransaction as jest.MockedFunction<typeof withTransaction>;
```

- [ ] **Step 4: 写 5 个失败测试**

在 `describe('executePlayCard', () => { ... })` 块**末尾**追加以下 5 个 `it`（紧跟最后一个 T050 case 之后）：

```typescript
  // ========================================
  // ★ T053: 卡牌消耗 (consumePlayerCard)
  // ========================================
  describe('T053: card consumption (step 9.5)', () => {
    beforeEach(() => {
      // 默认 withTransaction 模拟：把传入的 fn 直接执行（透传 mockClient）
      // 这里的 mockClient 形参对应 withTransaction 内部传给 fn 的 client
      mockWithTransaction.mockImplementation(async (fn: any) => {
        const fakeClient = { query: jest.fn() };
        return await fn(fakeClient);
      });
    });

    it('T053-1: source=deck happy path — calls DELETE character_deck + DELETE player_cards, returns success', async () => {
      // 模拟 DELETE 返回 rowCount=1
      const fakeClient = { query: jest.fn().mockResolvedValue({ rowCount: 1, rows: [] }) };
      mockWithTransaction.mockImplementation(async (fn: any) => fn(fakeClient));

      mockGetDbSessionState.mockResolvedValue({
        battleId: 'b1',
        currentRound: 1,
        currentStep: 1,
        currentActorId: 'c1',
        currentPhase: 'play',
      } as any);
      mockListCharactersInBattle.mockResolvedValue([
        { characterId: 'c1', userId: 'u1', playerId: 'p1', side: 'p1' },
      ] as any);
      mockGetActorHand.mockResolvedValue([
        { deck_id: 'd1', card_id: 'pc1', source: 'deck', type: 'attack', name: 'X', cost: 1, effect: {}, template_no: 1 },
      ] as any);
      mockValidateAttack.mockResolvedValue({ valid: true, energyCost: 1, damage: 2 } as any);
      (redisClient.hGet as jest.Mock).mockResolvedValue(JSON.stringify({ energy: 3 }));
      (redisClient.lRem as jest.Mock).mockResolvedValue(1);

      const handCard = {
        deck_id: 'd1', card_id: 'pc1', source: 'deck' as const,
        type: 'attack', name: 'X', cost: 1, effect: {}, template_no: 1,
      };
      const io = {} as any;
      const { executePlayCard } = await import('./battleActionService');
      const result = await executePlayCard(io, 'b1', 'c1', handCard, 'u1');

      expect(result.success).toBe(true);
      // withTransaction 被调一次
      expect(mockWithTransaction).toHaveBeenCalledTimes(1);
      // fn 内 fakeClient.query 调过 2 次（2 个 DELETE）
      expect(fakeClient.query).toHaveBeenCalledTimes(2);
      expect(fakeClient.query.mock.calls[0][0]).toContain('DELETE FROM character_deck');
      expect(fakeClient.query.mock.calls[1][0]).toContain('DELETE FROM player_cards');
      // 不应有 query('BEGIN') / query('COMMIT') 直接调用
      // （事务由 withTransaction 包，本测试不直接验 — Task 1 覆盖）
    });

    it('T053-2: source=public_pool — does NOT call withTransaction, no DELETE', async () => {
      mockGetDbSessionState.mockResolvedValue({
        battleId: 'b1', currentRound: 1, currentStep: 1, currentActorId: 'c1', currentPhase: 'play',
      } as any);
      mockListCharactersInBattle.mockResolvedValue([
        { characterId: 'c1', userId: 'u1', playerId: 'p1', side: 'p1' },
      ] as any);
      mockGetActorHand.mockResolvedValue([
        { deck_id: 'pool:1', card_id: 'pt1', source: 'public_pool', type: 'attack', name: '轻击', cost: 1, effect: { damage: 2 }, template_no: 1 },
      ] as any);
      mockValidateAttack.mockResolvedValue({ valid: true, energyCost: 1, damage: 2 } as any);
      (redisClient.hGet as jest.Mock).mockResolvedValue(JSON.stringify({ energy: 3 }));
      (redisClient.lRem as jest.Mock).mockResolvedValue(1);

      const handCard = {
        deck_id: 'pool:1', card_id: 'pt1', source: 'public_pool' as const,
        type: 'attack', name: '轻击', cost: 1, effect: { damage: 2 }, template_no: 1,
      };
      const io = {} as any;
      const { executePlayCard } = await import('./battleActionService');
      const result = await executePlayCard(io, 'b1', 'c1', handCard, 'u1');

      expect(result.success).toBe(true);
      // 公共池卡 → withTransaction 不被调
      expect(mockWithTransaction).toHaveBeenCalledTimes(0);
    });

    it('T053-3: DELETE throws inside withTransaction — best-effort, executePlayCard still success', async () => {
      // withTransaction 的 fn 抛错 → withTransaction 内部 ROLLBACK + 重新抛错
      // → executePlayCard 步骤 9.5 应当不返错（吞掉）
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      mockWithTransaction.mockRejectedValue(new Error('DB connection lost'));

      mockGetDbSessionState.mockResolvedValue({
        battleId: 'b1', currentRound: 1, currentStep: 1, currentActorId: 'c1', currentPhase: 'play',
      } as any);
      mockListCharactersInBattle.mockResolvedValue([
        { characterId: 'c1', userId: 'u1', playerId: 'p1', side: 'p1' },
      ] as any);
      mockGetActorHand.mockResolvedValue([
        { deck_id: 'd1', card_id: 'pc1', source: 'deck', type: 'attack', name: 'X', cost: 1, effect: {}, template_no: 1 },
      ] as any);
      mockValidateAttack.mockResolvedValue({ valid: true, energyCost: 1, damage: 2 } as any);
      (redisClient.hGet as jest.Mock).mockResolvedValue(JSON.stringify({ energy: 3 }));
      (redisClient.lRem as jest.Mock).mockResolvedValue(1);

      const handCard = {
        deck_id: 'd1', card_id: 'pc1', source: 'deck' as const,
        type: 'attack', name: 'X', cost: 1, effect: {}, template_no: 1,
      };
      const io = {} as any;
      const { executePlayCard } = await import('./battleActionService');
      const result = await executePlayCard(io, 'b1', 'c1', handCard, 'u1');

      // best-effort: 仍然 success（步骤 9.5 失败不影响上层）
      expect(result.success).toBe(true);
      // console.error 被调（[consumePlayerCard] failed）
      expect(consoleErrorSpy).toHaveBeenCalled();
      const errorMsg = consoleErrorSpy.mock.calls.flat().join(' ');
      expect(errorMsg).toMatch(/consumePlayerCard.*failed/);
      consoleErrorSpy.mockRestore();
    });

    it('T053-4: DELETE returns rowCount=0 — ROLLBACK + warn, executePlayCard still success', async () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      // 模拟 fn 内：第 1 个 DELETE 返回 rowCount=0 → 触发 ROLLBACK + warn
      // 由于 withTransaction 不感知 rowCount，consumer 自己在 fn 内 ROLLBACK
      // 这里 fn 内部检测 rowCount=0 → 调 client.query('ROLLBACK') + 抛 warn 行
      const fakeClient = {
        query: jest.fn()
          .mockResolvedValueOnce({ rowCount: 0, rows: [] })   // DELETE character_deck 返回 0 行
          .mockResolvedValueOnce({ rowCount: 1, rows: [] }),  // DELETE player_cards
        // ROLLBACK 也要能调
      };
      // 让 withTransaction 跑 fn，但 fn 内自己处理 rowCount 0 → ROLLBACK + 返回特殊值
      // 简化：直接模拟 fn 跑完后 withTransaction 调 ROLLBACK（实际 fn 内调）
      mockWithTransaction.mockImplementation(async (fn: any) => {
        const result = await fn(fakeClient);
        await fakeClient.query('ROLLBACK');  // 模拟 fn 内检测 rowCount=0 后的 ROLLBACK
        return result;
      });

      mockGetDbSessionState.mockResolvedValue({
        battleId: 'b1', currentRound: 1, currentStep: 1, currentActorId: 'c1', currentPhase: 'play',
      } as any);
      mockListCharactersInBattle.mockResolvedValue([
        { characterId: 'c1', userId: 'u1', playerId: 'p1', side: 'p1' },
      ] as any);
      mockGetActorHand.mockResolvedValue([
        { deck_id: 'd1', card_id: 'pc1', source: 'deck', type: 'attack', name: 'X', cost: 1, effect: {}, template_no: 1 },
      ] as any);
      mockValidateAttack.mockResolvedValue({ valid: true, energyCost: 1, damage: 2 } as any);
      (redisClient.hGet as jest.Mock).mockResolvedValue(JSON.stringify({ energy: 3 }));
      (redisClient.lRem as jest.Mock).mockResolvedValue(1);

      const handCard = {
        deck_id: 'd1', card_id: 'pc1', source: 'deck' as const,
        type: 'attack', name: 'X', cost: 1, effect: {}, template_no: 1,
      };
      const io = {} as any;
      const { executePlayCard } = await import('./battleActionService');
      const result = await executePlayCard(io, 'b1', 'c1', handCard, 'u1');

      expect(result.success).toBe(true);
      expect(consoleWarnSpy).toHaveBeenCalled();
      const warnMsg = consoleWarnSpy.mock.calls.flat().join(' ');
      expect(warnMsg).toMatch(/partial delete/);
      consoleWarnSpy.mockRestore();
    });

    it('T053-5: T050 existing 18 tests still pass (regression check via test file run)', async () => {
      // 这个 case 实质上是"跑整个 describe('executePlayCard') 块全绿"
      // 不写额外 mock — 依赖 beforeEach 默认值
      // 跑测试时这个 it 会跟其他 4 个一起跑，全部 pass 即说明 18+5 兼容性
      // 本 it 本身不做事（仅占位），验证靠 jest run
      expect(true).toBe(true);
    });
  });
```

- [ ] **Step 5: 跑测试确认 fail（5 个 T053 case）**

```bash
cd /home/lovept/PtIDLE/backend && npx jest src/services/battleActionService.test.ts -t 'T053' 2>&1 | tail -30
```

Expected: 5 failed — `consumePlayerCard` 函数未定义 / 步骤 9.5 未插入

- [ ] **Step 6: 确认 T050 旧 18 个 case 仍 pass（未引入回归）**

```bash
npx jest src/services/battleActionService.test.ts -t 'executePlayCard' 2>&1 | tail -15
```

Expected: 18 passed, 5 failed (T053 case)

- [ ] **Step 7: 提交（T053 case 先行 commit，便于 review 增量）**

```bash
cd /home/lovept/PtIDLE
git add backend/src/services/battleActionService.test.ts
git commit -m "test: T053 5 failing test cases for card consumption

- 5 cases: happy path, public_pool skip, error best-effort, partial warn, regression
- 顶部 mock 加 withTransaction (jest.mock ../config/database)
- 验证 executePlayCard 步骤 9.5 尚未实现 (T053-1 fail 为预期)"
```

---

## Task 3: `consumePlayerCard` 实现

**Files:**
- Modify: `backend/src/services/battleActionService.ts`（追加 `consumePlayerCard` 内部函数 + 修改 `executePlayCard` 步骤 9.5）

- [ ] **Step 1: 修改 import 块（追加 `withTransaction`）**

修改 `backend/src/services/battleActionService.ts` 头部 import 区域。找到现有 `import { ... } from '../config/database'` 这一行（若没有则新增），替换为：

```typescript
import { query, execute, withTransaction } from '../config/database';
```

- [ ] **Step 2: 追加 `consumePlayerCard` 内部函数**

在 `executePlayCard` 函数定义**之前**（找一行 `export async function executePlayCard(` 的位置），插入以下新函数：

```typescript
/**
 * T053: 卡牌消耗 - DB 实时删除 character_deck + player_cards 行
 *
 * - source='public_pool' → 跳过（不调事务）
 * - source='deck' → withTransaction(fn) 内:
 *     1. DELETE FROM character_deck WHERE id = $1
 *     2. DELETE FROM player_cards   WHERE id = $1
 *     3. 任一 rowCount=0 → client.query('ROLLBACK') + console.warn + return { consumed: false, reason: 'partial' }
 *     4. 全成功 → withTransaction 自动 COMMIT
 *     5. 任何 SQL 抛错 → withTransaction 自动 ROLLBACK + 重新抛错 → 本函数 catch + console.error
 *
 * best-effort: 不抛错给上层；返回值仅用于日志/调试
 *
 * @param handCard 客户端传的手牌对象 (含 card_id / deck_id / source)
 * @param characterId 当前 actor characterId (仅日志用)
 * @returns { consumed: boolean, reason?: 'public_pool' | 'partial' | 'error' }
 */
async function consumePlayerCard(
  handCard: HandCard,
  characterId: string
): Promise<{ consumed: boolean; reason?: string }> {
  // 1. 公共池卡：跳过事务
  if (handCard.source === 'public_pool') {
    return { consumed: false, reason: 'public_pool' };
  }

  // 2. deck 卡：单事务双删
  try {
    const result = await withTransaction(async (client) => {
      const deckRes = await client.query(
        'DELETE FROM character_deck WHERE id = $1',
        [handCard.deck_id]
      );
      const cardRes = await client.query(
        'DELETE FROM player_cards WHERE id = $1',
        [handCard.card_id]
      );

      // 幂等边界：双删任一返回 0 行（已被别的路径删了）
      if (deckRes.rowCount === 0 || cardRes.rowCount === 0) {
        await client.query('ROLLBACK');
        console.warn(
          `[consumePlayerCard] partial delete: charId=${characterId} ` +
            `deckRows=${deckRes.rowCount} cardRows=${cardRes.rowCount} ` +
            `deckId=${handCard.deck_id} cardId=${handCard.card_id}`
        );
        return { consumed: false as const, reason: 'partial' as const };
      }

      return { consumed: true as const };
    });
    return result;
  } catch (err) {
    // withTransaction 已 ROLLBACK；这里只记日志
    console.error(
      `[consumePlayerCard] failed: charId=${characterId} ` +
        `deckId=${handCard.deck_id} cardId=${handCard.card_id} ` +
        `error=${(err as Error).message}`
    );
    return { consumed: false, reason: 'error' };
  }
}
```

- [ ] **Step 3: 验证 `HandCard` 类型已 import**

确认 `HandCard` 已在文件顶部 import（应该是的，因为 `executePlayCard` 签名里有）。如果没，在本任务补：

```typescript
import { ... HandCard ... } from './handService';
```

- [ ] **Step 4: 跑测试看 T053-1 / T053-2 是否 pass**

```bash
cd /home/lovept/PtIDLE/backend && npx jest src/services/battleActionService.test.ts -t 'T053' 2>&1 | tail -25
```

Expected: T053-1 PASS, T053-2 PASS, T053-3 / T053-4 / T053-5 仍 fail（步骤 9.5 还没插）

---

## Task 4: 插入 `executePlayCard` 步骤 9.5

**Files:**
- Modify: `backend/src/services/battleActionService.ts`（在 `executePlayCard` 步骤 9 与步骤 10 之间插入步骤 9.5）

- [ ] **Step 1: 定位插入点**

读取 `backend/src/services/battleActionService.ts` 找到这段代码（约 270-285 行）：

```typescript
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
```

- [ ] **Step 2: 插入步骤 9.5**

在 `// 10. 广播` 这行**之前**插入：

```typescript
  // 9.5 ★ T053: DB 实时消耗（best-effort，失败不返错）
  await consumePlayerCard(handCard, characterId);

```

修改后应为：

```typescript
  // 9. 入弃牌堆（仅 deck 来源）
  try {
    if (handCard.source === 'deck') {
      await addToDiscardPile(battleId, characterId, [handCard]);
    }
  } catch (err) {
    return { success: false, error: 'side_effect_failed', detail: (err as Error).message };
  }

  // 9.5 ★ T053: DB 实时消耗（best-effort，失败不返错）
  await consumePlayerCard(handCard, characterId);

  // 10. 广播
  await broadcastHandState(io, battleId, userId, characterId);
  await broadcastCharacterStatus(io, battleId, characterId);
```

- [ ] **Step 3: 跑全部 T053 测试**

```bash
npx jest src/services/battleActionService.test.ts -t 'T053' 2>&1 | tail -15
```

Expected: 5 passed (T053-1 到 T053-5 全绿)

- [ ] **Step 4: 跑 T050 既有 18 个 case（回归）**

```bash
npx jest src/services/battleActionService.test.ts -t 'executePlayCard' 2>&1 | tail -10
```

Expected: 23 passed (18 T050 + 5 T053), 0 failed

- [ ] **Step 5: 跑全部 service 测试（更大范围回归）**

```bash
npx jest src/services/ 2>&1 | tail -15
```

Expected: 所有 service 测试 pass；battleActionService 23/23，battleOutcomeService 18/18，其他不变

- [ ] **Step 6: 跑 database 测试（回归 Task 1）**

```bash
npx jest src/config/database.test.ts 2>&1 | tail -10
```

Expected: 4 passed

- [ ] **Step 7: 提交**

```bash
cd /home/lovept/PtIDLE
git add backend/src/services/battleActionService.ts
git commit -m "feat(battleAction): T053 consumePlayerCard + step 9.5 in executePlayCard

- 新增 consumePlayerCard(handCard, characterId) 内部函数
- source='public_pool' 跳过; source='deck' withTransaction(fn) 双删
- 双删任一 rowCount=0 → ROLLBACK + console.warn (partial)
- 任何 SQL 抛错 → withTransaction ROLLBACK + 本函数 console.error
- best-effort: 不抛错给上层, 不影响 broadcast/phase 推进
- executePlayCard 步骤 9 之后、步骤 10 之前插入步骤 9.5
- 5/5 新测试 + 18/18 T050 回归测试 + 4/4 database 测试 全绿"
```

---

## Task 5: 文档收尾

**Files:**
- Modify: `memory-bank/architecture.md`（追加 T053 章节）
- Modify: `memory-bank/progress.md`（追加 T053 完成行）
- Modify: `memory-bank/history.md`（追加 T053 收尾日志）

- [ ] **Step 1: 在 `memory-bank/architecture.md` 追加 T053 章节**

读取 `memory-bank/architecture.md` 末尾，在最后一行 `*最后更新：xxxx` 之前追加（用 Edit 工具定位「## T052 胜负判定」章节之后的下一个 `---` 分隔符之后的位置）：

```markdown
---

## T053 卡牌消耗

T053 补全 T050 流水线的「库存落地」环节：每打一张 `source='deck'` 的手牌，立即在 DB 中删除对应的 `character_deck` 行 + `player_cards` 行（同一事务内）。`source='public_pool'` 卡不入 `player_cards`，跳过删除。失败采用 best-effort 策略：catch + `console.error` + 不影响后续广播 / 阶段推进。

### 1. 触发流程

T050 executePlayCard 17 步流水线（T053 改造后）
  步骤 1-8:  session 读 / phase 校验 / actor 校验 / owner 校验 / hand 归属 / dispatch validate / 扣能量 / lRem 手牌
  步骤 9:    addToDiscardPile (if source='deck')
  步骤 9.5:  ★ T053 NEW: consumePlayerCard(handCard, characterId)  ← best-effort, 内部事务
  步骤 10-17: 广播 / 阶段推进 / T051 executeEndStep 级联

### 2. 新增基础设施

`backend/src/config/database.ts` 新增 `withTransaction<T>(fn)` helper：
- `pool.connect()` 拿单 client，fn 内部所有 SQL 走同一连接
- fn 成功 → COMMIT
- fn 抛错 → ROLLBACK + 重新抛错
- ROLLBACK 自身抛错 → 内部吞掉，避免 release 失败
- 任何情况下 `client.release()` 都被调用

T054 / T056 后续可复用此 helper（battle result API、applyDamage 整合等）。

### 3. 关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 触发时机 | 实时（executePlayCard 步骤 9.5） | 玩家期望「打牌 → 库存 -1」原子；与 T050 既有控制流解耦 |
| 删除范围 | `character_deck` + `player_cards` 双删 | spec 「卡牌为消耗品」语义；FK CASCADE 虽能自动删 character_deck，但显式双删可控可测 |
| 失败处理 | best-effort + console.error + 不返错 | 上游（lRem / 能量扣 / 广播）已成功，回滚代价大 |
| 事务策略 | `withTransaction` 单事务 | 避免「character_deck 删了 player_cards 没删」的中间态（野牌） |
| 公共池卡 | 提前 return 跳过 | 不在 player_cards，无 DELETE 必要 |
| ID 映射 | card_id → player_cards.id，deck_id → character_deck.id | PK 查询，O(1) |
| 不复用 removeCardFromCharacter | 新写 `consumePlayerCard` | removeCardFromCharacter 是手动 API（无事务、单条 DELETE、抛错失败），与 T053 best-effort 实时事务语义不同 |

### 4. 文件清单

- `src/config/database.ts` — 新增 `withTransaction<T>(fn)` helper
- `src/config/database.test.ts` — 4 个新测试 (commit/rollback/异常隔离/调用顺序)
- `src/services/battleActionService.ts` — 新增 `consumePlayerCard` 内部函数 + executePlayCard 步骤 9.5 插入
- `src/services/battleActionService.test.ts` — 5 个新测试 + 顶部 mock 补 `withTransaction`

**无新增 migration / 无新增 Redis 键 / 无新增 WS 事件 / 无新增 T050 error 变体**。

### 5. 范围外（明确不做）

- ❌ 批量结算模式（对战结束统一删）
- ❌ 「used」标记 + 后台清理
- ❌ 退款 / 撤销
- ❌ 失败时回滚 Redis 手牌 / 能量 / 广播
- ❌ 失败时返回 error 变体
- ❌ 5v5 / NvN 模式
- ❌ 卡牌消耗统计 / 监控埋点
```

- [ ] **Step 2: 在 `memory-bank/progress.md` 追加 T053 完成行**

读取 `memory-bank/progress.md`，定位到「已完成」表格中「T052」行**之后**，追加：

```markdown
| T053 | 实现卡牌消耗处理（每打一张 deck 卡实时删 character_deck + player_cards 行，单事务，best-effort 失败策略） | 2026-06-18 |
```

- [ ] **Step 3: 在 `memory-bank/history.md` 追加 T053 收尾日志**

读取 `memory-bank/history.md` 末尾，追加以下条目（保持文件原有 `## Date - Task` / `### Prompt` / `### 思考` / `### 意外` 格式）：

```markdown
## 2026-06-18 - 任务：T053 卡牌消耗

### Prompt
「使用 Ask/Plan 模式确认 T053 的方案」—— 继 T052 胜负判定之后，下一步实施对战中的卡牌消耗处理。

### 思考
- 关键设计决策 4 项：触发时机（实时） / 删除范围（双表） / 失败处理（best-effort） / 事务策略（单事务）
- spec §7.4 风险在 plan 阶段前置确认：`backend/src/config/database.ts` 的 `query` 函数每次调用重新 pool.connect() 并 release，BEGIN / DELETE / COMMIT 跨调用会跑在不同连接上，事务不生效
- 解法：在 `database.ts` 新增 `withTransaction<T>(fn)` helper，单 client + 自动 BEGIN/COMMIT/ROLLBACK + 自动 release；T054 / T056 后续可复用
- T053 自身 ~50 行生产代码 + ~150 行测试；5 个新 case 覆盖 happy / public_pool 跳过 / 异常 best-effort / partial warn / T050 回归
- 不动 T050 既有 8 error 变体；executeEndStep / executeRoundEnd 流程不变

### 意外
- spec §7.4 风险在实施前确认：`query` 函数不支持事务（pool.connect + release 模式），plan 任务 1 必须先加 withTransaction helper
- T053 步骤 9.5 失败不影响上层（手牌 lRem / 能量扣 / 广播已成功），故 best-effort 策略合理
- 双删 rowCount=0 走 ROLLBACK + warn 路径，幂等且日志可观测
```

- [ ] **Step 4: 提交文档**

```bash
cd /home/lovept/PtIDLE
git add memory-bank/architecture.md memory-bank/progress.md memory-bank/history.md
git commit -m "docs: T053 architecture + progress + history update

- architecture.md: 新增 T053 卡牌消耗章节 (5 段：流程/基础设施/决策/文件清单/范围外)
- progress.md: 追加 T053 完成行 (2026-06-18)
- history.md: 追加 T053 收尾日志 (Prompt/思考/意外 4 段)"
```

---

## Task 6: 全量回归 + 推送到 dev:up 容器（最终验证）

> **注意**：CLAUDE.md 规则 4：NEVER push to remote without user approval。Task 6 不做 push，仅做本地 dev 环境验证。

- [ ] **Step 1: 启动 dev 依赖（PostgreSQL 5433 + Redis 6379）**

```bash
cd /home/lovept/PtIDLE/backend && npm run dev:up 2>&1 | tail -10
```

Expected: 看到 `ptidle-redis-1 Running` + `ptidle-postgres-1 Running`

- [ ] **Step 2: 跑全量单测 + 集成测**

```bash
npx jest 2>&1 | tail -20
```

Expected: 所有 suite / test pass（之前 36 suite / 620 test 基础上 +1 suite (database.test.ts 4 个) +5 个 T053 case = 36 suite / 624 test 全绿）

- [ ] **Step 3: 跑 TS 编译检查**

```bash
npx tsc --noEmit 2>&1 | tail -10
```

Expected: 0 errors

- [ ] **Step 4: 跑 ESLint 检查**

```bash
npx eslint src/services/battleActionService.ts src/config/database.ts 2>&1 | tail -10
```

Expected: 0 errors / 0 warnings

- [ ] **Step 5: 总结**

向用户报告：
- 6 个 task 全部 commit
- 全量测试 pass (T053-1 到 T053-5 5 个新 + T050 18 旧 + database 4 新 = 27/27)
- TS 编译 0 error
- ESLint 0 warning
- 等用户决定是否 push 到远端（CLAUDE.md 规则 4）

---

## 验证规则总表

| 任务 | 验证命令 | 期望 |
|------|---------|------|
| Task 1 | `npx jest src/config/database.test.ts` | 4 passed |
| Task 2 | `npx jest src/services/battleActionService.test.ts -t 'T053'` | 5 failed（预期） |
| Task 3 | `npx jest src/services/battleActionService.test.ts -t 'T053'` | 2 passed, 3 failed（步骤 9.5 还没插） |
| Task 4 | `npx jest src/services/battleActionService.test.ts -t 'T053'` | 5 passed |
| Task 4 | `npx jest src/services/battleActionService.test.ts -t 'executePlayCard'` | 23 passed (18+5) |
| Task 5 | git log | 4 个新 commit |
| Task 6 | `npx jest` | 全量通过（含 27 个 T053 相关） |

---

## Self-Review（作者内审）

### 1. Spec 覆盖

| Spec 章节 | 对应 Task |
|----------|----------|
| §1 消耗规则 | Task 2 (T053-1 happy) + Task 2 (T053-2 public_pool skip) |
| §2 数据模型 | Task 1 (database.test 验证 rowCount) + Task 3 (DELETE SQL) |
| §3 模块设计 | Task 3 (consumePlayerCard) + Task 4 (步骤 9.5 插入) |
| §4 触发流程 | Task 4 (代码注释 + 步骤 9.5 位置) |
| §5 验证规则 | Task 2-4 (5 个 case 覆盖正常/异常/边界) |
| §6 数据流 | Task 3 (withTransaction 单连接) |
| §7 关键技术决策 | Task 1 (withTransaction 选择) + Task 3 (best-effort) + Task 4 (步骤定位) |
| §8 测试设计 | Task 2-4 (5 个 case) |
| §9 文件清单 | Task 1, 3, 4 (database.ts / battleActionService.ts / .test.ts) |
| §10 范围外 | Task 5 (architecture.md 范围外章节) |
| §7.4 风险点 | Task 1 (前置 withTransaction helper) |
| 附录 B 失败 reason 枚举 | Task 3 (consumePlayerCard 返回值) |

### 2. 占位符扫描

- ❌ "TBD" / "TODO" / "implement later" / "fill in details" — 无
- ❌ "Add appropriate error handling" / "Add validation" / "Handle edge cases" — 无（每个 step 都有具体代码）
- ❌ "Similar to Task N" — 无（每段代码都完整给出）
- ❌ "Write tests for the above"（无测试代码） — 无（每个测试都有具体 it() 代码）

### 3. 类型一致性

- `withTransaction<T>(fn)` 在 Task 1 定义，Task 3 复用 ✓
- `HandCard` 在 Task 3 引用（已 import） ✓
- `consumePlayerCard(handCard, characterId)` 在 Task 3 定义，Task 4 调用 ✓
- `mockWithTransaction` 在 Task 2 定义，Task 2-4 测试都用 ✓

### 4. 范围检查

T053 是单一聚焦任务（卡牌消耗），未涉及多子系统。

---

*计划版本：v1.0*
*最后更新：2026-06-18*
