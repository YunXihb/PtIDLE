# T052 胜负判定 — 设计文档

> **For agentic workers:** This is a design document. Implementation plan will be created after spec approval.

**Goal:** 在 3v3 战棋对战中实现基于「击杀累计」+「据点占领累计」两条独立路径的胜利判定系统。每名玩家从 0/6 开始积累 star：①在每一步结束时（T051 `executeEndStep`），若本步造成对方棋子 HP≤0（由 burn 触发的死亡也计入），击杀方立即 +1 star；②在每轮结束时（T051 `executeRoundEnd`），结算棋盘上两个固定据点（坐标 (3,3) 与 (6,6)，Chebyshev 距离 ≤2 的 5×5 范围）的占领权，一方占多数据点则占领方 +1 star；任一方累计 star ≥6 即获胜，立即结束战斗（`finishSession` + 持久化 winner_player_id / victory_type + 广播 `battle:end`）。

**Architecture:** 新增 `src/services/battleOutcomeService.ts` 提供 4 个公共函数（`applyKillStars`、`applyBaseStars`、`checkWinCondition`、`recordVictory`）。两个 T051 orchestrator（`executeEndStep` 与 `executeRoundEnd`）在「副作用 commit 之后 / broadcast 之前」各插入一次调用，分别处理击杀 star 和据点 star。新增一个 WS 事件 `battle:state:bases`（每次据点状态变化时推，含 2 个据点的占领方）以及一个终态事件 `battle:end`（胜利时推，含 winner + stars + victoryType）。DB 层加 migration 009 给 `battles` 表新增 4 列：`p1_stars`、`p2_stars`、`winner_player_id`、`victory_type`（`kill_threshold` | `base_threshold` | `draw`）。

**Tech Stack:** Node.js + TypeScript + Express + Socket.io + PostgreSQL + Redis（v4 client）+ Jest + ts-jest

**Spec:** 依赖 T033（棋盘坐标）、T034（移动判定）、T035（攻击判定）、T036（回合流程 + snake draft + finishSession）、T037（抽牌）、T039-T041（职业机制，含 mage burn）、T048（战场初始化 + 棋子放置 + is_alive 维护）、T051（executeEndStep / executeRoundEnd orchestrator + tickBurnDamageOnTarget）

---

## 1. 胜利规则

### 1.1 三条独立路径

```
┌────────────────┐    ┌────────────────┐    ┌────────────────┐
│  路径 A: 击杀   │    │ 路径 B: 据点    │    │ 路径 C: 平局   │
│  (kill stars)  │    │ (base stars)  │    │   (draw)      │
└────────┬───────┘    └────────┬───────┘    └────────┬───────┘
         │                     │                     │
         ▼                     ▼                     ▼
  每步结束：          每轮结束：              每轮结束额外检查：
  击杀 1 敌方棋子    占领 1 个据点           双方都达成 6 star
  → +1 star          → +1 star              视为平局（victory_type='draw'）
                                         → 记录但不广播 winner
```

**三条路径独立**：击杀 star 和据点 star 都计入同一方的 star 计数。当任意一方 `p1_stars >= 6` 或 `p2_stars >= 6`，立即触发胜利流程（路径 A 或 B）。当双方**在同一个 `executeRoundEnd` 调用中**都恰好达到 6（如 (5+1) vs (5+1)）→ 平局。

### 1.2 击杀 star 详细规则

| 维度 | 规则 |
|------|------|
| 触发时机 | 每步结束（T051 `executeEndStep`），在所有副作用完成后、broadcast 之前 |
| 检测方式 | 「本步内 is_alive 从 true → false 的对方棋子」清单 |
| 加星对象 | 击杀方（被击杀棋子的 `player_id` 的**对方**） |
| burn 击杀 | T051 引入的 `tickBurnDamageOnTarget` 触发的死亡同样计入 |
| 多次击杀 | 单步内可能 0/1/2/3 次击杀（如 AOE 击中多个目标），按次数累加 |
| 自伤 | 不存在：T056 范围内的真伤，AOE 不打自己方 |

**「is_alive 从 true → false」的定义**：调用 `battleOutcomeService.applyKillStars` 之前从 pieces HASH 读所有对方棋子的 `is_alive`，之后再次读，比较 `wasAlive=true AND nowAlive=false` 的角色。即：捕获本步的「死亡事件」。

### 1.3 据点 star 详细规则

| 维度 | 规则 |
|------|------|
| 触发时机 | 每轮结束（T051 `executeRoundEnd`），在所有副作用完成后、broadcast 之前 |
| 据点坐标 | 固定 (3,3) 与 (6,6) —— 9×9 棋盘的对角线上，间距 3 格 |
| 占领范围 | Chebyshev 距离 ≤ 2（5×5 正方形区域）—— 共 25 个格子 |
| 占领判定 | 在范围内：p1 alive 棋子 > p2 alive 棋子 → 占领；反之同理 |
| 平局 | 范围内 p1 alive = p2 alive → 该据点「中立」，本轮不产生 star |
| 加星对象 | 占领该据点的 player（p1 或 p2） |
| 多次占领 | 2 个据点独立判定，p1 可能 (0/1/2) 占，p2 同理 |

**Chebyshev 距离定义**：`max(|x1-x2|, |y1-y2|)`。在 (3,3) 周围 Chebyshev ≤2 等价于 x∈[1,5] 与 y∈[1,5] 的 5×5 区域。

### 1.4 胜利判定与结束

```
executeEndStep (每步)
  → applyKillStars → checkWinCondition?
      → 若 win → recordVictory → finishSession → broadcast('battle:end')
      → 若未 win → 不做处理（继续常规 broadcast）

executeRoundEnd (每轮)
  → applyBaseStars → checkWinCondition?
      → 若 win → recordVictory → finishSession → broadcast('battle:end')
      → 若 draw (双方同时 6) → recordDraw → finishSession → broadcast('battle:end', type='draw')
      → 若未 win → applyKillStars? (NO —— 每轮结束时不再检测击杀) + 不做处理
```

**关键决策：每轮结束时是否还检测击杀？** —— 不。每轮结束时 `applyKillStars` 只在 `executeEndStep` 调用一次（last step），确保单次死亡只计一次 star。

### 1.5 胜利条件示例

| 场景 | 期望结果 |
|------|----------|
| 玩家 A 第 3 步击杀玩家 B 第 2 个棋子 → p1_stars=1 | 继续 |
| 玩家 A 第 5 步击杀玩家 B 第 6 个棋子 → p1_stars=6 | A 胜利（victory_type='kill_threshold'） |
| 玩家 A 占据 (3,3) 据点 → p1_stars=1；占据 (6,6) 据点 → p1_stars=2；击杀 4 个 → p1_stars=6 | A 胜利（victory_type='kill_threshold'，注：type 取实际触发 6 star 的路径） |
| p1_stars=5，p2_stars=5；执行 executeRoundEnd 时 p1 占领 (3,3) → p1_stars=6，p2 占领 (6,6) → p2_stars=6 | 平局（victory_type='draw'），双方均不获胜 |
| p1 长期占 (3,3) 据点（每轮 +1）→ p1_stars=6 | A 胜利（victory_type='base_threshold'） |
| p1_stars=5，p2 进攻烧死 p1 最后一个棋子 → p2_stars=6 | B 胜利（victory_type='kill_threshold'） |

---

## 2. 数据模型

### 2.1 Redis 键（新增 4 个）

| 键名 | 类型 | 用途 |
|------|------|------|
| `battle:{battleId}:stars:p1` | STRING（整数） | p1 当前累计 star（0-6） |
| `battle:{battleId}:stars:p2` | STRING（整数） | p2 当前累计 star（0-6） |
| `battle:{battleId}:bases` | STRING（JSON） | `{ 'base:3,3': 'p1' \| 'p2' \| 'neutral', 'base:6,6': 'p1' \| 'p2' \| 'neutral' }` |
| `battle:{battleId}:alive_p1` | STRING（整数） | p1 当前 alive 棋子数（0-3） |
| `battle:{battleId}:alive_p2` | STRING（整数） | p2 当前 alive 棋子数（0-3） |

> 注：`alive_p1`/`alive_p2` 是辅助键（优化读性能），主源仍是 pieces HASH。T052 写入；T054 战斗结算可能复用。

**键的生命周期**：
- `stars:p1/p2`、`alive_p1/p2`、`bases` —— battle 初始化时（T048）创建，finishSession 后保留（便于查询），DB 持久化为权威
- 初始值：stars=0、alive=3、bases='neutral'

### 2.2 DB 字段（migration 009 — 新建）

```sql
-- 009_t052_victory_stars.sql
ALTER TABLE battles ADD COLUMN IF NOT EXISTS p1_stars INTEGER DEFAULT 0;
ALTER TABLE battles ADD COLUMN IF NOT EXISTS p2_stars INTEGER DEFAULT 0;
ALTER TABLE battles ADD COLUMN IF NOT EXISTS winner_player_id UUID REFERENCES players(id);
ALTER TABLE battles ADD COLUMN IF NOT EXISTS victory_type VARCHAR(20)
  CHECK (victory_type IN ('kill_threshold', 'base_threshold', 'draw'));
COMMENT ON COLUMN battles.p1_stars IS 'p1 累计胜利进度 (0-6)';
COMMENT ON COLUMN battles.p2_stars IS 'p2 累计胜利进度 (0-6)';
COMMENT ON COLUMN battles.winner_player_id IS '胜利玩家 player_id（平局时 NULL）';
COMMENT ON COLUMN battles.victory_type IS '胜利类型: kill_threshold | base_threshold | draw';
```

**主源**：DB 列为权威（T054 战斗结算会再次校验）。Redis 临时态是运行时主存。

### 2.3 数据流向

```
T051 executeEndStep (副作用 commit)
  ↓
battleOutcomeService.applyKillStars(battleId)
  → 读 pieces HASH 前后两次 is_alive 比对
  → 累加 HINCRBY stars:p1 或 stars:p2
  → 同步 DB UPDATE battles SET p1_stars = $1 或 p2_stars = $1
  ↓
checkWinCondition (p1_stars>=6 || p2_stars>=6 || both==6)
  → 若 win → recordVictory (UPDATE winner_player_id + victory_type + status='finished')
            → battleSessionService.finishSession
            → io.to(battle:{id}).emit('battle:end', {...})
```

---

## 3. 模块设计

### 3.1 `src/services/battleOutcomeService.ts`（新建）

**导出函数签名**：

```typescript
import type { Server as IOServer } from 'socket.io';

export type Side = 'p1' | 'p2';
export type VictoryType = 'kill_threshold' | 'base_threshold' | 'draw';

/**
 * 应用击杀 star：在调用前后比对对方棋子的 is_alive，捕获本步新增死亡数。
 * 调用方：T051 executeEndStep（在 broadcast 之前）
 *
 * @param battleId battle id
 * @returns { p1Delta, p2Delta, p1StarsAfter, p2StarsAfter } - 本次累加结果
 */
export async function applyKillStars(
  battleId: string
): Promise<{
  p1Delta: number; // 本步 p1 击杀数（>0 时给 p2 +1 star/次）
  p2Delta: number; // 本步 p2 击杀数（>0 时给 p1 +1 star/次）
  p1StarsAfter: number;
  p2StarsAfter: number;
}>;

/**
 * 应用据点 star：扫描 2 个固定据点（3,3）和（6,6），按 Chebyshev 距离 ≤2 范围
 * 内的 alive 棋子数判定占领方。占领方 +1 star。
 * 调用方：T051 executeRoundEnd（在 broadcast 之前）
 *
 * @param battleId battle id
 * @returns { p1Delta, p2Delta, p1StarsAfter, p2StarsAfter, bases: Record<string, Side | 'neutral'> }
 */
export async function applyBaseStars(
  battleId: string
): Promise<{
  p1Delta: number;
  p2Delta: number;
  p1StarsAfter: number;
  p2StarsAfter: number;
  bases: Record<string, Side | 'neutral'>;
}>;

/**
 * 检查胜利条件：调用方在 applyKillStars 或 applyBaseStars 之后立即调用。
 * - 任一方 stars >= 6 → win
 * - 双方都 >= 6 → draw
 * - 否则 not_over
 *
 * @param battleId battle id
 * @returns discriminated union:
 *   - { status: 'win', winnerSide: 'p1'|'p2', victoryType: 'kill_threshold'|'base_threshold', p1Stars, p2Stars }
 *   - { status: 'draw', p1Stars, p2Stars }
 *   - { status: 'not_over', p1Stars, p2Stars }
 */
export async function checkWinCondition(
  battleId: string
): Promise<
  | { status: 'win'; winnerSide: Side; victoryType: VictoryType; p1Stars: number; p2Stars: number }
  | { status: 'draw'; p1Stars: number; p2Stars: number }
  | { status: 'not_over'; p1Stars: number; p2Stars: number }
>;

/**
 * 记录胜利：写入 winner_player_id + victory_type + status='finished' 到 DB；
 * 同步 Redis；调用 battleSessionService.finishSession；广播 battle:end。
 * 调用方：checkWinCondition 返回 win/draw 时立即调用。
 *
 * @param io IOServer
 * @param battleId battle id
 * @param outcome checkWinCondition 返回的 win/draw 结果
 */
export async function recordVictory(
  io: IOServer,
  battleId: string,
  outcome: Extract<Awaited<ReturnType<typeof checkWinCondition>>, { status: 'win' | 'draw' }>
): Promise<void>;

/**
 * 内部 helper：把 stars 累加写回 Redis + DB（确保一致性）
 * - 用 HINCRBY stars:p1 或 HSET 累加
 * - UPDATE battles SET p1_stars = ...
 */
async function persistStars(battleId: string, side: Side, newStars: number): Promise<void>;

/**
 * 内部 helper：广播 battle:state:bases（每次据点状态变化时）
 */
async function broadcastBasesState(io: IOServer, battleId: string, bases: Record<string, Side | 'neutral'>): Promise<void>;
```

**`applyKillStars` 实现步骤**：
1. `listCharactersInBattle(battleId)` 拿全部 6 角色（带 playerId, userId）
2. 并行读 pieces HASH 全部 6 个 field → 拿当前 is_alive
3. 计算本次 delta：
   - 找到 is_alive=true → false 的角色（**调用前的快照**与**当前**比对）
   - T052 调用 applyKillStars 时，调用前快照需从 executeEndStep 进入时读取；为简化，**第一步在 executeEndStep 顶部快照，第四步 applyKillStars 内部比对**
4. 累加 star：每个死亡 → 对方 +1 star
5. 写回 Redis + DB

**`applyBaseStars` 实现步骤**：
1. 读 pieces HASH 全部 6 个 field → 拿当前 is_alive
2. 对据点 (3,3) 和 (6,6) 分别计算：
   - p1 在范围内（Chebyshev ≤ 2）的 alive 棋子数
   - p2 在范围内的 alive 棋子数
   - p1 > p2 → 该据点归 p1
   - p1 < p2 → 归 p2
   - p1 == p2 → neutral
3. 累加 star：每个被占领据点 → 占领方 +1 star
4. 写回 Redis + DB
5. 调 `broadcastBasesState` 推 `battle:state:bases`

**`checkWinCondition` 实现**：
1. 读 Redis `stars:p1` 和 `stars:p2`（或 DB 同步读）
2. 判定：
   - p1_stars >= 6 且 p2_stars < 6 → win, winnerSide='p1'
   - p2_stars >= 6 且 p1_stars < 6 → win, winnerSide='p2'
   - p1_stars >= 6 且 p2_stars >= 6 → draw
   - 否则 → not_over

**`recordVictory` 实现**：
1. UPDATE battles SET winner_player_id, victory_type, status='finished', finished_at=NOW()
2. 同步 Redis（最终态快照）
3. `finishSession(battleId)` —— 触发 phase='finished' + actor=null + DB 持久化
4. broadcast `battle:end` 到 battle room

**胜利类型推断**：
- applyKillStars 触发 win → victoryType='kill_threshold'
- applyBaseStars 触发 win → victoryType='base_threshold'
- 双方同时 6 → victoryType='draw'
- 实现：checkWinCondition 内部根据调用上下文（哪个 apply 函数传入）推断。**用参数 `lastStarSource: 'kill' | 'base'` 显式传入**。

### 3.2 `src/services/battleActionService.ts`（修改）

**`executeEndStep` 改造**：
```
原 11 步 → 新 13 步
  ...
  10. broadcastSessionState     (新事件 — session 整体推送)
  11. broadcastBoardState       (既有事件 — 整盘状态推送)
  12. ★ T052 wire-up: applyKillStars → checkWinCondition → 若 win/draw → recordVictory + finishSession
      → 否则 broadcastBoardState (再次？见 11) + return success
  13. 末尾 broadcastBasesState（如有据点变化 — 仅 executeRoundEnd 触发，见 3.3）
```

**注意**：star 累加是在 broadcast **之后**调用，保证客户端看到 step 完成的状态（包括新 step/round/actor/phase）后才看到胜利事件，避免「胜利信息比状态变化早到」造成客户端逻辑割裂。

**`executeRoundEnd` 改造**：
```
原 5 步 → 新 6 步
  1. applyBurnDamage           (T041)
  2. tickEffects
  3. endCurrentRound
  4. broadcastSessionState
  5. broadcastBoardState
  6. ★ T052 wire-up: applyBaseStars → checkWinCondition → 若 win/draw → recordVictory + finishSession
      → broadcastBasesState 推据点状态变化
      → 否则不广播 bases（保持上次状态）
```

### 3.3 `src/socket/battleStateBroadcaster.ts`（修改，新增 2 个函数）

**新增 `broadcastBasesState`**：
```typescript
export async function broadcastBasesState(
  io: IOServer,
  battleId: string,
  bases: Record<string, Side | 'neutral'>
): Promise<void>;
```
emit 到 `battle:{battleId}` room：
```typescript
io.to(`battle:${battleId}`).emit('battle:state:bases', {
  battleId,
  bases: {
    '3,3': bases['3,3'],  // 'p1' | 'p2' | 'neutral'
    '6,6': bases['6,6'],
  },
});
```

**新增 `broadcastBattleEnd`**（可选集成在 recordVictory 内部）：
```typescript
export async function broadcastBattleEnd(
  io: IOServer,
  battleId: string,
  payload: {
    winnerUserId: string | null;  // 平局时 null
    winnerSide: Side | null;      // 平局时 null
    victoryType: VictoryType;
    p1Stars: number;
    p2Stars: number;
    p1UserId: string;
    p2UserId: string;
  }
): Promise<void>;
```
emit 到 `battle:{battleId}` room：
```typescript
io.to(`battle:${battleId}`).emit('battle:end', {
  battleId,
  winnerUserId: payload.winnerUserId,
  winnerSide: payload.winnerSide,
  victoryType: payload.victoryType,
  p1Stars: payload.p1Stars,
  p2Stars: payload.p2Stars,
});
```

### 3.4 `src/migrations/009_t052_victory_stars.sql`（新建）

见 §2.2 SQL 片段。

### 3.5 `src/services/battleInitializationService.ts`（修改，T048 范围内）

**T048 战场初始化时**初始化 4 个新 Redis 键：
- `SET battle:{battleId}:stars:p1 0`
- `SET battle:{battleId}:stars:p2 0`
- `SET battle:{battleId}:alive_p1 3`（3v3）
- `SET battle:{battleId}:alive_p2 3`
- `SET battle:{battleId}:bases '{"3,3":"neutral","6,6":"neutral"}'`

**T052 范围说明**：T048 已 done，T052 仅追加这几行 SET。属于 T048.5 兼容扩展。

---

## 4. 触发流程图

```
T049 executeMove / T050 executePlayCard / handleBattleSkipPlay
  → 副作用 commit (HP/effects/session/positions)
  → broadcastBoardState + broadcastSessionState
  → ★ T052 触发点 A: applyKillStars
       ↓
       捕获本步新死亡（is_alive true→false）
       ↓
       HINCRBY stars:pN
       UPDATE battles SET pN_stars
       ↓
       checkWinCondition(lastStarSource='kill')
       ↓
       win/draw → recordVictory → finishSession → broadcast('battle:end') + return
       not_over → 继续

T051 executeRoundEnd (每轮 last step)
  → burn tick + effect tick + endCurrentRound + broadcast
  → ★ T052 触发点 B: applyBaseStars
       ↓
       扫描 2 据点，判定占领方
       ↓
       HINCRBY stars:pN（每占领 1 个 +1）
       UPDATE battles SET pN_stars
       ↓
       broadcastBasesState (实时推据点状态)
       ↓
       checkWinCondition(lastStarSource='base')
       ↓
       win/draw → recordVictory → finishSession → broadcast('battle:end') + return
       not_over → 继续
```

---

## 5. 验证规则

### 5.1 胜利条件（checkWinCondition 层）

| 情况 | stars 状态 | 结果 | victoryType |
|------|-----------|------|-------------|
| p1 击杀达标 | p1=6, p2<6 | win | kill_threshold |
| p2 击杀达标 | p2=6, p1<6 | win | kill_threshold |
| p1 据点达标 | p1=6, p2<6 | win | base_threshold |
| p2 据点达标 | p2=6, p1<6 | win | base_threshold |
| 双方同时 6（applyBaseStars） | p1=6, p2=6 | draw | draw |
| 双方同时 6（applyKillStars） | 理论不应发生 | N/A | T052 边界检查：executeEndStep 内 applyKillStars 若让双方同时 6，**取**先到 6 的胜。实现：applyKillStars 内同步读完 stars:p1+p2，若本步累加导致双方同时 6 → 退化为「仅 lastStarSource 方向胜」 |
| p1=5, p2=5，applyKillStars 让 p1=6（击杀 1）| p1=6, p2=5 | win | kill_threshold |
| p1=5, p2=5，applyBaseStars 让 p1=6, p2=6 | p1=6, p2=6 | draw | draw |

### 5.2 边界条件

| 情况 | 行为 |
|------|------|
| battle 初始化时第一次 applyKillStars 调用 | 「调用前快照」无 → 视为「调用前所有 alive」；本次无新增死亡 → 不加 star |
| 双方均有 0 alive 棋子 | applyKillStars: 无死亡 → 不加 star。applyBaseStars: 2 据点均为 neutral |
| 一方 0 alive，另一方 3 alive 据点占领 | 占领方 +2 star（本轮） |
| 据点 (3,3) 与 (6,6) 重叠？| Chebyshev 距离：\|3-6\|=3 > 2，不重叠 |
| 据点范围内棋子 HP=0 但 is_alive=true？| T056 范围。T052 严格按 `is_alive` 字段判定 |
| 玩家在 step 中途退出（断线） | 范围外，T046+ |
| 战斗已 finished 后再次 apply | 幂等：检查 currentPhase==='finished' 直接 return |
| 据点双方各 1 alive | 中立，不加 star |
| 据点 p1=2 alive, p2=1 alive | 占领 → p1 +1 star |
| 据点 p1=3 alive, p2=3 alive | 中立 → 不加 star |

### 5.3 调用方校验（executeEndStep / executeRoundEnd 层）

- 仅当 `currentPhase !== 'finished'` 时才调 apply 函数
- 若 checkWinCondition 返回 win/draw，则**不再**继续 broadcast（避免重复推 board 到已结束战斗）
- recordVictory 内部已调 finishSession（设 phase='finished'），后续 broadcast 自动短路

---

## 6. 数据流（Redis + DB）

### 6.1 读取的 Redis keys

| 键 | 用途 |
|----|------|
| `battle:{battleId}:pieces` | HASH —— 读所有 6 个棋子的 is_alive + player_id |
| `battle:{battleId}:positions` | HASH —— 读棋子坐标（applyBaseStars 范围计算） |
| `battle:{battleId}:stars:p1` | STRING —— 读 p1 当前 stars |
| `battle:{battleId}:stars:p2` | STRING —— 读 p2 当前 stars |

### 6.2 写入的 Redis keys

| 键 | 用途 |
|----|------|
| `battle:{battleId}:stars:p1` | HINCRBY —— apply 函数累加 |
| `battle:{battleId}:stars:p2` | HINCRBY |
| `battle:{battleId}:bases` | SET —— applyBaseStars 更新占领状态 |
| `battle:{battleId}:alive_p1` | SET —— 死一个 -1（T054 可能复用，T052 顺手维护） |
| `battle:{battleId}:alive_p2` | SET —— 同上 |

### 6.3 DB 读写

| 操作 | 表 | 语句 |
|------|----|------|
| 读 | battles | SELECT current_round, current_step, current_actor_id, current_phase FROM battles WHERE id=$1（既有 T051 调用） |
| 写 | battles | UPDATE battles SET p1_stars = $1 WHERE id = $2 |
| 写 | battles | UPDATE battles SET p2_stars = $1 WHERE id = $2 |
| 写 | battles | UPDATE battles SET winner_player_id = $1, victory_type = $2, status = 'finished', finished_at = NOW() WHERE id = $3 |

### 6.4 副作用顺序（严格按序）

**executeEndStep (T052 阶段)**:
```
... (T051 1-11 步不变)
12. applyKillStars
    → 读 pieces HASH 前后比对
    → HINCRBY stars:pN (每死一个)
    → UPDATE battles SET pN_stars
13. checkWinCondition(lastStarSource='kill')
    → 若 win/draw → recordVictory → finishSession → broadcast('battle:end') → return
    → 若 not_over → 继续 broadcast? 不需要，board 已推过
14. return { success: true, state }
```

**executeRoundEnd (T052 阶段)**:
```
... (T051 1-5 步不变)
6. applyBaseStars
    → 读 pieces HASH + positions HASH
    → 计算 2 据点占领方
    → HINCRBY stars:pN (每占领 1 个)
    → UPDATE battles SET pN_stars
    → SET bases JSON
7. broadcastBasesState (battle room)
8. checkWinCondition(lastStarSource='base')
    → 若 win/draw → recordVictory → finishSession → broadcast('battle:end') → return
    → 若 not_over → 继续
```

---

## 7. 测试设计

### 7.1 单元测试（`battleOutcomeService.test.ts` 新建）

| 编号 | describe 块 | 用例 | 期望 |
|------|-------------|------|------|
| 1 | applyKillStars 1 kill | 1 棋从 alive→dead | p2 +1 star（若 p1 杀），Redis + DB 同步 |
| 2 | applyKillStars 0 kill | is_alive 不变 | 0 delta，stars 不变 |
| 3 | applyKillStars multi kill | AOE 杀 2 | p2 +2 stars |
| 4 | applyKillStars burn 杀 | T051 burn tick 触发死亡 | 计入击杀 |
| 5 | applyBaseStars p1 占 1 | (3,3) 范围 p1=2 alive, p2=1 alive | p1 +1 star |
| 6 | applyBaseStars p2 占 2 | (3,3) p1=0 alive p2=3；(6,6) p1=1 alive p2=2 | p2 +2 stars |
| 7 | applyBaseStars neutral | (3,3) p1=2 p2=2；(6,6) p1=3 p2=0 | p1 +1 star（仅 (6,6)），(3,3) 中立 |
| 8 | applyBaseStars both neutral | (3,3) p1=1 p2=1；(6,6) p1=1 p2=1 | 0 delta |
| 9 | applyBaseStars empty | 全 alive 棋子都出 (3,3) 范围 | 0 delta |
| 10 | checkWinCondition win p1 | p1=6, p2=2 | win, p1, kill_threshold |
| 11 | checkWinCondition win p2 via base | p1=4, p2=6 | win, p2, base_threshold |
| 12 | checkWinCondition draw | p1=6, p2=6 | draw |
| 13 | checkWinCondition not_over | p1=5, p2=3 | not_over |
| 14 | recordVictory DB write | win → 调用后 DB winner_player_id / victory_type / status='finished' | 验证 UPDATE |
| 15 | recordVictory finishSession 联动 | win → currentPhase='finished', currentActorId=null | 验证 |
| 16 | recordVictory broadcast | win → io.to(battle:{id}).emit('battle:end', {winnerUserId, winnerSide, victoryType, p1Stars, p2Stars}) | mock io 验证 |
| 17 | recordVictory draw broadcast | draw → winnerUserId=null, winnerSide=null, victoryType='draw' | mock io 验证 |
| 18 | applyKillStars finished 短路 | currentPhase='finished' | return 0 delta |

**总计 18 个新 case**。

### 7.2 集成测试（`battleActionService.test.ts` 追加）

| 编号 | describe 块 | 用例 | 期望 |
|------|-------------|------|------|
| 1 | executeEndStep 触发击杀 star | step 内 1 棋死亡 | applyKillStars 1 次，stars +1 |
| 2 | executeEndStep 触发胜利 | p1_stars 加到 6 | recordVictory 1 次，'battle:end' 广播 |
| 3 | executeRoundEnd 触发据点 star | 据点占领 | applyBaseStars 1 次，stars +1 |
| 4 | executeRoundEnd 触发平局 | 双方同时 6 | recordVictory 1 次（draw） |
| 5 | executeRoundEnd 不重复检测击杀 | round end | applyKillStars **不**调（仅 last step 的 executeEndStep 调过） |

**总计 5 个新 case**。

### 7.3 Broadcaster 测试（`battleStateBroadcaster.test.ts` 追加）

| 编号 | describe 块 | 用例 | 期望 |
|------|-------------|------|------|
| 1 | broadcastBasesState happy | 2 据点 p1/p2 | emit battle:state:bases，payload 字段正确 |
| 2 | broadcastBasesState neutral | 2 neutral | payload 中 2 个 'neutral' |
| 3 | broadcastBattleEnd win | winnerUserId/winnerSide/p1Stars/p2Stars | emit battle:end，payload 字段正确 |
| 4 | broadcastBattleEnd draw | null + null + draw | emit battle:end，winnerUserId=null |

**总计 4 个新 case**。

### 7.4 Handler / Socket 测试

- **不新增**：胜利事件由 recordVictory 内部 emit，不经过 socketServer handler；客户端不主动发胜利请求
- socketServer.test.ts 顶部 mock 补全 `applyKillStars` / `applyBaseStars` / `checkWinCondition` / `recordVictory`（若 socketServer.test 引用了 battleActionService 间接调用）

### 7.5 不写新端到端集成测试

- T054 战斗结算范围会做端到端验证
- T052 沿用 T051 模式仅单元测

---

## 8. 文件清单

| 路径 | 改动 |
|------|------|
| `src/services/battleOutcomeService.ts` | **新建** —— 4 个公共函数 + 2 个内部 helper（~250 行） |
| `src/services/battleOutcomeService.test.ts` | **新建** —— 18 个单测 case（~350 行） |
| `src/services/battleActionService.ts` | **修改** —— executeEndStep 末尾追加 applyKillStars wire-up；executeRoundEnd 末尾追加 applyBaseStars wire-up |
| `src/services/battleActionService.test.ts` | **修改** —— 追加 5 个集成 case |
| `src/socket/battleStateBroadcaster.ts` | **修改** —— 新增 `broadcastBasesState` + `broadcastBattleEnd`（~50 行） |
| `src/socket/battleStateBroadcaster.test.ts` | **修改** —— 追加 4 个 case |
| `src/services/battleInitializationService.ts` | **修改** —— T048 初始化时新增 5 个 Redis 键 SET（~10 行） |
| `src/migrations/009_t052_victory_stars.sql` | **新建** —— 4 列 ALTER + 注释（~20 行） |

**无数据库表结构变更**（仅加列），**无新增 WS 事件类型数量：2 个**（`battle:state:bases`、`battle:end`）。

---

## 9. 关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 新模块位置 | `battleOutcomeService.ts`（独立 service） | 单一职责；T056 applyDamage 可能需要类似接口；与 battleSessionService 同级 |
| Star 触发粒度 | applyKillStars 每步 + applyBaseStars 每轮 | 击杀粒度细（按步）+ 据点粒度粗（按轮）匹配棋盘节奏；T051 已提供完美 hook |
| 胜利类型 | kill_threshold / base_threshold / draw | 用户 Q1-Q8 决定；draw 仅为双方同时 6 的边界 |
| 据点坐标 | 固定 (3,3) + (6,6) | 用户 Q1 答案；9×9 棋盘对角线，公平对称 |
| 占领范围 | Chebyshev ≤ 2（5×5） | 用户 Q5 答案；便于 AOE/群体技能协作 |
| 平局条件 | 仅双方同时 6 | 用户 Q4 答案；其他情况胜负分明 |
| 触发时机（executeEndStep 内） | broadcast **之后** | 客户端先看到 step 完成状态（含新 actor/phase），再看到胜利事件，符合直觉 |
| 触发时机（executeRoundEnd 内） | broadcast **之后** | 同上；先推 round 新值 + HP/effect 变化，再推据点 + 胜利 |
| Star 主存 | Redis 临时 + DB 持久 | T051 既有模式；DB 列为权威（T054 战斗结算会再次校验） |
| Winner 持久化 | UPDATE battles.winner_player_id | 既有字段（migration 001），T054 战斗结算会读取 |
| 双方同时 6（applyBaseStars 内） | draw | 用户 Q4 答案 |
| 双方同时 6（applyKillStars 内）| 退化：先到 6 的胜 | 实现约束：applyKillStars 不应让双方同时 6（单步只能让一方 -1 + 对方 +1，但若 p1_stars=5 + p2_stars=5 + applyKillStars 后 p1=6 + p2=5 → p1 胜，符合直觉；若 p1=5 + p2=6 → 已 win，跳过） |
| lastStarSource 参数 | 显式传 `'kill'` / `'base'` | 简单可读；checkWinCondition 内部根据此推断 victoryType |
| is_alive 判定源 | pieces HASH 的 `is_alive` 字段 | 用户 Q3 答案；T051 既有 burn tick 已维护此字段 |
| 终态持久化 | recordVictory 内 UPDATE battles SET status='finished' | 与 finishSession（仅设 phase）解耦；recordVictory 完成后 finishSession 设置 phase='finished' |
| 据点状态广播时机 | 仅当变化时（applyBaseStars 末尾） | 不在每步推（频率过高），仅在每轮结算时推 |
| battle:state:bases 推送内容 | 2 个据点的占领方（不带 star） | 据点是状态，star 在 battle:state:board 内可推 p1_stars/p2_stars 字段 |
| battle:state:board 增量字段 | 顶部加 p1_stars/p2Stars（可选） | T047 既有事件，broadcastBoardState 重新构建 board 时可包含 stars 字段；T052 范围决定是否包含 |
| T048 初始化扩展 | battleInitializationService 末尾追加 5 个 SET | 兼容性扩展；旧 battle 重新初始化时也覆盖 |

---

## 10. 范围外（明确不做）

- ❌ **断线超时强制胜利** —— T046+ 范围（双方断线超时后判 lose）
- ❌ **T053 卡牌消耗处理** —— T053 范围（战斗结束后消耗使用的卡牌）
- ❌ **T054 对战结算 API** —— T054 范围（reward / rating 更新）
- ❌ **T056 伤害计算权威化** —— T056 范围（applyDamage 统一入口；本任务 burn tick 用 T051 局部 HP 操作）
- ❌ **客户端胜利动画 / UI 提示** —— 前端 T070 范围
- ❌ **胜利后清理 Redis 临时态** —— T054 范围（结算完再清）
- ❌ **服务端 star 防作弊校验** —— 客户端不发 star 相关请求（服务端是唯一写源），无需校验
- ❌ **据点坐标动态调整（地图模式）** —— 范围外，T049+ 后续任务决定
- ❌ **5v5 / NvN 模式胜利条件** —— 范围外，T049 + 后续决定
- ❌ **胜方额外奖励（如 +bonus star）** —— T054 范围
- ❌ **回放系统** —— 后续范围
- ❌ **观战模式** —— 后续范围

---

## 附录 A：常量定义

```typescript
// src/services/battleOutcomeService.ts 内常量
export const BASES = [
  { x: 3, y: 3, key: '3,3' },
  { x: 6, y: 6, key: '6,6' },
] as const;

export const BASE_RADIUS = 2;  // Chebyshev 距离阈值
export const WIN_THRESHOLD = 6;
```

## 附录 B：WS 事件完整定义

### B.1 battle:state:bases（server → both）

```typescript
{
  battleId: string;
  bases: {
    '3,3': 'p1' | 'p2' | 'neutral';
    '6,6': 'p1' | 'p2' | 'neutral';
  };
}
```

**触发场景**：
- T051 executeRoundEnd → applyBaseStars → 推一次
- 每次据点状态有变化时（不是每轮都推，是「变化」时才推；首轮可能没变化）

### B.2 battle:end（server → both）

```typescript
{
  battleId: string;
  winnerUserId: string | null;  // 平局时 null
  winnerSide: 'p1' | 'p2' | null;  // 平局时 null
  victoryType: 'kill_threshold' | 'base_threshold' | 'draw';
  p1Stars: number;
  p2Stars: number;
  p1UserId: string;
  p2UserId: string;
}
```

**触发场景**：
- checkWinCondition 返回 win → recordVictory → 推
- checkWinCondition 返回 draw → recordVictory → 推
- 客户端收到此事件后跳转到结算页（T054）

### B.3 battle:state:board 增量字段（可选）

若 T052 决定在 board state 内加 stars 字段（前端可一次拉取），修改如下：

```typescript
export interface BoardStateEvent {
  // ... 既有字段
  p1Stars: number;  // ★ T052 新增
  p2Stars: number;  // ★ T052 新增
  bases: {          // ★ T052 新增
    '3,3': 'p1' | 'p2' | 'neutral';
    '6,6': 'p1' | 'p2' | 'neutral';
  };
}
```

**决策**：T052 范围包含此增量，但保留 `battle:state:bases` 独立事件（前端按需订阅）。`battle:state:board` 的 stars 字段作为冗余信号。

---

*文档版本：v1.0*
*最后更新：2026-06-17*