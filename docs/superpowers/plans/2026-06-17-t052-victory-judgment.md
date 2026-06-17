# T052 胜负判定 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 3v3 战棋对战中实现基于「击杀累计」+「据点占领累计」两条独立路径的胜利判定系统。任一方累计 ≥6 star 即获胜（双方同时 6 视为平局）。每步结束（T051 `executeEndStep`）检测击杀加星，每轮结束（T051 `executeRoundEnd`）检测据点占领加星。

**Architecture:** 新增 `src/services/battleOutcomeService.ts` 提供 4 个公共函数（`applyKillStars`、`applyBaseStars`、`checkWinCondition`、`recordVictory`）。两个 T051 orchestrator 在 broadcast 之后各插入一次 wire-up 调用。新增 WS 事件 `battle:state:bases` + `battle:end`。DB 加 migration 009 给 `battles` 表新增 4 列（`p1_stars`、`p2_stars`、`winner_player_id`、`victory_type`）。`buildBoardState` 增加 `p1Stars` / `p2Stars` / `bases` 三个字段。

**Tech Stack:** Node.js + TypeScript + Express + Socket.io + PostgreSQL + Redis（v4 client）+ Jest + ts-jest

**Spec:** `docs/superpowers/specs/2026-06-17-t052-victory-judgment-design.md`

---

## File Structure

```
backend/
├── src/
│   ├── migrations/
│   │   └── 009_t052_victory_stars.sql        [CREATE] +p1_stars +p2_stars +winner_player_id +victory_type
│   ├── services/
│   │   ├── battleOutcomeService.ts          [CREATE] ~250 lines: BASES, Side, VictoryType, 4 公共函数 + 2 helpers
│   │   ├── battleOutcomeService.test.ts     [CREATE] 18 cases (applyKillStars 5 + applyBaseStars 5 + checkWinCondition 4 + recordVictory 4)
│   │   ├── battleActionService.ts           [MODIFY] executeEndStep 加 step 0 (preStepAliveMap 快照) + step 12 (applyKillStars wire-up);
│   │   │                                          executeRoundEnd 加 step 6 (applyBaseStars wire-up)
│   │   ├── battleActionService.test.ts      [MODIFY] 顶部 mock 补 applyKillStars + applyBaseStars + checkWinCondition + recordVictory;
│   │   │                                          追加 5 个 wire-up 集成 case
│   │   └── battleInitializationService.ts   [MODIFY] T048 初始化末尾追加 5 个 SET 键
│   └── socket/
│       ├── battleStateBroadcaster.ts        [MODIFY] +broadcastBasesState +broadcastBattleEnd;
│       │                                          BoardStateEvent 加 p1Stars/p2Stars/bases 字段;
│       │                                          buildBoardState 读 stars + bases
│       └── battleStateBroadcaster.test.ts   [MODIFY] +4 broadcaster cases + 1 buildBoardState stars/bases case
```

---

## Task 1: Migration 009 — battles 表加胜利进度字段

**Files:**
- Create: `backend/src/migrations/009_t052_victory_stars.sql`

- [ ] **Step 1: 创建 migration SQL 文件**

创建 `backend/src/migrations/009_t052_victory_stars.sql`，内容：

```sql
-- PtIDLE 数据库迁移脚本
-- 版本: 009
-- 日期: 2026-06-17
-- 描述: T052 胜负判定 - battles 表新增胜利进度字段
--   - p1_stars: p1 累计胜利进度 (0-6)
--   - p2_stars: p2 累计胜利进度 (0-6)
--   - winner_player_id: 胜利玩家 player_id (平局时 NULL)
--   - victory_type: 胜利类型 kill_threshold | base_threshold | draw

-- ========================================
-- 1. 添加胜利进度字段
-- ========================================

ALTER TABLE battles ADD COLUMN IF NOT EXISTS p1_stars INTEGER DEFAULT 0;
ALTER TABLE battles ADD COLUMN IF NOT EXISTS p2_stars INTEGER DEFAULT 0;
ALTER TABLE battles ADD COLUMN IF NOT EXISTS winner_player_id UUID REFERENCES players(id);
ALTER TABLE battles ADD COLUMN IF NOT EXISTS victory_type VARCHAR(20)
  CHECK (victory_type IN ('kill_threshold', 'base_threshold', 'draw'));

-- ========================================
-- 2. 注释
-- ========================================

COMMENT ON COLUMN battles.p1_stars IS 'p1 累计胜利进度 (0-6)';
COMMENT ON COLUMN battles.p2_stars IS 'p2 累计胜利进度 (0-6)';
COMMENT ON COLUMN battles.winner_player_id IS '胜利玩家 player_id（平局时 NULL）';
COMMENT ON COLUMN battles.victory_type IS '胜利类型: kill_threshold | base_threshold | draw';
```

- [ ] **Step 2: 提交**

```bash
cd /home/lovept/PtIDLE
git add backend/src/migrations/009_t052_victory_stars.sql
git commit -m "feat(migration): T052 add p1_stars/p2_stars/winner/victory_type columns"
```

> **注**：应用 migration 是 ops 任务，由用户在测试 DB 执行 `psql ... < 009_t052_victory_stars.sql`。T052 单元测试 mock 所有 DB 调用，不依赖真实 DB。

---

## Task 2: battleOutcomeService.ts 骨架 + 类型 + 常量

**Files:**
- Create: `backend/src/services/battleOutcomeService.ts`
- Create: `backend/src/services/battleOutcomeService.test.ts` (初始 empty describe，验证骨架可编译)

- [ ] **Step 1: 创建骨架文件**

创建 `backend/src/services/battleOutcomeService.ts`：

```typescript
// ========================================
// T052 胜负判定服务
// ========================================
// 提供对战胜利判定：
//   - applyKillStars: 捕获本步新增死亡 → 给击杀方 +1 star
//   - applyBaseStars: 扫描 2 个据点 → 占领方 +1 star
//   - checkWinCondition: 判定 win/draw/not_over
//   - recordVictory: 持久化 winner + finishSession + 广播 battle:end
//
// 数据存储：
//   - Redis: battle:{id}:stars:p1/p2 (STRING), battle:{id}:bases (STRING JSON), battle:{id}:alive_p1/p2 (STRING)
//   - DB: battles.p1_stars, p2_stars, winner_player_id, victory_type (migration 009)
//
// 调用方:
//   - T051 executeEndStep: 调 applyKillStars + checkWinCondition + recordVictory
//   - T051 executeRoundEnd: 调 applyBaseStars + checkWinCondition + recordVictory
//
// 范围外:
//   - 卡牌消耗: T053
//   - 战斗结算 API: T054
//   - 伤害权威化: T056

import type { Server as IOServer } from 'socket.io';
import { query, execute } from '../config/database';
import { redisClient } from '../config/redis';
import { listCharactersInBattle } from './battleService';
import { finishSession } from './battleSessionService';

// ========================================
// 常量
// ========================================

/**
 * 棋盘上的固定据点（3v3 模式，9x9 棋盘对角线）
 */
export const BASES: ReadonlyArray<{ x: number; y: number; key: string }> = [
  { x: 3, y: 3, key: '3,3' },
  { x: 6, y: 6, key: '6,6' },
] as const;

/**
 * 据点占领范围半径（Chebyshev 距离 ≤ BASE_RADIUS，等价 5x5 正方形）
 */
export const BASE_RADIUS = 2;

/**
 * 胜利阈值（达到即获胜）
 */
export const WIN_THRESHOLD = 6;

// ========================================
// 类型
// ========================================

export type Side = 'p1' | 'p2';
export type BaseOwner = Side | 'neutral';
export type VictoryType = 'kill_threshold' | 'base_threshold' | 'draw';
export type StarSource = 'kill' | 'base';

export type BasesState = Record<string, BaseOwner>;

export interface KillStarDelta {
  p1Delta: number; // 本步 p1 stars 增量（p1 击杀对方 N 棋 → +N）
  p2Delta: number; // 本步 p2 stars 增量（p2 击杀对方 N 棋 → +N）
  p1StarsAfter: number;
  p2StarsAfter: number;
}

export interface BaseStarDelta {
  p1Delta: number;
  p2Delta: number;
  p1StarsAfter: number;
  p2StarsAfter: number;
  bases: BasesState;
}

export type WinCheckResult =
  | { status: 'win'; winnerSide: Side; p1Stars: number; p2Stars: number }
  | { status: 'draw'; p1Stars: number; p2Stars: number }
  | { status: 'not_over'; p1Stars: number; p2Stars: number };

export type RecordVictoryOutcome = Extract<WinCheckResult, { status: 'win' | 'draw' }>;

// ========================================
// Redis key 辅助
// ========================================

function starsKey(battleId: string, side: Side): string {
  return `battle:${battleId}:stars:${side}`;
}

function aliveKey(battleId: string, side: Side): string {
  return `battle:${battleId}:alive_${side}`;
}

function basesKey(battleId: string): string {
  return `battle:${battleId}:bases`;
}

function piecesKey(battleId: string): string {
  return `battle:${battleId}:pieces`;
}

function positionsKey(battleId: string): string {
  return `battle:${battleId}:positions`;
}

// ========================================
// 公共函数（Task 3-6 逐步实现）
// ========================================

/**
 * T052 §3.1: 应用击杀 star — 见 Task 3 完整实现
 */
export async function applyKillStars(
  battleId: string,
  preStepAliveMap: Record<string, boolean>
): Promise<KillStarDelta> {
  throw new Error('applyKillStars: not implemented');
}

/**
 * T052 §3.1: 应用据点 star — 见 Task 4 完整实现
 */
export async function applyBaseStars(battleId: string): Promise<BaseStarDelta> {
  throw new Error('applyBaseStars: not implemented');
}

/**
 * T052 §3.1: 检查胜利条件 — 见 Task 5 完整实现
 */
export async function checkWinCondition(battleId: string): Promise<WinCheckResult> {
  throw new Error('checkWinCondition: not implemented');
}

/**
 * T052 §3.1: 记录胜利（持久化 + finishSession + 广播）— 见 Task 6 完整实现
 */
export async function recordVictory(
  io: IOServer,
  battleId: string,
  outcome: RecordVictoryOutcome
): Promise<void> {
  throw new Error('recordVictory: not implemented');
}

// ========================================
// 内部 helper（Task 3, 4 使用）
// ========================================

/**
 * 内部：把 stars 累加写回 Redis（INCRBY）+ DB（UPDATE）
 */
async function persistStars(
  battleId: string,
  side: Side,
  incrementBy: number
): Promise<{ newStars: number }> {
  throw new Error('persistStars: not implemented');
}

/**
 * 内部：把 pN alive 计数 -1
 */
async function decrementAlive(battleId: string, side: Side): Promise<void> {
  throw new Error('decrementAlive: not implemented');
}
```

- [ ] **Step 2: 创建空测试文件，验证骨架可编译**

创建 `backend/src/services/battleOutcomeService.test.ts`：

```typescript
// T052 battleOutcomeService 单元测试
// 总计 18 cases across 4 describe blocks (Tasks 3-6 逐步填充)

import { BASES, BASE_RADIUS, WIN_THRESHOLD } from './battleOutcomeService';

describe('battleOutcomeService - constants', () => {
  it('BASES 包含 (3,3) 和 (6,6) 两个据点', () => {
    expect(BASES).toHaveLength(2);
    expect(BASES[0]).toEqual({ x: 3, y: 3, key: '3,3' });
    expect(BASES[1]).toEqual({ x: 6, y: 6, key: '6,6' });
  });

  it('BASE_RADIUS = 2', () => {
    expect(BASE_RADIUS).toBe(2);
  });

  it('WIN_THRESHOLD = 6', () => {
    expect(WIN_THRESHOLD).toBe(6);
  });
});
```

- [ ] **Step 3: 运行测试验证骨架编译通过**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/services/battleOutcomeService.test.ts
```

Expected: 3 tests PASS (constants 测试) + 4 stub 函数编译不报错

- [ ] **Step 4: 提交**

```bash
cd /home/lovept/PtIDLE
git add backend/src/services/battleOutcomeService.ts backend/src/services/battleOutcomeService.test.ts
git commit -m "feat(outcome): T052 battleOutcomeService skeleton with types + constants"
```

---

## Task 3: applyKillStars 实现（TDD）

**Files:**
- Modify: `backend/src/services/battleOutcomeService.ts` (替换 `applyKillStars` 函数)
- Modify: `backend/src/services/battleOutcomeService.test.ts` (追加 5 个 applyKillStars cases)

- [ ] **Step 1: 写测试 — applyKillStars 5 个 case**

在 `backend/src/services/battleOutcomeService.test.ts` 顶部追加（**先追加 mocks**）：

```typescript
// ============== Mocks ==============
// 注意：jest.mock + const mockXxx 必须先于 import（ts-jest TDZ pitfall）

const mockRedisHGetAll = jest.fn();
const mockRedisGet = jest.fn();
const mockRedisIncrBy = jest.fn();
const mockRedisSet = jest.fn();
const mockRedisDel = jest.fn();
const mockRedisHSet = jest.fn();
const mockRedisHGet = jest.fn();

const mockQuery = jest.fn();
const mockExecute = jest.fn();
const mockListCharactersInBattle = jest.fn();

jest.mock('../config/redis', () => ({
  redisClient: {
    hGetAll: mockRedisHGetAll,
    get: mockRedisGet,
    incrBy: mockRedisIncrBy,
    set: mockRedisSet,
    del: mockRedisDel,
    hSet: mockRedisHSet,
    hGet: mockRedisHGet,
  },
}));

jest.mock('../config/database', () => ({
  query: mockQuery,
  execute: mockExecute,
}));

jest.mock('./battleService', () => ({
  listCharactersInBattle: mockListCharactersInBattle,
}));

import { applyKillStars } from './battleOutcomeService';

const mockList = mockListCharactersInBattle as jest.MockedFunction<typeof mockListCharactersInBattle>;
const mockHGetAll = mockRedisHGetAll as jest.MockedFunction<typeof mockRedisHGetAll>;
const mockGet = mockRedisGet as jest.MockedFunction<typeof mockRedisGet>;
const mockIncrBy = mockRedisIncrBy as jest.MockedFunction<typeof mockRedisIncrBy>;
const mockExecuteDb = mockExecute as jest.MockedFunction<typeof mockExecute>;
const mockSetRedis = mockRedisSet as jest.MockedFunction<typeof mockRedisSet>;
```

（**注**：放在文件顶部已有 constants describe 之前，文件结构：`mocks → jest.mock → imports → const mockXxx → existing describe('constants') + new describe blocks`）

追加 describe 块（在 constants describe 后）：

```typescript
describe('applyKillStars', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    // 默认：6 角色均 alive，pieces 全部 alive
    mockList.mockResolvedValue([
      { characterId: 'c1', playerId: 'p1', userId: 'u1', profession: 'warrior', name: 'A' },
      { characterId: 'c2', playerId: 'p1', userId: 'u1', profession: 'ranger', name: 'B' },
      { characterId: 'c3', playerId: 'p1', userId: 'u1', profession: 'mage', name: 'C' },
      { characterId: 'c4', playerId: 'p2', userId: 'u2', profession: 'warrior', name: 'D' },
      { characterId: 'c5', playerId: 'p2', userId: 'u2', profession: 'ranger', name: 'E' },
      { characterId: 'c6', playerId: 'p2', userId: 'u2', profession: 'mage', name: 'F' },
    ] as any);
    // 默认所有 alive
    mockHGetAll.mockResolvedValue({
      c1: JSON.stringify({ is_alive: true }),
      c2: JSON.stringify({ is_alive: true }),
      c3: JSON.stringify({ is_alive: true }),
      c4: JSON.stringify({ is_alive: true }),
      c5: JSON.stringify({ is_alive: true }),
      c6: JSON.stringify({ is_alive: true }),
    });
    // 默认 stars 0/0
    mockGet.mockImplementation(async (key: string) => {
      if (key === 'battle:b1:stars:p1') return '0';
      if (key === 'battle:b1:stars:p2') return '0';
      return null;
    });
    mockIncrBy.mockResolvedValue(1);
    mockExecuteDb.mockResolvedValue({ rowCount: 1 });
  });

  it('1 kill: p1 杀 1 个 p2 棋子 → p1StarsAfter=1', async () => {
    // 1 个 p2 棋子 (c4) 死亡 → p1 击杀方，p1 +1 star
    mockHGetAll.mockResolvedValue({
      c1: JSON.stringify({ is_alive: true }),
      c2: JSON.stringify({ is_alive: true }),
      c3: JSON.stringify({ is_alive: true }),
      c4: JSON.stringify({ is_alive: false }), // ★ 死亡
      c5: JSON.stringify({ is_alive: true }),
      c6: JSON.stringify({ is_alive: true }),
    });
    const preMap = { c1: true, c2: true, c3: true, c4: true, c5: true, c6: true };

    const result = await applyKillStars('b1', preMap);

    expect(result.p1Delta).toBe(1); // p1 杀 1 个 p2 → p1 stars +1
    expect(result.p2Delta).toBe(0);
    expect(result.p1StarsAfter).toBe(1);
    expect(result.p2StarsAfter).toBe(0);
    expect(mockIncrBy).toHaveBeenCalledWith('battle:b1:stars:p1', 1);
  });

  it('0 kill: is_alive 不变 → 0 delta', async () => {
    const preMap = { c1: true, c2: true, c3: true, c4: true, c5: true, c6: true };
    // mockHGetAll 仍返全 alive (default)

    const result = await applyKillStars('b1', preMap);

    expect(result.p1Delta).toBe(0);
    expect(result.p2Delta).toBe(0);
    expect(result.p1StarsAfter).toBe(0);
    expect(result.p2StarsAfter).toBe(0);
    expect(mockIncrBy).not.toHaveBeenCalled();
  });

  it('multi kill: p1 AOE 杀 2 个 p2 棋子 → p1StarsAfter=2', async () => {
    mockHGetAll.mockResolvedValue({
      c1: JSON.stringify({ is_alive: true }),
      c2: JSON.stringify({ is_alive: true }),
      c3: JSON.stringify({ is_alive: true }),
      c4: JSON.stringify({ is_alive: false }),
      c5: JSON.stringify({ is_alive: false }),
      c6: JSON.stringify({ is_alive: true }),
    });
    const preMap = { c1: true, c2: true, c3: true, c4: true, c5: true, c6: true };

    const result = await applyKillStars('b1', preMap);

    expect(result.p1Delta).toBe(2); // p1 杀 2 个 p2 → p1 stars +2
    expect(result.p2Delta).toBe(0);
    expect(result.p1StarsAfter).toBe(2);
    expect(mockIncrBy).toHaveBeenCalledWith('battle:b1:stars:p1', 2);
  });

  it('burn kill: p2 棋子 burn tick 死亡 → p1 杀 (计入击杀)', async () => {
    // c4 在本步 burn tick 死亡 → preMap c4=true, 现在 c4=false → p1 击杀
    mockHGetAll.mockResolvedValue({
      c1: JSON.stringify({ is_alive: true }),
      c2: JSON.stringify({ is_alive: true }),
      c3: JSON.stringify({ is_alive: true }),
      c4: JSON.stringify({ is_alive: false }),
      c5: JSON.stringify({ is_alive: true }),
      c6: JSON.stringify({ is_alive: true }),
    });
    const preMap = { c1: true, c2: true, c3: true, c4: true, c5: true, c6: true };

    const result = await applyKillStars('b1', preMap);

    expect(result.p1Delta).toBe(1); // p1 杀 (burn 致 p2 死) → p1 +1
    expect(result.p1StarsAfter).toBe(1);
  });

  it('finished short-circuit: session.phase=finished → return 0 delta', async () => {
    // 实现策略：applyKillStars 第一步读 session phase；如 finished 则 return 0 delta
    // 简单实现：queryOne session + 检查 current_phase
    // 若选此实现方式，加 mockQueryOne 桩
    // 简化版本：跳过此 check，依赖 executeEndStep 在 finishSession 后不再调 applyKillStars
    // 此 case 验证：当 pieces 已清空（hGetAll 返 {}）时不会 crash
    mockHGetAll.mockResolvedValue({});
    mockList.mockResolvedValue([]);

    const result = await applyKillStars('b1', {});

    expect(result.p1Delta).toBe(0);
    expect(result.p2Delta).toBe(0);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/services/battleOutcomeService.test.ts -t "applyKillStars"
```

Expected: 5 tests FAIL (`applyKillStars: not implemented`)

- [ ] **Step 3: 实现 `applyKillStars`**

在 `backend/src/services/battleOutcomeService.ts` 替换 `applyKillStars` 函数（保留 helper `persistStars` 占位）：

```typescript
/**
 * T052 §3.1: 应用击杀 star
 *
 * 对比「调用前 is_alive 快照」与「当前 pieces HASH」，捕获本步新增死亡数，
 * 给击杀方 +1 star/次。
 *
 * 流程：
 *   1. listCharactersInBattle 拿全部 6 角色
 *   2. hGetAll pieces HASH 拿当前 is_alive
 *   3. 比对 preStepAliveMap vs 当前 → 找出本步新增死亡 (pre=true AND cur=false)
 *   4. 按 player_id 分组：p1 死 → p2 +1; p2 死 → p1 +1
 *   5. persistStars 写回 Redis + DB
 *   6. decrementAlive 更新 alive 计数
 *
 * @param battleId battle id
 * @param preStepAliveMap 调用方快照（characterId → is_alive）
 * @returns { p1Delta, p2Delta, p1StarsAfter, p2StarsAfter }
 */
export async function applyKillStars(
  battleId: string,
  preStepAliveMap: Record<string, boolean>
): Promise<KillStarDelta> {
  // 1. 拿所有角色
  const characters = await listCharactersInBattle(battleId);
  if (characters.length === 0) {
    return { p1Delta: 0, p2Delta: 0, p1StarsAfter: 0, p2StarsAfter: 0 };
  }

  // 2. 读当前 pieces
  const piecesRaw = await redisClient.hGetAll(piecesKey(battleId));

  // 3. 找本步新增死亡
  let p1Killed = 0; // p1 棋子死亡数（p2 击杀敌数）
  let p2Killed = 0; // p2 棋子死亡数（p1 击杀敌数）
  for (const c of characters) {
    const wasAlive = preStepAliveMap[c.characterId] === true;
    const curRaw = piecesRaw[c.characterId];
    if (!curRaw) continue;
    const cur = JSON.parse(curRaw);
    const isAliveNow = cur.is_alive === true;
    if (wasAlive && !isAliveNow) {
      // 死亡
      if (c.playerId === 'p1') p1Killed++;
      else p2Killed++;
    }
  }

  // 4-5. 累加 star + 同步 DB
  //   p2Killed 个 p2 棋死 → p1 (击杀方) +p2Killed star
  //   p1Killed 个 p1 棋死 → p2 (击杀方) +p1Killed star
  let p1StarsAfter = 0;
  let p2StarsAfter = 0;
  if (p2Killed > 0) {
    const r = await persistStars(battleId, 'p1', p2Killed);
    p1StarsAfter = r.newStars;
    await decrementAlive(battleId, 'p2');
  }
  if (p1Killed > 0) {
    const r = await persistStars(battleId, 'p2', p1Killed);
    p2StarsAfter = r.newStars;
    await decrementAlive(battleId, 'p1');
  }

  // 读其他方 stars (若无累加)
  if (p1Killed === 0) {
    const v = await redisClient.get(starsKey(battleId, 'p1'));
    p1StarsAfter = v === null ? 0 : parseInt(v, 10);
  }
  if (p2Killed === 0) {
    const v = await redisClient.get(starsKey(battleId, 'p2'));
    p2StarsAfter = v === null ? 0 : parseInt(v, 10);
  }

  return {
    p1Delta: p2Killed, // p1 stars 增量 = p2Killed（p1 击杀敌数）
    p2Delta: p1Killed, // p2 stars 增量 = p1Killed（p2 击杀敌数）
    p1StarsAfter,
    p2StarsAfter,
  };
}
```

**注意**：上述 `p1Delta`/`p2Delta` 命名是「击杀数」而非「被击杀数」—— 测试期望 `p2Delta: 1` 表示「p2 击杀 1 次」（即 p1 棋子死 1 个）。如需更清晰可重命名为 `p1Kills`/`p2Kills`。本实现按测试期望保留 pNDelta 命名，含义 = 「pN 击杀次数」。

- [ ] **Step 4: 实现 `persistStars` + `decrementAlive` helpers**

在 `backend/src/services/battleOutcomeService.ts` 替换两个 stub helpers：

```typescript
/**
 * 内部：把 stars 累加写回 Redis（INCRBY）+ DB（UPDATE）
 */
async function persistStars(
  battleId: string,
  side: Side,
  incrementBy: number
): Promise<{ newStars: number }> {
  const newStars = await redisClient.incrBy(starsKey(battleId, side), incrementBy);
  await execute(
    `UPDATE battles SET ${side}_stars = $1, updated_at = NOW() WHERE id = $2`,
    [newStars, battleId]
  );
  return { newStars };
}

/**
 * 内部：把 pN alive 计数 -1
 */
async function decrementAlive(battleId: string, side: Side): Promise<void> {
  await redisClient.decr(aliveKey(battleId, side));
}
```

**修正 Redis mock 桩**：因 `persistStars` 使用 `incrBy`，`decrementAlive` 使用 `decr`，需在测试 mock block 追加 `decr` mock：

```typescript
// 在 mock block 内
const mockRedisDecr = jest.fn();
jest.mock('../config/redis', () => ({
  redisClient: {
    hGetAll: mockRedisHGetAll,
    get: mockRedisGet,
    incrBy: mockRedisIncrBy,
    decr: mockRedisDecr,        // ★ 新增
    set: mockRedisSet,
    del: mockRedisDel,
    hSet: mockRedisHSet,
    hGet: mockRedisHGet,
  },
}));
```

并在 beforeEach 加 `mockDecr.mockResolvedValue(0)`。

- [ ] **Step 5: 运行测试验证通过**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/services/battleOutcomeService.test.ts -t "applyKillStars"
```

Expected: 5 tests PASS

- [ ] **Step 6: 提交**

```bash
cd /home/lovept/PtIDLE
git add backend/src/services/battleOutcomeService.ts backend/src/services/battleOutcomeService.test.ts
git commit -m "feat(outcome): T052 applyKillStars with 5 unit tests"
```

---

## Task 4: applyBaseStars 实现（TDD）

**Files:**
- Modify: `backend/src/services/battleOutcomeService.ts` (替换 `applyBaseStars` 函数)
- Modify: `backend/src/services/battleOutcomeService.test.ts` (追加 5 个 applyBaseStars cases)

- [ ] **Step 1: 写测试 — applyBaseStars 5 个 case**

在 `backend/src/services/battleOutcomeService.test.ts` 追加 describe 块：

```typescript
describe('applyBaseStars', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    // 默认 pieces 全 alive，positions 各异
    mockList.mockResolvedValue([
      { characterId: 'c1', playerId: 'p1', userId: 'u1', profession: 'warrior', name: 'A' },
      { characterId: 'c2', playerId: 'p1', userId: 'u1', profession: 'ranger', name: 'B' },
      { characterId: 'c3', playerId: 'p1', userId: 'u1', profession: 'mage', name: 'C' },
      { characterId: 'c4', playerId: 'p2', userId: 'u2', profession: 'warrior', name: 'D' },
      { characterId: 'c5', playerId: 'p2', userId: 'u2', profession: 'ranger', name: 'E' },
      { characterId: 'c6', playerId: 'p2', userId: 'u2', profession: 'mage', name: 'F' },
    ] as any);
    mockHGetAll.mockImplementation(async (key: string) => {
      if (key === 'battle:b1:pieces') {
        return {
          c1: JSON.stringify({ is_alive: true }),
          c2: JSON.stringify({ is_alive: true }),
          c3: JSON.stringify({ is_alive: true }),
          c4: JSON.stringify({ is_alive: true }),
          c5: JSON.stringify({ is_alive: true }),
          c6: JSON.stringify({ is_alive: true }),
        };
      }
      if (key === 'battle:b1:positions') {
        // 默认 c1-c6 都在远离据点的位置 (8,8)
        return {
          c1: JSON.stringify({ x: 8, y: 8 }),
          c2: JSON.stringify({ x: 8, y: 8 }),
          c3: JSON.stringify({ x: 8, y: 8 }),
          c4: JSON.stringify({ x: 8, y: 8 }),
          c5: JSON.stringify({ x: 8, y: 8 }),
          c6: JSON.stringify({ x: 8, y: 8 }),
        };
      }
      return {};
    });
    mockGet.mockImplementation(async (key: string) => {
      if (key === 'battle:b1:stars:p1') return '0';
      if (key === 'battle:b1:stars:p2') return '0';
      return null;
    });
    mockIncrBy.mockResolvedValue(1);
    mockExecuteDb.mockResolvedValue({ rowCount: 1 });
  });

  it('p1 占 1: (3,3) 范围 p1=2 alive, p2=1 alive → p1 +1 star', async () => {
    // c1(3,3), c2(4,4) 在 (3,3) 范围 (Chebyshev ≤2), c4(4,3) 在范围
    mockHGetAll.mockImplementation(async (key: string) => {
      if (key === 'battle:b1:pieces') {
        return {
          c1: JSON.stringify({ is_alive: true }),
          c2: JSON.stringify({ is_alive: true }),
          c3: JSON.stringify({ is_alive: true }),
          c4: JSON.stringify({ is_alive: true }),
          c5: JSON.stringify({ is_alive: false }),
          c6: JSON.stringify({ is_alive: true }),
        };
      }
      if (key === 'battle:b1:positions') {
        return {
          c1: JSON.stringify({ x: 3, y: 3 }),
          c2: JSON.stringify({ x: 4, y: 4 }),
          c3: JSON.stringify({ x: 8, y: 8 }),
          c4: JSON.stringify({ x: 4, y: 3 }),
          c5: JSON.stringify({ x: 8, y: 8 }),
          c6: JSON.stringify({ x: 8, y: 8 }),
        };
      }
      return {};
    });

    const result = await applyBaseStars('b1');

    expect(result.p1Delta).toBe(1);
    expect(result.p2Delta).toBe(0);
    expect(result.p1StarsAfter).toBe(1);
    expect(result.bases['3,3']).toBe('p1');
    expect(result.bases['6,6']).toBe('neutral');
  });

  it('p2 占 2: (3,3) p1=0 p2=3; (6,6) p1=1 p2=2 → p2 +2 stars', async () => {
    mockHGetAll.mockImplementation(async (key: string) => {
      if (key === 'battle:b1:pieces') {
        return {
          c1: JSON.stringify({ is_alive: true }),
          c2: JSON.stringify({ is_alive: true }),
          c3: JSON.stringify({ is_alive: true }),
          c4: JSON.stringify({ is_alive: true }),
          c5: JSON.stringify({ is_alive: true }),
          c6: JSON.stringify({ is_alive: true }),
        };
      }
      if (key === 'battle:b1:positions') {
        return {
          c1: JSON.stringify({ x: 8, y: 8 }),  // 不在据点
          c2: JSON.stringify({ x: 8, y: 8 }),
          c3: JSON.stringify({ x: 8, y: 8 }),
          c4: JSON.stringify({ x: 3, y: 3 }),  // (3,3) 范围
          c5: JSON.stringify({ x: 4, y: 3 }),  // (3,3) 范围
          c6: JSON.stringify({ x: 5, y: 5 }),  // (3,3) 范围
        };
      }
      return {};
    });

    const result = await applyBaseStars('b1');

    expect(result.p1Delta).toBe(0);
    expect(result.p2Delta).toBe(2);
    expect(result.p2StarsAfter).toBe(2);
    expect(result.bases['3,3']).toBe('p2');
    expect(result.bases['6,6']).toBe('p2');
  });

  it('neutral: (3,3) p1=2 p2=2; (6,6) p1=3 p2=0 → p1 +1 (仅 6,6)', async () => {
    mockHGetAll.mockImplementation(async (key: string) => {
      if (key === 'battle:b1:positions') {
        return {
          c1: JSON.stringify({ x: 3, y: 3 }),  // (3,3) p1
          c2: JSON.stringify({ x: 4, y: 4 }),  // (3,3) p1
          c3: JSON.stringify({ x: 6, y: 6 }),  // (6,6) p1
          c4: JSON.stringify({ x: 5, y: 5 }),  // (3,3) p2
          c5: JSON.stringify({ x: 4, y: 3 }),  // (3,3) p2
          c6: JSON.stringify({ x: 8, y: 8 }),  // 不在据点
        };
      }
      return {};
    });

    const result = await applyBaseStars('b1');

    expect(result.p1Delta).toBe(1);
    expect(result.bases['3,3']).toBe('neutral');
    expect(result.bases['6,6']).toBe('p1');
  });

  it('both neutral: (3,3) p1=1 p2=1; (6,6) p1=1 p2=1 → 0 delta', async () => {
    mockHGetAll.mockImplementation(async (key: string) => {
      if (key === 'battle:b1:positions') {
        return {
          c1: JSON.stringify({ x: 3, y: 3 }),
          c2: JSON.stringify({ x: 8, y: 8 }),
          c3: JSON.stringify({ x: 6, y: 6 }),
          c4: JSON.stringify({ x: 5, y: 5 }),
          c5: JSON.stringify({ x: 7, y: 7 }),
          c6: JSON.stringify({ x: 8, y: 8 }),
        };
      }
      return {};
    });

    const result = await applyBaseStars('b1');

    expect(result.p1Delta).toBe(0);
    expect(result.p2Delta).toBe(0);
    expect(result.bases['3,3']).toBe('neutral');
    expect(result.bases['6,6']).toBe('neutral');
  });

  it('empty ranges: 所有棋子都出 (3,3) 范围 (在 8,8) → 0 delta', async () => {
    // 默认 mockHGetAll 已经把 c1-c6 放在 (8,8)
    const result = await applyBaseStars('b1');

    expect(result.p1Delta).toBe(0);
    expect(result.p2Delta).toBe(0);
    expect(result.bases['3,3']).toBe('neutral');
    expect(result.bases['6,6']).toBe('neutral');
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/services/battleOutcomeService.test.ts -t "applyBaseStars"
```

Expected: 5 tests FAIL (`applyBaseStars: not implemented`)

- [ ] **Step 3: 实现 `applyBaseStars`**

在 `backend/src/services/battleOutcomeService.ts` 替换 `applyBaseStars` 函数：

```typescript
/**
 * T052 §3.1: 应用据点 star
 *
 * 扫描 2 个固定据点 (3,3) 和 (6,6)，按 Chebyshev 距离 ≤2 范围
 * 内的 alive 棋子数判定占领方。占领方 +1 star。
 *
 * 流程：
 *   1. listCharactersInBattle 拿全部 6 角色
 *   2. hGetAll pieces 拿 is_alive + hGetAll positions 拿坐标
 *   3. 对每个据点：
 *      - 统计范围内 p1 alive, p2 alive
 *      - p1 > p2 → 'p1'; p1 < p2 → 'p2'; p1 == p2 → 'neutral'
 *   4. 累加 star（每占领 1 个 +1）
 *   5. SET bases JSON
 *   6. broadcastBasesState（由调用方负责，本函数只返 bases 状态）
 *
 * @param battleId battle id
 * @returns { p1Delta, p2Delta, p1StarsAfter, p2StarsAfter, bases }
 */
export async function applyBaseStars(battleId: string): Promise<BaseStarDelta> {
  // 1. 拿角色
  const characters = await listCharactersInBattle(battleId);
  if (characters.length === 0) {
    return {
      p1Delta: 0,
      p2Delta: 0,
      p1StarsAfter: 0,
      p2StarsAfter: 0,
      bases: { '3,3': 'neutral', '6,6': 'neutral' },
    };
  }

  // 2. 读 pieces + positions
  const [piecesRaw, positionsRaw] = await Promise.all([
    redisClient.hGetAll(piecesKey(battleId)),
    redisClient.hGetAll(positionsKey(battleId)),
  ]);

  // 3. 判定每个据点
  const bases: BasesState = {};
  let p1Delta = 0;
  let p2Delta = 0;

  for (const base of BASES) {
    let p1InRange = 0;
    let p2InRange = 0;
    for (const c of characters) {
      const pieceRaw = piecesRaw[c.characterId];
      const posRaw = positionsRaw[c.characterId];
      if (!pieceRaw || !posRaw) continue;
      const piece = JSON.parse(pieceRaw);
      const pos = JSON.parse(posRaw);
      if (piece.is_alive !== true) continue;
      // Chebyshev 距离
      const cheb = Math.max(Math.abs(pos.x - base.x), Math.abs(pos.y - base.y));
      if (cheb > BASE_RADIUS) continue;
      if (c.playerId === 'p1') p1InRange++;
      else if (c.playerId === 'p2') p2InRange++;
    }
    if (p1InRange > p2InRange) {
      bases[base.key] = 'p1';
      p1Delta++;
    } else if (p2InRange > p1InRange) {
      bases[base.key] = 'p2';
      p2Delta++;
    } else {
      bases[base.key] = 'neutral';
    }
  }

  // 4. 累加 star
  let p1StarsAfter = 0;
  let p2StarsAfter = 0;
  if (p1Delta > 0) {
    const r = await persistStars(battleId, 'p1', p1Delta);
    p1StarsAfter = r.newStars;
  } else {
    const v = await redisClient.get(starsKey(battleId, 'p1'));
    p1StarsAfter = v === null ? 0 : parseInt(v, 10);
  }
  if (p2Delta > 0) {
    const r = await persistStars(battleId, 'p2', p2Delta);
    p2StarsAfter = r.newStars;
  } else {
    const v = await redisClient.get(starsKey(battleId, 'p2'));
    p2StarsAfter = v === null ? 0 : parseInt(v, 10);
  }

  // 5. SET bases JSON
  await redisClient.set(basesKey(battleId), JSON.stringify(bases));

  return { p1Delta, p2Delta, p1StarsAfter, p2StarsAfter, bases };
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/services/battleOutcomeService.test.ts -t "applyBaseStars"
```

Expected: 5 tests PASS

- [ ] **Step 5: 提交**

```bash
cd /home/lovept/PtIDLE
git add backend/src/services/battleOutcomeService.ts backend/src/services/battleOutcomeService.test.ts
git commit -m "feat(outcome): T052 applyBaseStars with 5 unit tests"
```

---

## Task 5: checkWinCondition 实现（TDD）

**Files:**
- Modify: `backend/src/services/battleOutcomeService.ts` (替换 `checkWinCondition` 函数)
- Modify: `backend/src/services/battleOutcomeService.test.ts` (追加 4 个 cases)

- [ ] **Step 1: 写测试 — checkWinCondition 4 个 case**

在 `backend/src/services/battleOutcomeService.test.ts` 追加 describe 块：

```typescript
import { checkWinCondition } from './battleOutcomeService';

describe('checkWinCondition', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    // 默认 stars 0/0
    mockGet.mockImplementation(async (key: string) => {
      if (key === 'battle:b1:stars:p1') return '0';
      if (key === 'battle:b1:stars:p2') return '0';
      return null;
    });
  });

  it('win p1: p1=6, p2=2, source=kill → win p1 kill_threshold', async () => {
    mockGet.mockImplementation(async (key: string) => {
      if (key === 'battle:b1:stars:p1') return '6';
      if (key === 'battle:b1:stars:p2') return '2';
      return null;
    });
    const result = await checkWinCondition('b1');
    expect(result).toEqual({ status: 'win', winnerSide: 'p1', victoryType: 'kill_threshold', p1Stars: 6, p2Stars: 2 });
  });

  it('win p2 via base: p1=4, p2=6, source=base → win p2 base_threshold', async () => {
    mockGet.mockImplementation(async (key: string) => {
      if (key === 'battle:b1:stars:p1') return '4';
      if (key === 'battle:b1:stars:p2') return '6';
      return null;
    });
    const result = await checkWinCondition('b1');
    expect(result).toEqual({ status: 'win', winnerSide: 'p2', victoryType: 'base_threshold', p1Stars: 4, p2Stars: 6 });
  });

  it('draw: p1=6, p2=6 → draw', async () => {
    mockGet.mockImplementation(async (key: string) => {
      if (key === 'battle:b1:stars:p1') return '6';
      if (key === 'battle:b1:stars:p2') return '6';
      return null;
    });
    const result = await checkWinCondition('b1');
    expect(result).toEqual({ status: 'draw', p1Stars: 6, p2Stars: 6 });
  });

  it('not_over: p1=5, p2=3 → not_over', async () => {
    mockGet.mockImplementation(async (key: string) => {
      if (key === 'battle:b1:stars:p1') return '5';
      if (key === 'battle:b1:stars:p2') return '3';
      return null;
    });
    const result = await checkWinCondition('b1');
    expect(result).toEqual({ status: 'not_over', p1Stars: 5, p2Stars: 3 });
  });
});
```

**注意**：`checkWinCondition` 签名按 spec 是 `checkWinCondition(battleId)`（无 `lastStarSource` 参数）。`victoryType` 由调用方根据上下文推断。**实现**：

```typescript
export async function checkWinCondition(battleId: string): Promise<WinCheckResult>
```

只返 win/draw/not_over，不带 victoryType。victoryType 在调用方推断：

- applyKillStars 后 → kill_threshold
- applyBaseStars 后 → base_threshold
- 双方都 6 → draw（无论来源）

**修正设计**：`checkWinCondition` 只判 win/draw/not_over，不指定 victoryType。`recordVictory` 接受 `source: 'kill' | 'base'` 参数推断 victoryType。

修正测试期望 + 实现如下：

- [ ] **Step 2: 修正测试期望（去掉 victoryType）**

将 4 个 case 改为：

```typescript
it('win p1: p1=6, p2=2 → win p1', async () => {
  mockGet.mockImplementation(async (key: string) => {
    if (key === 'battle:b1:stars:p1') return '6';
    if (key === 'battle:b1:stars:p2') return '2';
    return null;
  });
  const result = await checkWinCondition('b1');
  expect(result).toEqual({ status: 'win', winnerSide: 'p1', p1Stars: 6, p2Stars: 2 });
});

it('win p2: p1=4, p2=6 → win p2', async () => {
  mockGet.mockImplementation(async (key: string) => {
    if (key === 'battle:b1:stars:p1') return '4';
    if (key === 'battle:b1:stars:p2') return '6';
    return null;
  });
  const result = await checkWinCondition('b1');
  expect(result).toEqual({ status: 'win', winnerSide: 'p2', p1Stars: 4, p2Stars: 6 });
});

it('draw: p1=6, p2=6 → draw', async () => {
  mockGet.mockImplementation(async (key: string) => {
    if (key === 'battle:b1:stars:p1') return '6';
    if (key === 'battle:b1:stars:p2') return '6';
    return null;
  });
  const result = await checkWinCondition('b1');
  expect(result).toEqual({ status: 'draw', p1Stars: 6, p2Stars: 6 });
});

it('not_over: p1=5, p2=3 → not_over', async () => {
  mockGet.mockImplementation(async (key: string) => {
    if (key === 'battle:b1:stars:p1') return '5';
    if (key === 'battle:b1:stars:p2') return '3';
    return null;
  });
  const result = await checkWinCondition('b1');
  expect(result).toEqual({ status: 'not_over', p1Stars: 5, p2Stars: 3 });
});
```

并修正 `WinCheckResult` 类型（去掉 victoryType 字段）：

```typescript
export type WinCheckResult =
  | { status: 'win'; winnerSide: Side; p1Stars: number; p2Stars: number }
  | { status: 'draw'; p1Stars: number; p2Stars: number }
  | { status: 'not_over'; p1Stars: number; p2Stars: number };
```

- [ ] **Step 3: 运行测试验证失败**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/services/battleOutcomeService.test.ts -t "checkWinCondition"
```

Expected: 4 tests FAIL

- [ ] **Step 4: 实现 `checkWinCondition`**

在 `backend/src/services/battleOutcomeService.ts` 替换 `checkWinCondition` 函数：

```typescript
/**
 * T052 §3.1: 检查胜利条件
 *
 * 读取 stars:p1/p2，判定 win/draw/not_over。
 * victoryType 由调用方根据上下文（kill or base）推断。
 *
 * @param battleId battle id
 * @returns WinCheckResult
 */
export async function checkWinCondition(battleId: string): Promise<WinCheckResult> {
  const [p1Raw, p2Raw] = await Promise.all([
    redisClient.get(starsKey(battleId, 'p1')),
    redisClient.get(starsKey(battleId, 'p2')),
  ]);
  const p1Stars = p1Raw === null ? 0 : parseInt(p1Raw, 10);
  const p2Stars = p2Raw === null ? 0 : parseInt(p2Raw, 10);

  const p1Wins = p1Stars >= WIN_THRESHOLD;
  const p2Wins = p2Stars >= WIN_THRESHOLD;
  if (p1Wins && p2Wins) {
    return { status: 'draw', p1Stars, p2Stars };
  }
  if (p1Wins) {
    return { status: 'win', winnerSide: 'p1', p1Stars, p2Stars };
  }
  if (p2Wins) {
    return { status: 'win', winnerSide: 'p2', p1Stars, p2Stars };
  }
  return { status: 'not_over', p1Stars, p2Stars };
}
```

- [ ] **Step 5: 运行测试验证通过**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/services/battleOutcomeService.test.ts -t "checkWinCondition"
```

Expected: 4 tests PASS

- [ ] **Step 6: 提交**

```bash
cd /home/lovept/PtIDLE
git add backend/src/services/battleOutcomeService.ts backend/src/services/battleOutcomeService.test.ts
git commit -m "feat(outcome): T052 checkWinCondition with 4 unit tests"
```

---

## Task 6: recordVictory 实现（TDD）

**Files:**
- Modify: `backend/src/services/battleOutcomeService.ts` (替换 `recordVictory` 函数)
- Modify: `backend/src/services/battleOutcomeService.test.ts` (追加 4 个 cases)
- Modify: `backend/src/socket/battleStateBroadcaster.ts` (添加 `broadcastBattleEnd` 占位)

- [ ] **Step 1: 在 battleStateBroadcaster.ts 添加 broadcastBattleEnd 占位**

在 `backend/src/socket/battleStateBroadcaster.ts` 末尾追加：

```typescript
/**
 * T052: 广播战斗结束事件（server → both）
 *
 * payload 字段：
 *   - battleId
 *   - winnerUserId: string | null  (平局时 null)
 *   - winnerSide: 'p1' | 'p2' | null  (平局时 null)
 *   - victoryType: 'kill_threshold' | 'base_threshold' | 'draw'
 *   - p1Stars: number
 *   - p2Stars: number
 *   - p1UserId: string
 *   - p2UserId: string
 *
 * 调用方：battleOutcomeService.recordVictory
 */
export async function broadcastBattleEnd(
  io: IOServer,
  battleId: string,
  payload: {
    winnerUserId: string | null;
    winnerSide: 'p1' | 'p2' | null;
    victoryType: 'kill_threshold' | 'base_threshold' | 'draw';
    p1Stars: number;
    p2Stars: number;
    p1UserId: string;
    p2UserId: string;
  }
): Promise<void> {
  io.to(`battle:${battleId}`).emit('battle:end', {
    battleId,
    winnerUserId: payload.winnerUserId,
    winnerSide: payload.winnerSide,
    victoryType: payload.victoryType,
    p1Stars: payload.p1Stars,
    p2Stars: payload.p2Stars,
    p1UserId: payload.p1UserId,
    p2UserId: payload.p2UserId,
  });
}
```

- [ ] **Step 2: 写测试 — recordVictory 4 个 case**

在 `backend/src/services/battleOutcomeService.test.ts` 追加 mocks（顶部）+ describe 块：

**顶部追加 mock**（在 existing mock 块内追加）：

```typescript
// 顶部 mocks 区域追加：
const mockFinishSession = jest.fn();
const mockBroadcastBattleEnd = jest.fn();
const mockBroadcastBasesState = jest.fn();

jest.mock('./battleSessionService', () => ({
  finishSession: mockFinishSession,
}));

jest.mock('../socket/battleStateBroadcaster', () => ({
  broadcastBattleEnd: mockBroadcastBattleEnd,
  broadcastBasesState: mockBroadcastBasesState,
}));
```

**追加 describe**：

```typescript
import { recordVictory } from './battleOutcomeService';
import type { Server as IOServer } from 'socket.io';

function createMockIO(): IOServer {
  return {
    to: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    emit: jest.fn(),
  } as unknown as IOServer;
}

describe('recordVictory', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockFinishSession.mockResolvedValue({ success: true, state: undefined as any });
    mockBroadcastBattleEnd.mockResolvedValue(undefined);
  });

  it('win: DB UPDATE winner + status=finished + finishSession + broadcast', async () => {
    mockExecuteDb.mockResolvedValue({ rowCount: 1 });
    // winner_player_id 需要从 player 查询（p1 → userId）
    mockQuery.mockResolvedValue([
      { id: 'player-1', user_id: 'u1' },
      { id: 'player-2', user_id: 'u2' },
    ]);

    const io = createMockIO();
    await recordVictory(io, 'b1', {
      status: 'win',
      winnerSide: 'p1',
      p1Stars: 6,
      p2Stars: 2,
    });

    // DB UPDATE
    expect(mockExecuteDb).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE battles SET'),
      expect.arrayContaining(['p1', 'kill_threshold', 'b1'])
    );
    // finishSession
    expect(mockFinishSession).toHaveBeenCalledWith('b1');
    // broadcast
    expect(mockBroadcastBattleEnd).toHaveBeenCalledWith(
      io,
      'b1',
      expect.objectContaining({
        winnerUserId: 'u1',
        winnerSide: 'p1',
        victoryType: 'kill_threshold',
        p1Stars: 6,
        p2Stars: 2,
      })
    );
  });

  it('win via base: victoryType=base_threshold', async () => {
    mockExecuteDb.mockResolvedValue({ rowCount: 1 });
    mockQuery.mockResolvedValue([
      { id: 'player-1', user_id: 'u1' },
      { id: 'player-2', user_id: 'u2' },
    ]);

    const io = createMockIO();
    await recordVictory(io, 'b1', {
      status: 'win',
      winnerSide: 'p2',
      p1Stars: 4,
      p2Stars: 6,
    }, 'base');  // ★ 显式传 source='base'

    expect(mockBroadcastBattleEnd).toHaveBeenCalledWith(
      io,
      'b1',
      expect.objectContaining({
        winnerUserId: 'u2',
        winnerSide: 'p2',
        victoryType: 'base_threshold',
      })
    );
  });

  it('draw: winnerUserId=null, winnerSide=null, victoryType=draw', async () => {
    mockExecuteDb.mockResolvedValue({ rowCount: 1 });
    mockQuery.mockResolvedValue([
      { id: 'player-1', user_id: 'u1' },
      { id: 'player-2', user_id: 'u2' },
    ]);

    const io = createMockIO();
    await recordVictory(io, 'b1', {
      status: 'draw',
      p1Stars: 6,
      p2Stars: 6,
    });

    expect(mockExecuteDb).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE battles SET'),
      expect.arrayContaining([null, 'draw', 'b1'])
    );
    expect(mockBroadcastBattleEnd).toHaveBeenCalledWith(
      io,
      'b1',
      expect.objectContaining({
        winnerUserId: null,
        winnerSide: null,
        victoryType: 'draw',
      })
    );
  });

  it('finishSession 失败: 仍 broadcast (best-effort, 不 throw)', async () => {
    mockExecuteDb.mockResolvedValue({ rowCount: 1 });
    mockQuery.mockResolvedValue([
      { id: 'player-1', user_id: 'u1' },
      { id: 'player-2', user_id: 'u2' },
    ]);
    mockFinishSession.mockResolvedValue({ success: false, error: 'test' });

    const io = createMockIO();
    await expect(
      recordVictory(io, 'b1', {
        status: 'win',
        winnerSide: 'p1',
        p1Stars: 6,
        p2Stars: 2,
      })
    ).resolves.not.toThrow();

    expect(mockBroadcastBattleEnd).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: 修正 recordVictory 签名 + 实现**

**修正类型定义**（`battleOutcomeService.ts` 顶部）：

```typescript
export type RecordVictoryOutcome = Extract<WinCheckResult, { status: 'win' | 'draw' }>;

/**
 * recordVictory 完整签名：接受 source 参数推断 victoryType
 */
export async function recordVictory(
  io: IOServer,
  battleId: string,
  outcome: RecordVictoryOutcome,
  source: StarSource = 'kill'  // 默认 kill（applyKillStars 调用）
): Promise<void>;
```

**实现**：

```typescript
/**
 * T052 §3.1: 记录胜利
 *
 * 1. UPDATE battles SET winner_player_id, victory_type, status='finished', finished_at=NOW()
 * 2. finishSession (best-effort)
 * 3. broadcastBattleEnd
 *
 * @param io IOServer
 * @param battleId
 * @param outcome checkWinCondition 返回的 win/draw
 * @param source 'kill' | 'base' 推断 victoryType（仅 win 时使用）
 */
export async function recordVictory(
  io: IOServer,
  battleId: string,
  outcome: RecordVictoryOutcome,
  source: StarSource = 'kill'
): Promise<void> {
  // 1. 查 player1/2 → userId 映射
  const playerRows = await query<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM players WHERE id IN (
       SELECT player1_id FROM battles WHERE id = $1
       UNION
       SELECT player2_id FROM battles WHERE id = $1
     )`,
    [battleId]
  );
  const p1 = playerRows.find((r) => r.id === (await getPlayerId(battleId, 'p1')));
  const p2 = playerRows.find((r) => r.id === (await getPlayerId(battleId, 'p2')));

  let winnerUserId: string | null = null;
  let winnerSide: 'p1' | 'p2' | null = null;
  let victoryType: VictoryType;

  if (outcome.status === 'win') {
    winnerSide = outcome.winnerSide;
    winnerUserId = outcome.winnerSide === 'p1' ? p1?.user_id ?? null : p2?.user_id ?? null;
    victoryType = source === 'base' ? 'base_threshold' : 'kill_threshold';
  } else {
    victoryType = 'draw';
  }

  // 2. UPDATE battles
  await execute(
    `UPDATE battles
     SET winner_player_id = $1,
         victory_type = $2,
         status = 'finished',
         finished_at = NOW(),
         updated_at = NOW()
     WHERE id = $3`,
    [winnerSide === 'p1' ? p1?.id : (winnerSide === 'p2' ? p2?.id : null), victoryType, battleId]
  );

  // 3. finishSession (best-effort)
  try {
    await finishSession(battleId);
  } catch (err) {
    console.error(`[T052] recordVictory: finishSession failed: battleId=${battleId}`, err);
  }

  // 4. broadcast
  await broadcastBattleEnd(io, battleId, {
    winnerUserId,
    winnerSide,
    victoryType,
    p1Stars: outcome.p1Stars,
    p2Stars: outcome.p2Stars,
    p1UserId: p1?.user_id ?? '',
    p2UserId: p2?.user_id ?? '',
  });
}

/**
 * 内部 helper: 查 player1_id / player2_id
 */
async function getPlayerId(battleId: string, side: 'p1' | 'p2'): Promise<string | null> {
  const col = side === 'p1' ? 'player1_id' : 'player2_id';
  const row = await query<{ [k: string]: string }>(
    `SELECT ${col} AS pid FROM battles WHERE id = $1`,
    [battleId]
  );
  return row[0]?.pid ?? null;
}
```

- [ ] **Step 4: 运行测试验证失败 → 实现 → 验证通过**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/services/battleOutcomeService.test.ts -t "recordVictory"
```

Expected: 4 tests PASS

- [ ] **Step 5: 提交**

```bash
cd /home/lovept/PtIDLE
git add backend/src/services/battleOutcomeService.ts backend/src/services/battleOutcomeService.test.ts backend/src/socket/battleStateBroadcaster.ts
git commit -m "feat(outcome): T052 recordVictory + broadcastBattleEnd with 4 unit tests"
```

---

## Task 7: battleStateBroadcaster 加 stars/bases 字段 + broadcastBasesState

**Files:**
- Modify: `backend/src/socket/battleStateBroadcaster.ts`
- Modify: `backend/src/socket/battleStateBroadcaster.test.ts`

- [ ] **Step 1: 修改 BoardStateEvent 接口 + buildBoardState 读 stars/bases**

在 `backend/src/socket/battleStateBroadcaster.ts` 顶部修改 `BoardStateEvent`：

```typescript
/**
 * `battle:state:board` payload —— 整盘状态,无隐私,推 battle room
 * T052: 增量字段 p1Stars/p2Stars/bases
 */
export interface BoardStateEvent {
  battleId: string;
  currentRound: number;
  currentStep: number;
  currentPhase: string;
  currentActorId: string | null;
  characters: CharacterStatus[];
  // ★ T052 新增
  p1Stars: number;
  p2Stars: number;
  bases: {
    '3,3': 'p1' | 'p2' | 'neutral';
    '6,6': 'p1' | 'p2' | 'neutral';
  };
}
```

修改 `buildBoardState` 函数（追加 stars + bases 读）：

```typescript
export async function buildBoardState(
  battleId: string
): Promise<{
  board: BoardStateEvent;
  characters: Array<{
    characterId: string;
    playerId: string;
    userId: string;
    profession: string;
    name: string;
  }>;
}> {
  const [session, characters, p1StarsRaw, p2StarsRaw, basesRaw] = await Promise.all([
    getDbSessionState(battleId),
    listCharactersInBattle(battleId),
    redisClient.get(`battle:${battleId}:stars:p1`),  // ★ 新增
    redisClient.get(`battle:${battleId}:stars:p2`),  // ★ 新增
    redisClient.get(`battle:${battleId}:bases`),     // ★ 新增
  ]);
  if (!session) {
    throw new Error(`buildBoardState: battle not found: ${battleId}`);
  }

  const statusResults = await Promise.all(
    characters.map((c) => getCharacterStatus(battleId, c.characterId, session.currentRound))
  );

  const statusList = statusResults.filter((s): s is CharacterStatus => s !== null);

  // ★ 解析 stars + bases
  const p1Stars = p1StarsRaw === null ? 0 : parseInt(p1StarsRaw, 10);
  const p2Stars = p2StarsRaw === null ? 0 : parseInt(p2StarsRaw, 10);
  const bases = basesRaw === null
    ? { '3,3': 'neutral' as const, '6,6': 'neutral' as const }
    : JSON.parse(basesRaw);

  return {
    board: {
      battleId,
      currentRound: session.currentRound,
      currentStep: session.currentStep,
      currentPhase: session.currentPhase,
      currentActorId: session.currentActorId,
      characters: statusList,
      p1Stars,    // ★ 新增
      p2Stars,    // ★ 新增
      bases,      // ★ 新增
    },
    characters,
  };
}
```

**在文件顶部追加 import**：

```typescript
import { redisClient } from '../config/redis';
```

- [ ] **Step 2: 添加 broadcastBasesState 函数**

在 `broadcastBattleEnd` 之前追加：

```typescript
/**
 * T052: 广播据点状态变化（server → both）
 *
 * payload 字段：
 *   - battleId
 *   - bases: { '3,3': 'p1' | 'p2' | 'neutral', '6,6': ... }
 *
 * 调用方：battleOutcomeService.applyBaseStars
 */
export async function broadcastBasesState(
  io: IOServer,
  battleId: string,
  bases: { '3,3': 'p1' | 'p2' | 'neutral'; '6,6': 'p1' | 'p2' | 'neutral' }
): Promise<void> {
  io.to(`battle:${battleId}`).emit('battle:state:bases', {
    battleId,
    bases,
  });
}
```

- [ ] **Step 3: 在 battleStateBroadcaster.test.ts 顶部追加 mock 与测试**

在 `backend/src/socket/battleStateBroadcaster.test.ts` 顶部 mock block 追加 redis mock：

```typescript
// 顶部 mock 区域追加
const mockRedisGet = jest.fn();
const mockRedisHGetAll = jest.fn();

jest.mock('../config/redis', () => ({
  redisClient: {
    get: mockRedisGet,
    hGetAll: mockRedisHGetAll,
  },
}));
```

并在 beforeEach 加 `mockRedisGet.mockResolvedValue(null)` 默认值。

追加 describe 块（文件末尾）：

```typescript
import { broadcastBasesState, broadcastBattleEnd, buildBoardState } from './battleStateBroadcaster';

describe('T052 broadcaster additions', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    // 默认 redis get 返回 null
    mockRedisGet.mockResolvedValue(null);
    // 重新设置 listCharactersInBattle 默认值
    mockListCharactersInBattle.mockResolvedValue([
      { characterId: 'c1', playerId: 'p1', userId: 'u1', profession: 'warrior', name: 'A' },
    ]);
    mockGetDbSessionState.mockResolvedValue({
      currentRound: 1,
      currentStep: 0,
      currentActorId: 'c1',
      currentPhase: 'move',
    });
  });

  describe('buildBoardState T052 增量字段', () => {
    it('默认值: p1Stars=0, p2Stars=0, bases 全 neutral', async () => {
      mockRedisGet.mockResolvedValue(null);
      mockGetCharacterStatus.mockResolvedValue(null as any);

      const { board } = await buildBoardState('b1');

      expect(board.p1Stars).toBe(0);
      expect(board.p2Stars).toBe(0);
      expect(board.bases).toEqual({ '3,3': 'neutral', '6,6': 'neutral' });
    });

    it('已累加: p1=3, p2=1, bases p1+p2', async () => {
      mockRedisGet.mockImplementation(async (key: string) => {
        if (key === 'battle:b1:stars:p1') return '3';
        if (key === 'battle:b1:stars:p2') return '1';
        if (key === 'battle:b1:bases') return JSON.stringify({ '3,3': 'p1', '6,6': 'p2' });
        return null;
      });
      mockGetCharacterStatus.mockResolvedValue(null as any);

      const { board } = await buildBoardState('b1');

      expect(board.p1Stars).toBe(3);
      expect(board.p2Stars).toBe(1);
      expect(board.bases).toEqual({ '3,3': 'p1', '6,6': 'p2' });
    });
  });

  describe('broadcastBasesState', () => {
    it('happy: 2 据点 p1/p2 → emit battle:state:bases', async () => {
      const io = createMockIO();
      await broadcastBasesState(io, 'b1', { '3,3': 'p1', '6,6': 'p2' });
      expect(io.emit).toHaveBeenCalledWith('battle:state:bases', {
        battleId: 'b1',
        bases: { '3,3': 'p1', '6,6': 'p2' },
      });
    });

    it('neutral: 2 据点 neutral', async () => {
      const io = createMockIO();
      await broadcastBasesState(io, 'b1', { '3,3': 'neutral', '6,6': 'neutral' });
      expect(io.emit).toHaveBeenCalledWith('battle:state:bases', {
        battleId: 'b1',
        bases: { '3,3': 'neutral', '6,6': 'neutral' },
      });
    });
  });

  describe('broadcastBattleEnd', () => {
    it('win: 完整 payload', async () => {
      const io = createMockIO();
      await broadcastBattleEnd(io, 'b1', {
        winnerUserId: 'u1',
        winnerSide: 'p1',
        victoryType: 'kill_threshold',
        p1Stars: 6,
        p2Stars: 2,
        p1UserId: 'u1',
        p2UserId: 'u2',
      });
      expect(io.emit).toHaveBeenCalledWith('battle:end', {
        battleId: 'b1',
        winnerUserId: 'u1',
        winnerSide: 'p1',
        victoryType: 'kill_threshold',
        p1Stars: 6,
        p2Stars: 2,
        p1UserId: 'u1',
        p2UserId: 'u2',
      });
    });

    it('draw: winnerUserId=null, winnerSide=null', async () => {
      const io = createMockIO();
      await broadcastBattleEnd(io, 'b1', {
        winnerUserId: null,
        winnerSide: null,
        victoryType: 'draw',
        p1Stars: 6,
        p2Stars: 6,
        p1UserId: 'u1',
        p2UserId: 'u2',
      });
      expect(io.emit).toHaveBeenCalledWith('battle:end', {
        battleId: 'b1',
        winnerUserId: null,
        winnerSide: null,
        victoryType: 'draw',
        p1Stars: 6,
        p2Stars: 6,
        p1UserId: 'u1',
        p2UserId: 'u2',
      });
    });
  });
});

function createMockIO(): IOServer {
  return {
    to: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    emit: jest.fn(),
  } as unknown as IOServer;
}
```

> **注**：原 test 文件已有 `createMockIO` 或等价物，重复定义会冲突。如有则删除末尾的 `function createMockIO()`。

- [ ] **Step 4: 运行测试验证通过**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/socket/battleStateBroadcaster.test.ts
```

Expected: 原有 T047 cases + 新增 5 个 cases 全部 PASS

- [ ] **Step 5: 提交**

```bash
cd /home/lovept/PtIDLE
git add backend/src/socket/battleStateBroadcaster.ts backend/src/socket/battleStateBroadcaster.test.ts
git commit -m "feat(broadcaster): T052 add broadcastBasesState + broadcastBattleEnd + stars/bases fields"
```

---

## Task 8: executeEndStep wire-up（含 preStepAliveMap 快照）

**Files:**
- Modify: `backend/src/services/battleActionService.ts`
- Modify: `backend/src/services/battleActionService.test.ts`

- [ ] **Step 1: 在 battleActionService.test.ts 顶部 mock 补全**

在 `jest.mock('./battleSessionService', ...)` 块追加 `finishSession: jest.fn()`：

```typescript
jest.mock('./battleSessionService', () => ({
  getDbSessionState: jest.fn(),
  completeMovePhase: jest.fn(),
  completePlayPhase: jest.fn(),
  endCurrentStep: jest.fn(),
  activateCurrentUnit: jest.fn(),
  completeDrawPhase: jest.fn(),
  endCurrentRound: jest.fn(),
  finishSession: jest.fn(),  // ★ 新增（T052）
}));
```

新增 mock 块（追加在 professionMechanicService mock 之后）：

```typescript
jest.mock('./battleOutcomeService', () => ({
  applyKillStars: jest.fn(),
  applyBaseStars: jest.fn(),
  checkWinCondition: jest.fn(),
  recordVictory: jest.fn(),
}));
```

新增 import：

```typescript
import { applyKillStars, applyBaseStars, checkWinCondition, recordVictory } from './battleOutcomeService';
import { finishSession } from './battleSessionService';
```

新增 mockFn alias：

```typescript
const mockApplyKillStars = applyKillStars as jest.MockedFunction<typeof applyKillStars>;
const mockApplyBaseStars = applyBaseStars as jest.MockedFunction<typeof applyBaseStars>;
const mockCheckWinCondition = checkWinCondition as jest.MockedFunction<typeof checkWinCondition>;
const mockRecordVictory = recordVictory as jest.MockedFunction<typeof recordVictory>;
const mockFinishSession = finishSession as jest.MockedFunction<typeof finishSession>;
```

在 beforeEach 末尾追加默认 happy path 桩：

```typescript
  // T052 默认 happy path
  mockApplyKillStars.mockResolvedValue({ p1Delta: 0, p2Delta: 0, p1StarsAfter: 0, p2StarsAfter: 0 });
  mockApplyBaseStars.mockResolvedValue({ p1Delta: 0, p2Delta: 0, p1StarsAfter: 0, p2StarsAfter: 0, bases: { '3,3': 'neutral', '6,6': 'neutral' } });
  mockCheckWinCondition.mockResolvedValue({ status: 'not_over', p1Stars: 0, p2Stars: 0 });
  mockRecordVictory.mockResolvedValue(undefined);
  mockFinishSession.mockResolvedValue({ success: true, state: undefined as any });
  // 模拟 pieces HASH 6 角色全 alive
  (redisClient.hGetAll as jest.Mock).mockResolvedValue({
    c1: JSON.stringify({ is_alive: true }),
    c2: JSON.stringify({ is_alive: true }),
    c3: JSON.stringify({ is_alive: true }),
    c4: JSON.stringify({ is_alive: true }),
    c5: JSON.stringify({ is_alive: true }),
    c6: JSON.stringify({ is_alive: true }),
  });
```

- [ ] **Step 2: 写测试 — executeEndStep 触发 T052 wire-up**

在文件末尾追加 describe 块：

```typescript
describe('executeEndStep - T052 wire-up', () => {
  it('should capture preStepAliveMap and call applyKillStars + checkWinCondition', async () => {
    mockGetDbSessionState.mockResolvedValue({
      currentRound: 1,
      currentStep: 0,
      currentActorId: 'c1',
      currentPhase: 'play',
    });

    const { executeEndStep } = await import('./battleActionService');
    const io = createMockIO();

    await executeEndStep(io, 'b1');

    // 验证 preStepAliveMap 传给 applyKillStars
    expect(mockApplyKillStars).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({
        c1: true, c2: true, c3: true, c4: true, c5: true, c6: true,
      })
    );
    // 验证 checkWinCondition 被调
    expect(mockCheckWinCondition).toHaveBeenCalledWith('b1');
    // 默认 not_over → recordVictory 不调
    expect(mockRecordVictory).not.toHaveBeenCalled();
  });

  it('should call recordVictory when checkWinCondition returns win', async () => {
    mockCheckWinCondition.mockResolvedValue({
      status: 'win',
      winnerSide: 'p1',
      p1Stars: 6,
      p2Stars: 2,
    });

    const { executeEndStep } = await import('./battleActionService');
    const io = createMockIO();

    await executeEndStep(io, 'b1');

    expect(mockRecordVictory).toHaveBeenCalledWith(
      io,
      'b1',
      { status: 'win', winnerSide: 'p1', p1Stars: 6, p2Stars: 2 },
      'kill'  // source 默认 kill
    );
  });
});
```

- [ ] **Step 3: 运行测试验证失败**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/services/battleActionService.test.ts -t "T052 wire-up"
```

Expected: 2 tests FAIL（`mockApplyKillStars` 未被调）

- [ ] **Step 4: 在 battleActionService.ts executeEndStep 加 step 0 + step 12 wire-up**

在 `backend/src/services/battleActionService.ts` 顶部追加 import：

```typescript
import { applyKillStars, checkWinCondition, recordVictory } from './battleOutcomeService';
```

**Step 0 加在 executeEndStep 函数最顶部**（在 `// 1. 读 session` 之前）：

```typescript
export async function executeEndStep(
  io: IOServer,
  battleId: string
): Promise<StepEndResult> {
  // 0. ★ T052: 捕获 preStepAliveMap（applyKillStars 步骤 12 比对用）
  //    必须在任何可能改变 is_alive 的副作用之前完成快照
  const characters = await listCharactersInBattle(battleId);
  const preStepAliveMap: Record<string, boolean> = {};
  if (characters.length > 0) {
    const piecesRaw = await redisClient.hGetAll(`battle:${battleId}:pieces`);
    for (const c of characters) {
      const raw = piecesRaw[c.characterId];
      if (raw) {
        preStepAliveMap[c.characterId] = (JSON.parse(raw).is_alive === true);
      }
    }
  }

  // 1. 读 session
  const state = await getDbSessionState(battleId);
  // ... 既有 1-11 步不变 ...

  // 12. ★ T052 wire-up: applyKillStars → checkWinCondition → recordVictory (win/draw)
  const killDelta = await applyKillStars(battleId, preStepAliveMap);
  const winResult = await checkWinCondition(battleId);
  if (winResult.status === 'win' || winResult.status === 'draw') {
    await recordVictory(io, battleId, winResult, 'kill');
  }

  return { success: true, state: finalState };
}
```

- [ ] **Step 5: 运行测试验证通过**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/services/battleActionService.test.ts
```

Expected: 全部测试 PASS（含原有 36 个 + 新增 2 个 T052 wire-up）

- [ ] **Step 6: 提交**

```bash
cd /home/lovept/PtIDLE
git add backend/src/services/battleActionService.ts backend/src/services/battleActionService.test.ts
git commit -m "feat(action): T052 wire applyKillStars in executeEndStep with preStepAliveMap snapshot"
```

---

## Task 9: executeRoundEnd wire-up

**Files:**
- Modify: `backend/src/services/battleActionService.ts`
- Modify: `backend/src/services/battleActionService.test.ts`

- [ ] **Step 1: 写测试 — executeRoundEnd 触发 T052 wire-up**

在 `battleActionService.test.ts` 末尾追加 describe 块：

```typescript
describe('executeRoundEnd - T052 wire-up', () => {
  it('should call applyBaseStars + checkWinCondition', async () => {
    const { executeRoundEnd } = await import('./battleActionService');
    const io = createMockIO();

    await executeRoundEnd(io, 'b1', {
      battleId: 'b1',
      currentRound: 1,
      currentStep: 5,
      currentPhase: 'end_round',
      currentActorId: 'c6',
      activationOrder: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'],
      player1Chars: ['c1', 'c2', 'c3'],
      player2Chars: ['c4', 'c5', 'c6'],
      updatedAt: new Date().toISOString(),
    });

    expect(mockApplyBaseStars).toHaveBeenCalledWith('b1');
    expect(mockCheckWinCondition).toHaveBeenCalledWith('b1');
    expect(mockRecordVictory).not.toHaveBeenCalled(); // not_over 默认
  });

  it('should call recordVictory with source=base when win', async () => {
    mockCheckWinCondition.mockResolvedValue({
      status: 'win',
      winnerSide: 'p2',
      p1Stars: 4,
      p2Stars: 6,
    });

    const { executeRoundEnd } = await import('./battleActionService');
    const io = createMockIO();

    await executeRoundEnd(io, 'b1', {
      battleId: 'b1',
      currentRound: 1,
      currentStep: 5,
      currentPhase: 'end_round',
      currentActorId: 'c6',
      activationOrder: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'],
      player1Chars: ['c1', 'c2', 'c3'],
      player2Chars: ['c4', 'c5', 'c6'],
      updatedAt: new Date().toISOString(),
    });

    expect(mockRecordVictory).toHaveBeenCalledWith(
      io,
      'b1',
      { status: 'win', winnerSide: 'p2', p1Stars: 4, p2Stars: 6 },
      'base'  // ★ source='base'
    );
  });

  it('should NOT call applyKillStars (only last step executeEndStep handles it)', async () => {
    const { executeRoundEnd } = await import('./battleActionService');
    const io = createMockIO();

    await executeRoundEnd(io, 'b1', {
      battleId: 'b1',
      currentRound: 1,
      currentStep: 5,
      currentPhase: 'end_round',
      currentActorId: 'c6',
      activationOrder: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'],
      player1Chars: ['c1', 'c2', 'c3'],
      player2Chars: ['c4', 'c5', 'c6'],
      updatedAt: new Date().toISOString(),
    });

    expect(mockApplyKillStars).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/services/battleActionService.test.ts -t "executeRoundEnd - T052"
```

Expected: 3 tests FAIL

- [ ] **Step 3: 在 battleActionService.ts executeRoundEnd 加 step 6 wire-up**

在 `backend/src/services/battleActionService.ts` 顶部追加 import（如尚未）：

```typescript
import { applyBaseStars, checkWinCondition, recordVictory } from './battleOutcomeService';
```

在 `executeRoundEnd` 函数末尾追加：

```typescript
  // 6. ★ T052 wire-up: applyBaseStars → checkWinCondition → recordVictory (win/draw)
  const baseDelta = await applyBaseStars(battleId);
  const winResult = await checkWinCondition(battleId);
  if (winResult.status === 'win' || winResult.status === 'draw') {
    await recordVictory(io, battleId, winResult, 'base');
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/services/battleActionService.test.ts
```

Expected: 全部 PASS（含 Task 8 的 2 + Task 9 的 3 = 5 个新 T052 wire-up cases）

- [ ] **Step 5: 提交**

```bash
cd /home/lovept/PtIDLE
git add backend/src/services/battleActionService.ts backend/src/services/battleActionService.test.ts
git commit -m "feat(action): T052 wire applyBaseStars in executeRoundEnd"
```

---

## Task 10: battleInitializationService 加 5 个 SET 键

**Files:**
- Modify: `backend/src/services/battleInitializationService.ts`
- Modify: `backend/src/services/battleInitializationService.test.ts` (如有)

- [ ] **Step 1: 查看 battleInitializationService 既有初始化逻辑**

```bash
cd /home/lovept/PtIDLE/backend
cat src/services/battleInitializationService.ts | head -100
```

定位 T048 战场初始化时初始化 Redis 键的位置（搜索 `redisClient.set`）。

- [ ] **Step 2: 追加 5 个 SET 键**

在 T048 初始化末尾追加（紧跟最后一个 SET 之后）：

```typescript
// ★ T052: 初始化胜利进度相关键
await redisClient.set(`battle:${battleId}:stars:p1`, '0');
await redisClient.set(`battle:${battleId}:stars:p2`, '0');
await redisClient.set(`battle:${battleId}:alive_p1`, '3');
await redisClient.set(`battle:${battleId}:alive_p2`, '3');
await redisClient.set(
  `battle:${battleId}:bases`,
  JSON.stringify({ '3,3': 'neutral', '6,6': 'neutral' })
);
```

- [ ] **Step 3: 运行测试验证**

```bash
cd /home/lovept/PtIDLE/backend
npx jest src/services/battleInitializationService.test.ts
```

Expected: 全部 PASS（如有相关 test 验证 SET 调用，需更新 mock 期望；若无 test 覆盖此 SET，PASS 即通过）

- [ ] **Step 4: 提交**

```bash
cd /home/lovept/PtIDLE
git add backend/src/services/battleInitializationService.ts backend/src/services/battleInitializationService.test.ts
git commit -m "feat(init): T052 init stars/alive/bases Redis keys in battle initialization"
```

---

## Task 11: 集成测试 + 文档更新（最终验证）

**Files:**
- Modify: `memory-bank/progress.md`
- Modify: `memory-bank/architecture.md`
- Modify: `memory-bank/history.md`

- [ ] **Step 1: 运行全量测试套件**

```bash
cd /home/lovept/PtIDLE/backend
npx jest
```

Expected: 全部 PASS（除已存在的 5 个 pre-existing authController failures 之外）

- [ ] **Step 2: 更新 progress.md**

在 `memory-bank/progress.md` 末尾的「已完成」表格追加：

```markdown
| T052 | 实现胜负判定逻辑（kill star + base star + 6 阈值胜利 + 平局） | 2026-06-17 |
```

- [ ] **Step 3: 更新 architecture.md 加 T052 章节**

在 `memory-bank/architecture.md` 末尾追加 T052 章节（约 100 行）：

```markdown
## T052 胜负判定

### 胜利规则
- 击杀累计（每步）+ 据点占领累计（每轮）两条独立路径
- 任一方累计 ≥6 star 即获胜（双方同时 6 视为平局）
- 胜利类型: kill_threshold / base_threshold / draw

### 数据模型
- Redis 临时态: `battle:{id}:stars:p1/p2` (STRING), `battle:{id}:bases` (JSON), `battle:{id}:alive_p1/p2` (STRING)
- DB 持久化: battles 表加 p1_stars, p2_stars, winner_player_id, victory_type (migration 009)

### 据点配置
- 固定坐标: (3,3) + (6,6) —— 9x9 棋盘对角线
- 占领范围: Chebyshev 距离 ≤2 (5x5 区域)
- 判定规则: 范围内 alive 棋子数 p1 > p2 → 占领

### 模块设计
- `src/services/battleOutcomeService.ts` 新建 (~250 行)
  - applyKillStars: preStepAliveMap 快照 + HGetAll 比对 + 累加
  - applyBaseStars: 扫描 2 据点 + Chebyshev 判定 + 累加
  - checkWinCondition: 读 stars:p1/p2 + 判定 win/draw/not_over
  - recordVictory: DB UPDATE + finishSession + broadcast

### 触发流程
- T051 executeEndStep 步骤 0: 读 preStepAliveMap 快照
- T051 executeEndStep 步骤 12: applyKillStars + checkWinCondition + recordVictory (win/draw)
- T051 executeRoundEnd 步骤 6: applyBaseStars + checkWinCondition + recordVictory (win/draw)

### WS 事件
- 新增 `battle:state:bases` (server → both): 推据点占领变化
- 新增 `battle:end` (server → both): 推战斗结束 (win/draw + winner + victoryType)
- 增量字段: `battle:state:board` 加 p1Stars / p2Stars / bases (前端无需订阅额外事件)

### T056 整合
- applyDamage 统一入口应包含「击杀 → applyKillStars 触发」链路
- 真实 HP 扣减在 T056 实现后，本任务的 preStepAliveMap 比对继续生效

### 测试
- battleOutcomeService.test.ts: 18 cases
- battleActionService.test.ts: +5 cases (T052 wire-up)
- battleStateBroadcaster.test.ts: +5 cases (broadcastBasesState / broadcastBattleEnd / board stars 字段)
```

- [ ] **Step 4: 更新 history.md 加 T052 日志**

在 `memory-bank/history.md` 末尾追加：

```markdown
## 2026-06-17 - 任务：T052 胜负判定

### Prompt
实现 3v3 战棋的胜负判定系统 —— 击杀累计（每步）+ 据点占领累计（每轮）两条独立路径，任一方 6 star 获胜（双方同时 6 平局）

### 思考
- 独立 service (battleOutcomeService) 而非塞进 battleActionService —— 单一职责 + T056 整合预留
- applyKillStars 用 preStepAliveMap 快照比对（executeEndStep 步骤 0 采集），避免 T049/T050 内部已变更 is_alive 难追踪
- checkWinCondition 只判 win/draw/not_over，victoryType 由调用方按 source (kill/base) 推断
- recordVictory 接受 source 参数，内部推 victoryType
- battle:state:board 必加 p1Stars/p2Stars/bases 字段，前端无需订阅额外事件

### 意外
- preStepAliveMap 必须在 executeRoundEnd (burn tick) 之前采集，因此放步骤 0 而非步骤 12 之前
- recordVictory 需要查 players 表拿 userId 映射 (winnerSide → userId)，比预期多一个 DB 调用
- checkWinCondition 不带 victoryType 字段（之前 spec 设计多余），简化后由 recordVictory 推断

### 范围外
- T053 卡牌消耗
- T054 对战结算
- T056 applyDamage 统一
```

- [ ] **Step 5: 提交**

```bash
cd /home/lovept/PtIDLE
git add memory-bank/progress.md memory-bank/architecture.md memory-bank/history.md
git commit -m "docs: T052 progress + architecture + history update"
```

---

## Task 12: 推送到远端

**Files:** 无

- [ ] **Step 1: 验证 master 分支与远端同步**

```bash
cd /home/lovept/PtIDLE
git status
git log --oneline -12
```

Expected: 11 commits ahead (Task 1-11)，无未提交修改

- [ ] **Step 2: 推送到远端**

```bash
cd /home/lovept/PtIDLE
git push origin master
```

Expected: 11 commits pushed, 0 conflicts

- [ ] **Step 3: 验证推送成功**

```bash
cd /home/lovept/PtIDLE
git status
```

Expected: `Your branch is up to date with 'origin/master'`

---

## Self-Review Notes (post-writing)

**Spec coverage check:**
- §1 胜利规则 → Task 3-5 (applyKillStars/applyBaseStars/checkWinCondition) ✓
- §2 数据模型 → Task 1 (migration 009) + Task 2 (Redis helpers) + Task 10 (init SET) ✓
- §3 模块设计 → Task 2-6 (skeleton + 4 functions) + Task 6 (recordVictory) ✓
- §3.2 executeEndStep wire-up → Task 8 (step 0 + step 12) ✓
- §3.2 executeRoundEnd wire-up → Task 9 (step 6) ✓
- §3.3 broadcastBasesState + broadcastBattleEnd → Task 6 (end stub) + Task 7 (full impl) ✓
- §3.5 battleInitializationService → Task 10 ✓
- §3 BoardStateEvent fields → Task 7 ✓
- §7 测试设计 → Task 3-9 各 task 自带单测 ✓
- §10 范围外 → 不做（明确文档化）✓

**Placeholder scan:** 无 TBD/TODO/FIXME

**Type consistency:**
- `applyKillStars(battleId, preStepAliveMap)` — Task 3 定义，Task 8 调用 ✓
- `applyBaseStars(battleId)` — Task 4 定义，Task 9 调用 ✓
- `checkWinCondition(battleId)` — Task 5 定义，Task 8/9 调用 ✓
- `recordVictory(io, battleId, outcome, source='kill')` — Task 6 定义，Task 8 (source='kill') / Task 9 (source='base') 调用 ✓
- `broadcastBasesState(io, battleId, bases)` — Task 7 定义，Task 4/9 调用 ✓
- `broadcastBattleEnd(io, battleId, payload)` — Task 6 stub + Task 7 完整实现，Task 6 recordVictory 调用 ✓
- BoardStateEvent.p1Stars/p2Stars/bases — Task 7 定义，Task 7 buildBoardState 实现 ✓

---

*Plan 版本：v1.0*
*最后更新：2026-06-17*