# T053 卡牌消耗 — 设计文档

> **For agentic workers:** This is a design document. Implementation plan will be created after spec approval.

**Goal:** 在 3v3 战棋对战中，**实时**消耗玩家打出的卡牌：每打一张 `source='deck'` 的手牌，立即在 DB 中删除对应的 `character_deck` 行 + `player_cards` 行（同一事务内），符合 spec 「卡牌为消耗品，使用后需重新制造」语义。`source='public_pool'` 卡不入 `player_cards`，跳过删除（无限复用）。DB 删除失败时采用 best-effort 策略：catch + `console.error` + 不影响后续广播 / 阶段推进（手牌已 lRem、能量已扣、广播已发，返错会引入更严重的状态不一致）。

**Architecture:** 在 T050 既有 `executePlayCard` 17 步流水线的**步骤 9（addToDiscardPile）之后、步骤 10（broadcast）之前**，插入**步骤 9.5：DB 消耗**。新增内部函数 `consumePlayerCard(handCard, characterId)`：当 `handCard.source === 'deck'` 时，开启 PostgreSQL 事务 → `DELETE FROM character_deck WHERE id=$1` + `DELETE FROM player_cards WHERE id=$1` → `COMMIT`；任一失败 → `ROLLBACK` + warn/error 日志，返回 `{ consumed: false, reason: 'partial' | 'error' }`；公共池卡直接返回 `{ consumed: false, reason: 'public_pool' }`（不调事务）。`consumePlayerCard` 不抛出异常（best-effort），调用方不检查返回值。T050 现有 8 个 error 变体保持不变，executeEndStep / executeRoundEnd 流程不变。

**Tech Stack:** Node.js + TypeScript + Express + Socket.io + PostgreSQL + Redis（v4 client）+ Jest + ts-jest

**Spec:** 依赖 T032（卡牌分配，character_deck 写入）、T033（棋盘初始化）、T037（抽牌 + HandCard.source 字段）、T050（executePlayCard 17 步流水线 + addToDiscardPile）、T1001（公共池 source 标识 + 公共池卡不入 player_cards）

---

## 1. 消耗规则

### 1.1 三种卡牌来源的消耗语义

| 来源 | 是否在 `player_cards` | T053 行为 | 理由 |
|------|----------------------|-----------|------|
| `source='deck'` | ✅ 是 | 删除 `character_deck` 行 + `player_cards` 行（同一事务） | spec 「卡牌为消耗品」+ player 库存会真实减少 |
| `source='public_pool'` | ❌ 否（公共池卡在 `card_templates` 表，`is_public_pool=TRUE`） | 跳过（不调事务） | T1001 设计：无限复用，不进 player_cards |
| T050 既有 `addToDiscardPile` | — | **不变**：仅 deck 卡入弃牌堆（已实现，T050 spec §4.5 步骤 4） | 弃牌堆是「已使用历史」记录，与 DB 删除解耦 |

### 1.2 实时消耗时序

```
T050 executePlayCard 17 步流水线（T053 改造后）
  步骤 1-8:  session 读 / phase 校验 / actor 校验 / owner 校验 / hand 归属 / dispatch validate / 扣能量 / lRem 手牌
  步骤 9:    addToDiscardPile (if source='deck')       ← T050 既有
  步骤 9.5:  ★ T053 NEW: consumePlayerCard(handCard, characterId)  ← best-effort, 内部事务
  步骤 10-17: 广播 / 阶段推进 / T051 executeEndStep 级联  ← 完全不变
```

**关键定位**：DB 删除发生在**弃牌堆记录之后、广播之前**。理由：手牌 `lRem` 之后但 DB 删除之前，若客户端收到 `battle:state:hand` 推送，玩家会看到「手牌少了一张」+「库存还是 N 张」短暂不一致（毫秒级，但 best-effort 写入可能在更早时刻发生）。将 DB 删除放在 broadcast 之前，让客户端一次性看到「手牌 -1 + 库存 -1」（通过后续 `GET /api/cards/my/list` 触发）。

### 1.3 不做（明确范围外）

- ❌ 批量结算（对战结束统一删） — 选实时路径
- ❌ 「used」标记 + 后台清理 — 选直接 DELETE 路径
- ❌ 退款 / 撤销机制 — 不存在语义
- ❌ 异步队列 / 重试 — best-effort + 日志，靠后续清理任务
- ❌ 5v5 — 后续任务
- ❌ 失败时回滚 Redis 手牌 / 能量 — 避免更严重不一致
- ❌ 失败时返回 error 变体 — T050 现有 8 个 error 不变

---

## 2. 数据模型

### 2.1 涉及的 DB 表

#### `player_cards`（T001 migration 001 已建）

```sql
CREATE TABLE IF NOT EXISTS player_cards (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    card_template_id UUID REFERENCES card_templates(id),
    name VARCHAR(100) NOT NULL,
    type VARCHAR(20) NOT NULL,
    cost INTEGER NOT NULL,
    effect JSONB DEFAULT '{}',
    quantity INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_player_cards_player_id ON player_cards(player_id);
-- T002 增加 card_sequence + 多个复合索引
ALTER TABLE player_cards ADD COLUMN IF NOT EXISTS card_sequence INTEGER;
CREATE INDEX IF NOT EXISTS idx_player_cards_player_template ON player_cards(player_id, card_template_id);
CREATE INDEX IF NOT EXISTS idx_player_cards_player_sequence ON player_cards(player_id, card_sequence);
CREATE INDEX IF NOT EXISTS idx_player_cards_player_created ON player_cards(player_id, created_at DESC);
```

**T053 删除行时使用**：`DELETE FROM player_cards WHERE id = $1`（PK 查询，`id = handCard.card_id`）

#### `character_deck`（T001 migration 001 已建）

```sql
CREATE TABLE IF NOT EXISTS character_deck (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    player_card_id UUID NOT NULL REFERENCES player_cards(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

**T053 删除行时使用**：`DELETE FROM character_deck WHERE id = $1`（PK 查询，`id = handCard.deck_id`）

**FK 关系**：`character_deck.player_card_id` → `player_cards.id` 设置了 `ON DELETE CASCADE`。理论上只删 `player_cards` 一行就够，但项目约定显式删两边以保证两个索引同步刷新（且删 `character_deck` 更快，无 cascading 触发）。

### 2.2 无新增字段、无新增表、无新增 Redis 键

T053 范围不引入任何 schema 变更（不改 `battles`、不改 `players`、不改 `characters`、不改 `card_templates`）。**无新增 Redis 键**。**无新增 migration**。

### 2.3 ID 映射（已确认）

| HandCard 字段 | 对应 DB 行 |
|---------------|-----------|
| `card_id: string` | `player_cards.id` (PK) |
| `deck_id: string` | `character_deck.id` (PK)；若 `source='public_pool'` 则为虚拟 `pool:<template_no>` |
| `source: 'deck' \| 'public_pool'` | 路由开关 |

**唯一例外**：当 `source='public_pool'` 时，`deck_id='pool:1'` 等**不存在于 character_deck 表**。DELETE 会返回 `rowCount=0`（不影响事务），但 T053 直接提前 return 跳过事务调用，避免无谓 SQL。

---

## 3. 模块设计

### 3.1 `src/services/battleActionService.ts`（修改）

**新增内部函数**：

```typescript
/**
 * T053 卡牌消耗：DB 实时删除 character_deck + player_cards 行
 * - source='public_pool' → 跳过（不调事务）
 * - source='deck' → BEGIN → 双 DELETE → COMMIT
 * - 任一失败 → ROLLBACK + warn/error，不抛错（best-effort）
 * - 调用方不检查返回值
 *
 * @param handCard 客户端传的手牌对象（含 card_id / deck_id / source）
 * @param characterId 当前 actor 的 character_id（仅用于日志/debug）
 * @returns { consumed: boolean, reason?: string }
 *   - { consumed: true }：DB 双行已删
 *   - { consumed: false, reason: 'public_pool' }：公共池卡，跳过
 *   - { consumed: false, reason: 'partial' }：DELETE 返回 0 行（幂等边界）
 *   - { consumed: false, reason: 'error' }：事务异常，已 ROLLBACK
 */
async function consumePlayerCard(
  handCard: HandCard,
  characterId: string
): Promise<{ consumed: boolean; reason?: string }>;
```

**实现细节**：

```typescript
async function consumePlayerCard(
  handCard: HandCard,
  characterId: string
): Promise<{ consumed: boolean; reason?: string }> {
  // 公共池卡：跳过事务
  if (handCard.source === 'public_pool') {
    return { consumed: false, reason: 'public_pool' };
  }

  try {
    await query('BEGIN');

    const deckResult = await query(
      'DELETE FROM character_deck WHERE id = $1',
      [handCard.deck_id]
    );
    const cardResult = await query(
      'DELETE FROM player_cards WHERE id = $1',
      [handCard.card_id]
    );

    // 幂等边界：双删任一返回 0 行（已被别的路径删了）
    if (deckResult.rowCount === 0 || cardResult.rowCount === 0) {
      await query('ROLLBACK');
      console.warn(
        `[consumePlayerCard] partial delete: charId=${characterId} ` +
        `deckRows=${deckResult.rowCount} cardRows=${cardResult.rowCount} ` +
        `deckId=${handCard.deck_id} cardId=${handCard.card_id}`
      );
      return { consumed: false, reason: 'partial' };
    }

    await query('COMMIT');
    return { consumed: true };
  } catch (err) {
    try { await query('ROLLBACK'); } catch { /* ignore */ }
    console.error(
      `[consumePlayerCard] failed: charId=${characterId} ` +
      `deckId=${handCard.deck_id} cardId=${handCard.card_id} ` +
      `error=${(err as Error).message}`
    );
    return { consumed: false, reason: 'error' };
  }
}
```

**注意**：
- 不导出（不加 `export`），仅 battleActionService 内部使用 — 单一职责
- 失败时不抛错：上层 `executePlayCard` 步骤 9.5 调完后立即进入步骤 10 broadcast，不需要做错误处理
- 三个 reason 字段都是 debug-only，不返给客户端（客户端协议不变）

**`executePlayCard` 改造**（在步骤 9 与步骤 10 之间插入步骤 9.5）：

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

**关键不变量**：
- 步骤 9.5 之前：手牌已 `lRem`、能量已扣、弃牌堆已写
- 步骤 9.5 之后：DB 行已删（best-effort，可能未删成功）
- 步骤 10 之后：客户端收到 hand/character 广播，看到「手牌少一张 + 能量少 cost」+（后续 GET /api/cards/my/list 时看到库存少 1）
- 步骤 12 之后：executeEndStep 触发，本步 turn 切换继续

### 3.2 `src/services/battleActionService.test.ts`（追加 5 个 case）

| 编号 | describe 块 | 用例 | 期望 |
|------|-------------|------|------|
| 1 | `executePlayCard — T053 card consumption` | source='deck' 正常打牌 | `consumePlayerCard` 内调用 `query('BEGIN')` + 2 个 DELETE + `query('COMMIT')`；mock `query` 验证调用顺序 |
| 2 | 同上 | source='public_pool' | `query('BEGIN')` **不**被调；只有 0 个 DELETE 调用 |
| 3 | 同上 | DELETE 第二条抛错（mock throw on second DELETE） | `query('ROLLBACK')` 被调；`COMMIT` **不**被调；executePlayCard 仍返回 success（best-effort 不影响上层） |
| 4 | 同上 | `deckResult.rowCount === 0`（mock 第一次 DELETE 返回 rowCount=0） | `query('ROLLBACK')` 被调；warn 日志（用 spyOn console.warn 验证）；executePlayCard 仍 success |
| 5 | 同上 | T050 旧 18 测试零修改通过 | 步骤 9.5 之后：手牌/能量/广播/phase 推进不变 |

**总计 5 个新 case**（T050 既有 18 个不变）。

### 3.3 无文件清单外改动

T053 **不**改：
- ❌ `src/services/handService.ts`（drawCards / addToDiscardPile / retainHandOnStepEnd 都不动）
- ❌ `src/services/battleService.ts`（validateAttack / validateAOEAttack / validateTauntCard 不动）
- ❌ `src/services/characterService.ts`（既有 `removeCardFromCharacter` 不复用 — 它是手动 API，不在战斗回路内）
- ❌ `src/socket/battleRoom.ts`（handleBattlePlayCard 不变）
- ❌ `src/socket/socketServer.ts`（不注册新事件）
- ❌ `src/migrations/*`（无新增 migration）
- ❌ WS 事件协议（`battle:play_card` 客户端入参 / `battle:play_card:error` 服务端返错 完全不变）

---

## 4. 触发流程图

```
T050 executePlayCard
  │ 步骤 1-8: 验证 / 扣能量 / lRem 手牌
  │
  ├─ 步骤 9: addToDiscardPile (if source='deck')
  │   └─ 成功 / 失败 → side_effect_failed
  │
  ├─ 步骤 9.5 ★ T053: consumePlayerCard(handCard, characterId)
  │   ├─ if source='public_pool' → return { consumed: false, reason: 'public_pool' } （不调 query）
  │   └─ else:
  │       ├─ query('BEGIN')
  │       ├─ query('DELETE FROM character_deck WHERE id = $1', [deck_id])
  │       ├─ query('DELETE FROM player_cards WHERE id = $1', [card_id])
  │       ├─ if 任一 rowCount === 0:
  │       │   ├─ query('ROLLBACK')
  │       │   ├─ console.warn('partial delete ...')
  │       │   └─ return { consumed: false, reason: 'partial' }
  │       ├─ else:
  │       │   ├─ query('COMMIT')
  │       │   └─ return { consumed: true }
  │       └─ catch (err):
  │           ├─ try query('ROLLBACK') catch ignore
  │           ├─ console.error('failed ...')
  │           └─ return { consumed: false, reason: 'error' }
  │
  ├─ 步骤 10-11: broadcastHandState / broadcastCharacterStatus
  │
  ├─ 步骤 12: completePlayPhase
  │
  └─ 步骤 13-17: executeEndStep 级联 / phase 推进 / 回合切换
```

**关键不抛错**：`consumePlayerCard` 内部 try/catch 完整捕获，不会向上抛。`executePlayCard` 步骤 9.5 后面是 `await`，不检查返回值，直接进入步骤 10。

---

## 5. 验证规则

### 5.1 正常路径

| 输入 | 期望 SQL 调用顺序 | DB 最终状态 |
|------|------------------|------------|
| `source='deck'` | BEGIN → DELETE character_deck → DELETE player_cards → COMMIT | 两行都不存在 |
| `source='public_pool'` | （无 SQL） | （无变化） |

### 5.2 异常路径

| 场景 | mock 行为 | 期望 SQL | 日志 | executePlayCard 返回 |
|------|----------|----------|------|---------------------|
| DELETE 第一次抛错 | `query` 第一次 throw | BEGIN → DELETE 失败 → ROLLBACK | console.error | success（不返错） |
| DELETE 第二次抛错 | `query` 第二次 throw | BEGIN → DELETE 1 → DELETE 2 失败 → ROLLBACK | console.error | success |
| deck rowCount=0 | mock DELETE 1 返回 `{ rowCount: 0 }` | BEGIN → DELETE 1 → DELETE 2 → ROLLBACK | console.warn | success |
| card rowCount=0 | mock DELETE 2 返回 `{ rowCount: 0 }` | BEGIN → DELETE 1 → DELETE 2 → ROLLBACK | console.warn | success |
| ROLLBACK 抛错 | mock ROLLBACK throw | BEGIN → ... → ROLLBACK 失败 → catch ignore | console.error | success |

### 5.3 边界条件

| 情况 | 行为 |
|------|------|
| 同一张牌被同一 actor 两次打（理论不可能 — 手牌已 lRem） | 第二次 delete 第一次 rowCount=0 → ROLLBACK + warn（幂等） |
| 跨 actor 拿同一张牌（理论不可能 — character_deck 已分片） | DELETE 第一次 rowCount=0 → ROLLBACK + warn（防御） |
| 战斗中途玩家断线 | T046+ 范围；T053 步骤 9.5 之前已发生的 DB 写不会回滚（lRem 也不回滚，状态保持最后一致） |
| 战斗结束后 T054 重新查 player_cards | 看不到已消耗的卡牌（DB 行已删） |
| 玩家打出致命一击（同回合触发 T052 胜利） | T053 步骤 9.5 先于 T052 recordVictory 触发（同一回合内：executePlayCard 步骤 9.5 → executeEndStep 步骤 12.x T052 recordVictory）。致命一击的卡牌会被 T053 消耗，T052 持久化 winner 时该牌已不在 player_cards，符合预期 |
| 玩家手牌是 T1001 之前造的「旧 deck 卡」 | source='deck' 路径不变，DELETE 仍能执行（PK 查询） |

### 5.4 T053 与上下游的边界

| 上下游 | T053 行为 |
|--------|----------|
| T032 卡牌分配 | 仅 INSERT character_deck；T053 反向 DELETE，两端解耦 |
| T037 抽牌 | source='deck' 时从 character_deck 抽；T053 DELETE 后该牌不再可抽（已无 character_deck 行） |
| T038 保留手牌 | T053 不动 retain；保留后被打的牌仍会 DELETE（lRem + addToDiscardPile + consumePlayerCard 顺序保留） |
| T050 17 步流水线 | 步骤 9 之后插入 9.5；步骤 10+ 流程不变 |
| T051 executeEndStep | 不感知 T053；T053 步骤 9.5 失败不影响 executeEndStep 调用 |
| T052 recordVictory | 在 executeEndStep 末尾；T053 步骤 9.5 在 executePlayCard 末尾。两者在不同时间点 |
| T056 applyDamage | 范围外（applyDamage 负责 HP，T053 负责卡牌库存） |

---

## 6. 数据流（DB + Redis）

### 6.1 读取

T053 `consumePlayerCard` 不读 DB / 不读 Redis（仅根据 `handCard.source` 决定走哪条路径）。

### 6.2 写入

| 操作 | 表 | 语句 |
|------|----|------|
| 写 | character_deck | DELETE FROM character_deck WHERE id = $1（PK 查询） |
| 写 | player_cards | DELETE FROM player_cards WHERE id = $1（PK 查询） |
| 事务 | — | BEGIN / COMMIT / ROLLBACK（用 `query` 直接执行 SQL 字符串） |

### 6.3 事务边界

- **BEGIN → DELETE 1 → DELETE 2 → COMMIT** 是单事务原子操作
- 任何一步失败 → ROLLBACK 撤销已成功的 DELETE
- 验证：`query` 内部用 `pool.connect()` 拿客户端 + `client.query('BEGIN')` + `client.query('DELETE ...')` × 2 + `client.query('COMMIT')` + `client.release()`

**重要**：项目 `query` 封装使用**每次调用重新 pool.connect()** 模式（参考既有 migration 002 等）。这里 BEGIN/COMMIT/ROLLBACK 在不同 `query` 调用之间，需要确认连接复用 — 详见 §7.4 风险点。

### 6.4 副作用顺序（严格按序）

```
executePlayCard（步骤 9 → 9.5 → 10）：
  9. addToDiscardPile(handCard)  [Redis 写 LIST]
  9.5. consumePlayerCard(handCard, characterId)  [DB 事务]
       ├─ if source='public_pool' → skip
       └─ else: BEGIN → DELETE character_deck → DELETE player_cards → COMMIT
  10. broadcastHandState + broadcastCharacterStatus  [WS 推送]
  11. completePlayPhase
  12-17. executeEndStep 级联
```

---

## 7. 关键技术决策

### 7.1 决策表

| 决策 | 选择 | 理由 |
|------|------|------|
| 触发时机 | 实时（executePlayCard 步骤 9.5） | 玩家期望「打牌 → 库存 -1」原子；T054 结算无需重新遍历弃牌堆；与 T050 既有控制流解耦 |
| 删除范围 | `character_deck` + `player_cards` 双删 | spec 「卡牌为消耗品」语义；FK CASCADE 虽能自动删 character_deck，但显式双删可控可测 |
| 失败处理 | best-effort + console.error + 不返错 | 上游（lRem / 能量扣 / 广播）已成功，回滚代价大；不返错避免客户端收到 1 张已 lRem 的牌却报错 |
| 事务策略 | 单 BEGIN/COMMIT/ROLLBACK | 避免「character_deck 删了 player_cards 没删」的中间态（野牌） |
| 公共池卡 | 提前 return 跳过 | 不在 player_cards，无 DELETE 必要；与 T1001 设计一致 |
| ID 映射 | card_id → player_cards.id，deck_id → character_deck.id | PK 查询，O(1)；与 T050 dispatch 一致（validateAttack 也用 card_id） |
| 失败 reason | debug-only 字段（'public_pool' / 'partial' / 'error'） | 不返给客户端，仅日志 / 监控可读 |
| 事务 SQL 写法 | `query('BEGIN')` 等字符串 | 与既有 `query` 封装一致；不需要新引入 pool.connect() 显式连接管理 |
| 步骤定位 | 步骤 9 之后、步骤 10 之前 | 弃牌堆记录是「游戏内事件」，DB 删是「数据落地」；广播之前完成数据落地，前端无「库存延迟」感知 |
| 不复用 removeCardFromCharacter | 新写 `consumePlayerCard` | removeCardFromCharacter 是手动 API（无事务、单条 DELETE、抛错失败），与 T053 best-effort 实时事务语义不同 |
| T053 不动 T050 既有 8 error 变体 | 是 | 「不返错」是显式决策；不是疏忽 |
| T053 不抛错给 socketServer 兜底 | 是 | best-effort 失败已 `console.error`；socketServer 兜底仅用于「未捕获异常」 |

### 7.2 与 T052 的边界

T052 `recordVictory` 在 `executeEndStep` 末尾；T053 步骤 9.5 在 `executePlayCard` 末尾 → T051 `executeEndStep` 内部。两者**不冲突**：
- 玩家打最后一张牌 → 步骤 9.5 删 DB 行 → 步骤 10-12 广播 + 阶段推进 → 步骤 12 executeEndStep → 步骤 12.x applyKillStars → 步骤 12.y recordVictory
- 玩家最后一张牌打中后立即胜利 → 步骤 9.5 仍执行（best-effort），T052 recordVictory 后 T054 结算时看不到该牌（已删）

### 7.3 与 T1001 公共池的边界

T1001 明确：公共池卡走 `card_templates` 表（`is_public_pool=TRUE`），不入 `player_cards` 表。T053 直接提前 return 跳过事务调用。

### 7.4 风险点：事务连接复用

**风险描述**：`query` 封装每次调用 `pool.connect()` 拿新连接，导致 BEGIN/DELETE/COMMIT 在不同物理连接上 → PostgreSQL 事务在第二个连接上不可见 → COMMIT 实际不生效。

**缓解措施（实施阶段决定）**：
- **方案 A（推荐）**：使用 `pool.connect()` 拿客户端，所有 SQL 在同一客户端上执行，最后 `client.release()`
- **方案 B**：保持 `query` 封装，但确认 backend 既有 `query` 是否已经做了连接复用（查 backend/src/config/database.ts）
- **方案 C**：在 `query` 内部加「事务模式」标识，单连接内执行 BEGIN/DELETE/COMMIT

**T053 实施前置检查**：在 plan 阶段先 read `backend/src/config/database.ts` 确认 `query` 封装的事务支持能力。

### 7.5 不做的设计

- ❌ 不引入新 service 文件（`consumePlayerCard` 仅在 battleActionService 内部）
- ❌ 不引入新 WS 事件
- ❌ 不引入新 Redis 键
- ❌ 不引入新 migration
- ❌ 不引入新 T050 error 变体
- ❌ 不修改 T049/T050/T051/T052 任何代码（仅在 executePlayCard 步骤 9 之后插入 9.5）

---

## 8. 测试设计

### 8.1 单元测试（`battleActionService.test.ts` 追加 5 case）

#### Test 1: source='deck' happy path

```typescript
it('T053: source=deck happy path — BEGIN + 2 DELETE + COMMIT, returns success', async () => {
  // mock query: BEGIN → { rowCount: 1 } → { rowCount: 1 } → COMMIT
  // mock validateAttack returns valid
  // mock getActorHand returns hand with deck_id matching handCard.deck_id
  // expect: query called with 'BEGIN', 'DELETE FROM character_deck WHERE id = $1', 'DELETE FROM player_cards WHERE id = $1', 'COMMIT'
  // expect: result.success === true
});
```

#### Test 2: source='public_pool' skip

```typescript
it('T053: source=public_pool — does NOT call query with BEGIN/DELETE/COMMIT', async () => {
  // mock query as spy
  // call executePlayCard with handCard.source = 'public_pool'
  // expect: query NOT called with 'BEGIN' or 'DELETE' or 'COMMIT'
  // expect: result.success === true
});
```

#### Test 3: DELETE 第二次抛错 → ROLLBACK + success

```typescript
it('T053: DELETE player_cards throws — ROLLBACK called, executePlayCard still returns success', async () => {
  // mock query: BEGIN → { rowCount: 1 } → throw Error('DB error') → ROLLBACK
  // mock console.error spy
  // expect: query called with 'ROLLBACK'
  // expect: console.error called with [consumePlayerCard] failed
  // expect: result.success === true (best-effort)
});
```

#### Test 4: deck rowCount=0 → ROLLBACK + warn

```typescript
it('T053: character_deck rowCount=0 — ROLLBACK + warn, executePlayCard still success', async () => {
  // mock query: BEGIN → { rowCount: 0 } → { rowCount: 1 } → ROLLBACK
  // mock console.warn spy
  // expect: query called with 'ROLLBACK'
  // expect: console.warn called with 'partial delete'
  // expect: result.success === true
});
```

#### Test 5: T050 旧测试兼容性

```typescript
it('T053: T050 existing 18 tests — all pass with step 9.5 inserted, no test modification needed', async () => {
  // 跑完整 T050 describe('executePlayCard', ...) 18 case（已存在）
  // 不新增任何 mock，依赖默认 query mock
  // 期望：18 case 全绿
});
```

**总计 5 个新 case**（T050 既有 18 个不变）。

### 8.2 不写新集成测试

T054 对战结算 API 阶段会做端到端验证（GET /api/cards/my/list 查消耗后库存）。T053 沿用 T050 模式仅单元测。

### 8.3 不写新 Socket / Handler 测试

`handleBattlePlayCard` 协议不变；`socketServer.test.ts` 不动。

---

## 9. 文件清单

| 路径 | 改动 |
|------|------|
| `src/services/battleActionService.ts` | **修改** —— 新增内部 `consumePlayerCard(handCard, characterId)` 函数（~40 行）+ executePlayCard 步骤 9.5 插入（1 行 await） |
| `src/services/battleActionService.test.ts` | **修改** —— 追加 5 个 T053 case（~150 行） |

**总计 ~50 行生产代码 + ~150 行测试代码**。

---

## 10. 范围外（明确不做）

- ❌ **批量结算模式** —— 选实时消耗路径
- ❌ **「used」标记 + 后台清理** —— 选直接 DELETE 路径
- ❌ **退款 / 撤销** —— 不存在语义
- ❌ **异步队列 / 重试** —— best-effort + 日志
- ❌ **失败时回滚 Redis 手牌 / 能量 / 广播** —— 避免更严重不一致
- ❌ **失败时返回 error 变体** —— T050 现有 8 个 error 不变
- ❌ **5v5 / NvN 模式** —— 后续任务
- ❌ **客户端 UI（库存刷新提示）** —— 前端任务
- ❌ **公共池卡扩展为多张** —— 后续任务（仅「轻击」入池）
- ❌ **consumed=false 时的客户端通知** —— debug-only，不返给客户端
- ❌ **卡牌消耗统计 / 监控埋点** —— 后续任务

---

## 附录 A：常量定义

T053 **无新常量**。所有路径字符串（'BEGIN'、'DELETE ...'）和日志前缀（'[consumePlayerCard]'）内联在函数内。

## 附录 B：失败 reason 枚举

```typescript
type ConsumeReason = 'public_pool' | 'partial' | 'error';
```

| reason | 触发条件 | 日志级别 | 含义 |
|--------|---------|---------|------|
| `public_pool` | `handCard.source === 'public_pool'` | （无日志） | 公共池卡，无 DB 删除 |
| `partial` | 至少一个 DELETE 返回 `rowCount === 0` | warn | 幂等边界：行已被别的路径删了 |
| `error` | 任何 SQL 抛错 | error | 事务异常，已 ROLLBACK |

**reason 字段不返给客户端**：T053 不修改 `PlayCardResult` 类型。

## 附录 C：与 T056 的整合预留

T056 实施「伤害计算权威化」时，applyDamage 接管所有 HP 减少源。T053 步骤 9.5 仍由 executePlayCard 触发，不依赖 T056。

**可能的后续整合点**（T056 范围决定）：
- T056 完成后可考虑把 `consumePlayerCard` 调用从 executePlayCard 步骤 9.5 移到 T056 内部（让 T056 统一管理「出牌 → HP -1 + 库存 -1 + 效果应用」）。当前不在 T053 范围。

---

*文档版本：v1.0*
*最后更新：2026-06-18*
