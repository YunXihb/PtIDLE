# T048 战场初始化设计文档

**任务**：T048 - 实现战场初始化
**日期**：2026-06-15
**状态**：✅ 设计已批准，待实现

---

## 一、目标

在 3v3 战棋对战中，当双方玩家都完成 `battle:join` 加入房间后，自动触发战场初始化流程：

1. 初始化棋盘（9×9）
2. 双方各 3 个棋子放置到默认位置（P1 占据右下角，P2 占据左上角）
3. 设置棋子初始能量为满（3 点）
4. 全员 6 个棋子各抽 3 张初始手牌
5. 初始化回合状态机（蛇形 ABABAB 顺序）
6. 将 `battles` 行从 `status='pending'` 更新为 `status='ongoing'`
7. 向双方各自广播全量 battle state

**约束**：硬编码 3v3，不支持其他队伍规模；位置自动分配，不支持玩家手动选择。

---

## 二、架构

### 2.1 文件改动清单

| 文件 | 改动 |
|------|------|
| `src/services/battleInitializationService.ts` | **新建** —— 核心 `initBattleField(io, battleId)` + `cleanupPartialInit(battleId, stepIndex)` |
| `src/services/battleInitializationService.test.ts` | **新建** —— 单测覆盖 7 步流水 + 失败回滚 (~15 tests) |
| `src/services/battleService.ts` | 新增 `setCharacterEnergy(battleId, characterId, energy)` 公共 API |
| `src/services/battleService.test.ts` | 新增 `setCharacterEnergy` 测试 (~3 tests) |
| `src/socket/battleRoom.ts` | `handleBattleJoin` 成功路径后挂 `tryInitBattleField` 逻辑 |
| `src/socket/battleRoom.test.ts` | **新建** —— 双 join / 并发 / 重入 / 单 join 测试 (~8 tests) |
| `src/socket/battleRoom.integration.test.ts` | **新建** —— 真实 PG+Redis 端到端 (~3 tests) |
| `src/migrations/008_t048_battle_init.sql` | **新建** —— `characters.battle_id` + `deck_position` + 索引 |

### 2.2 对外接口（仅 2 个）

```typescript
// src/services/battleInitializationService.ts
export async function initBattleField(io: IOServer, battleId: string): Promise<InitResult>
export async function cleanupPartialInit(battleId: string, lastSuccessfulStep: number): Promise<void>

type InitResult =
  | { success: true;  startedAt: Date; actorId: string }
  | { success: false; failedStep: number; error: string };
```

`battleInitializationService` 是 **orchestrator**，不持有私有 Redis key 命名空间，仅按序调用既有 service。所有 Redis key 复用既有命名（`battle:{id}:positions` / `battle:{id}:pieces` / `battle:{id}:hand:{cid}` / `battle:{id}:session`），不新增。

### 2.3 默认坐标常量（3v3 硬编码）

```typescript
const DEFAULT_P1_POSITIONS_3V3 = [{x:6,y:0}, {x:7,y:0}, {x:8,y:0}];
const DEFAULT_P2_POSITIONS_3V3 = [{x:0,y:8}, {x:1,y:8}, {x:2,y:8}];
```

9×9 棋盘，P1 占右下 3 列顶行，P2 占左上 3 列底行，互不重叠。

---

## 三、数据流

### 3.1 完整触发链路（happy path）

```
Player1 emit('battle:join', {battleId}) ──┐
                                          ├─→ handleBattleJoin
Player2 emit('battle:join', {battleId}) ──┘   ├─ T046 鉴权
                                              ├─ socket.join('battle:{id}')
                                              └─ tryInitBattleField
                                                  ├─ SETNX 'init_lock' (EX 30)
                                                  ├─ isOtherInRoom + status='pending'?
                                                  │   └─ initBattleField(io, battleId)
                                                  │       1. initializeBoard
                                                  │       2. placeCharacter × 6 (默认位置)
                                                  │       3. setCharacterEnergy × 6
                                                  │       4. drawCards × 6 (各 3 张)
                                                  │       5. initializeSession
                                                  │       6. UPDATE battles status='ongoing'
                                                  │       7. broadcastFullState × 2
                                                  └─ DEL 'init_lock'
```

### 3.2 并发竞争处理

| 场景 | 处理 |
|------|------|
| 双 join 同时到达 | SETNX 仅一个赢家；输者 sleep 100ms 后读 status 决定 broadcast / wait |
| 单 join（对手未到） | 跳过 init，仅 broadcast join:ok 给加入者；T046 `opponentInRoom=false` |
| 重入（status=ongoing） | 跳过 init，直接 broadcastFullState 给重连方 |
| 重入（status=pending，前次失败回滚） | 重走完整 init（Redis keys 已 DEL，幂等） |
| init_lock TTL 30s 过期但 init 还在执行 | 由 `del` + `getBattleStatus` 二次检查兜底 |

---

## 四、组件细节：7 步流水

### 4.1 `initBattleField(io, battleId)` 实现

签名修正：增加 `io` 参数（来自 `handleBattleJoin → tryInitBattleField` 链路）。

```typescript
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
      return { success: false, failedStep: 2,
               error: `Insufficient characters: p1=${p1Chars.length}, p2=${p2Chars.length}` };
    }
    for (let i = 0; i < 3; i++) {
      await battleService.placeCharacter(battleId, p1Chars[i].id,
                                         DEFAULT_P1_POSITIONS_3V3[i].x,
                                         DEFAULT_P1_POSITIONS_3V3[i].y);
      await battleService.placeCharacter(battleId, p2Chars[i].id,
                                         DEFAULT_P2_POSITIONS_3V3[i].x,
                                         DEFAULT_P2_POSITIONS_3V3[i].y);
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
      await broadcastFullState(io, battleId, p1Chars[0].userId);
      await broadcastFullState(io, battleId, p2Chars[0].userId);
    } catch (broadcastErr) {
      console.error(`[initBattleField:${battleId}] broadcast failed:`, broadcastErr);
      // 不回滚 PG；客户端重发 battle:join 触发重 broadcast
    }

    return { success: true, startedAt, actorId: order[0] };

  } catch (err) {
    await cleanupPartialInit(battleId, lastStep).catch(cleanupErr => {
      console.error(`[initBattleField:${battleId}] cleanup also failed:`, cleanupErr);
    });
    return { success: false, failedStep: lastStep, error: (err as Error).message };
  }
}
```

注：`broadcastFullState`（来自 `socket/battleStateBroadcaster.ts`，T047 已建）接受 `userId` 参数自动选 ownHand 子集，故对双方各调一次即可，无需自定义 `broadcastFullStateToBothPlayers`。

### 4.2 `loadBattleCharacters(battleId)` —— 取每方前 3 个 alive 棋子

```typescript
async function loadBattleCharacters(battleId: string): Promise<{
  p1Chars: Array<CharacterRow & { userId: string }>;
  p2Chars: Array<CharacterRow & { userId: string }>;
}> {
  const battleRow = await queryOne(
    `SELECT player1_id, player2_id FROM battles WHERE id=$1`,
    [battleId]
  );
  const p1Rows = await query(
    `SELECT id, player_id, name, profession, health, max_health,
            movement, energy, max_energy, is_alive
     FROM characters
     WHERE player_id=$1 AND is_alive=TRUE
     ORDER BY created_at ASC LIMIT 3`,
    [battleRow.player1_id]
  );
  const p2Rows = await query(/* same query with player2_id */);

  // 绑定 battle_id（步骤 6 之前完成，便于 replay）
  const allIds = [...p1Rows, ...p2Rows].map(r => r.id);
  if (allIds.length > 0) {
    await query(
      `UPDATE characters SET battle_id=$1 WHERE id = ANY($2::uuid[])`,
      [battleId, allIds]
    );
  }

  return { p1Chars: p1Rows, p2Chars: p2Rows };
}
```

**决策**：按 `created_at ASC LIMIT 3` 取前 3 个。T008 注册时已创建 1 warrior + 1 ranger + 1 mage → 默认平衡；若玩家后续创建额外棋子，**可能**造成不平衡阵容。T048.5 未来扩展「棋子选择 UI」。

### 4.3 `cleanupPartialInit(battleId, lastSuccessfulStep)` —— 阶梯式反向清理

```typescript
export async function cleanupPartialInit(
  battleId: string,
  lastSuccessfulStep: number
): Promise<void> {
  // 步骤 6 失败 → 回滚 battles 行
  if (lastSuccessfulStep >= 6) {
    await query(
      `UPDATE battles SET status='pending', started_at=NULL,
         current_actor_id=NULL, current_phase=NULL,
         current_round=1, current_step=0
       WHERE id=$1 AND status='ongoing'`,
      [battleId]
    );
  }

  // 步骤 5 失败 → DEL session key
  if (lastSuccessfulStep >= 5) {
    await redisClient.del(`battle:${battleId}:session`);
  }

  // 步骤 4 失败 → DEL 6 个 hand/retained/discard key
  if (lastSuccessfulStep >= 4) {
    const { p1Chars, p2Chars } = await loadBattleCharacters(battleId).catch(() => ({p1Chars:[],p2Chars:[]}));
    for (const c of [...p1Chars, ...p2Chars]) {
      await redisClient.del(`battle:${battleId}:hand:${c.id}`);
      await redisClient.del(`battle:${battleId}:retained:${c.id}`);
      await redisClient.del(`battle:${battleId}:discard:${c.id}`);
    }
  }

  // 步骤 2 失败 → DEL pieces + positions
  if (lastSuccessfulStep >= 2) {
    await redisClient.del(`battle:${battleId}:pieces`);
    await redisClient.del(`battle:${battleId}:positions`);
  } else if (lastSuccessfulStep === 1) {
    await redisClient.del(`battle:${battleId}:positions`);
  }
}
```

**关键设计**：`if (lastSuccessfulStep >= N)` 阶梯式（不 else-if 链），确保任意步骤失败时所有上游步骤的写入都能回滚。

### 4.4 新增 `battleService.setCharacterEnergy`

```typescript
// src/services/battleService.ts 末尾新增
export async function setCharacterEnergy(
  battleId: string, characterId: string, energy: number
): Promise<void> {
  const key = `battle:${battleId}:pieces`;
  const raw = await redisClient.hGet(key, characterId);
  const piece = raw ? JSON.parse(raw) : {};
  piece.energy = energy;
  await redisClient.hSet(key, characterId, JSON.stringify(piece));
}
```

走 read-modify-write 模式复用 `pieces` HASH。

### 4.5 `handleBattleJoin` 新增 `tryInitBattleField`

```typescript
// src/socket/battleRoom.ts 末尾新增
async function tryInitBattleField(
  io: IOServer, battleId: string, joiningUserId: string
): Promise<void> {
  const lockToken = `${Date.now()}-${Math.random()}`;
  const locked = await redisClient.set(
    `battle:${battleId}:init_lock`, lockToken,
    { NX: true, EX: 30 }
  );

  if (!locked) {
    // 别人正在 init，等一下读 status 决定 broadcast / wait
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
    const [otherInRoom, status] = await Promise.all([
      isOtherPlayerInRoom(io, battleId),
      getBattleStatus(battleId),
    ]);

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
```

`isOtherPlayerInRoom`：用 `io.sockets.adapter.rooms.get('battle:{id}')?.size > 1`。

`getBattleStatus`：`SELECT status FROM battles WHERE id=$1`。

---

## 五、错误处理

### 5.1 失败分类表

| 失败场景 | 处理 | 用户感知 |
|---------|------|----------|
| 玩家非 battle 参与者 | T046 既有返 `join:error` | 客户端收到错误 |
| battles 行不存在 | T046 既有返 `join:error` | 同上 |
| 双方 join 时一方断开 | T046 disconnect 处理；不影响 init；重 join 走幂等 | 客户端断线提示 |
| 步骤 1-5 Redis 抛错 | cleanupPartialInit + status='pending' | 客户端重 join 重试 |
| 步骤 6 PG 抛错 | 同上 + UPDATE 回滚 'pending' | 同上 |
| 步骤 7 broadcast 失败 | **不回滚 PG**；console.error；依赖客户端重 join 重 broadcast | 客户端轮询超时后重 join |
| 一方 <3 alive 棋子 | 返 `InitResult{success:false, failedStep:2, error:'insufficient_characters'}` | 双端 join:ok 但无 state:full；客户端 10s 超时显示「对手阵容不足」|
| 双 join 同时到达 | SETNX 单赢；输者 sleep + 读 status | 无感知 |

### 5.2 日志策略（沿用项目惯例）

每条 log 前缀带 battleId 便于 grep：

```typescript
console.log(`[initBattleField:${battleId}] step 1/7 initializeBoard`);
console.error(`[initBattleField:${battleId}] step ${lastStep} failed:`, err);
console.log(`[initBattleField:${battleId}] cleanupPartialInit lastStep=${lastStep} done`);
console.log(`[initBattleField:${battleId}] success actorId=${order[0]} startedAt=${startedAt}`);
console.error(`[tryInitBattleField:${battleId}] lost init_lock race, status=${status}`);
```

---

## 六、数据库改动 (Migration 008)

```sql
-- 008_t048_battle_init.sql

-- 1. characters 表加 battle_id（软绑定，NULL 表示未入战）
ALTER TABLE characters ADD COLUMN battle_id UUID REFERENCES battles(id) ON DELETE SET NULL;
CREATE INDEX idx_characters_battle_id ON characters(battle_id);

-- 2. characters 表加 deck_position（3v3 中棋子 0/1/2 位序，预留给未来）
ALTER TABLE characters ADD COLUMN deck_position INTEGER;

-- 3. battles.started_at 索引（查询加速）
CREATE INDEX IF NOT EXISTS idx_battles_started_at ON battles(started_at);
```

**软绑定语义**：`battle_id` 可空。T048 步骤 2 中 `loadBattleCharacters` 通过 `UPDATE characters SET battle_id=$1 WHERE id IN (...)` 一次性绑定。

---

## 七、测试策略

### 7.1 测试文件

| 文件 | 类型 | 数量 |
|------|------|------|
| `src/services/battleInitializationService.test.ts` | 单测 | ~15 |
| `src/socket/battleRoom.test.ts` | 单测 | ~8 |
| `src/services/battleService.test.ts` | 单测（新增） | ~3 |
| `src/socket/battleRoom.integration.test.ts` | 集成测 | ~3 |
| **合计** | | **~29** |

### 7.2 单测覆盖矩阵

**battleInitializationService.test.ts**：
- Happy path: 7 步全成功 (1)
- 失败路径: 步骤 1/2/3/4/5/6/7 各 1 (7)
- 步骤 7 失败不回滚 PG (1)
- cleanupPartialInit 阶梯式：lastStep=1 / 6 / 边界 (3)
- 边界：棋子不足 / invalid battleId / cleanup also fails (3)
- **小计 ~15**

**battleRoom.test.ts**：
- 单 join 不触发 init (1)
- 双 join 触发 init (1)
- SETNX 失败 + status=ongoing → broadcast (1)
- SETNX 失败 + status=pending → noop (1)
- status=ongoing 重入 → broadcast (1)
- finally 释放 init_lock 即使抛错 (1)
- redisClient.set 抛错 → join:ok 无 init (1)
- 其他玩家不在房间 → 仅 broadcast (1)
- **小计 ~8**

**battleService.test.ts 新增**：
- setCharacterEnergy 正常 (1)
- setCharacterEnergy 不存在角色 (1)
- setCharacterEnergy 覆盖已有 energy (1)
- **小计 ~3**

**battleRoom.integration.test.ts**：
- 双 join 端到端 + state 隔离 (1)
- 部分失败 + 重试 (1)
- 并发双 join 仅 init 一次 (1)
- **小计 ~3**

### 7.3 Mock 模式（沿用项目惯例）

```typescript
// TDZ 顺序：jest.mock 在所有 import 之前
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
  redisClient: { set: jest.fn(), del: jest.fn(), hGet: jest.fn(), hSet: jest.fn() },
}));
```

引用 mock 时用 `import * as X` + `as jest.MockedFunction` 强制断言。

### 7.4 验证清单

- [ ] `npx jest` 全部通过（既有 + 新增 ~29 个）
- [ ] `npx tsc --noEmit` 0 错误
- [ ] `migration 008` 跑通（docker compose up PG 后 `psql -f`）
- [ ] `handleBattleJoin` 既有 T046 3 个测试不破坏（mock 补全 initBattleField 调用）
- [ ] `battle:state:full` 既有 T047 测试不破坏
- [ ] `architecture.md` 新增「T048 战场初始化」章节
- [ ] `progress.md` 追加 T048 一行
- [ ] `history.md` 追加 prompt/思考/意外条目

---

## 八、范围外（明确不做）

- ❌ 其他队伍规模（1v1/2v2/4v4/5v5）—— T048.5+
- ❌ 玩家手动位置选择 UI —— T048.5+
- ❌ 棋子选择 UI（从 N 个 alive 选 3 个）—— T048.5+
- ❌ 撮合超时自动取消（orphan battle）—— T1000 OOS
- ❌ 启动首回合（`activateCurrentUnit`）—— T051
- ❌ 卡牌消耗处理 —— T053
- ❌ 胜负判定 —— T052
- ❌ 不响应自动胜 / 告警 —— T1000 OOS

---

## 九、文件改动预估代码量

| 文件 | 预估行数 |
|------|----------|
| `battleInitializationService.ts` | ~250 行（含注释） |
| `battleInitializationService.test.ts` | ~350 行 |
| `battleRoom.ts` 改动 | +60 行 |
| `battleRoom.test.ts` | ~200 行 |
| `battleRoom.integration.test.ts` | ~150 行 |
| `battleService.ts` 改动 | +20 行 |
| `battleService.test.ts` 改动 | +40 行 |
| `008_t048_battle_init.sql` | ~15 行 |
| **合计** | **~1085 行** |

---

*文档版本：v1.0*
*最后更新：2026-06-15*