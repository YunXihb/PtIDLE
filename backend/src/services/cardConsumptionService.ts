// ========================================
// T1018 卡牌消耗服务
// ========================================
// 两级扣减模型（用户 T1018 决策）：
//
// 【对局内】出牌时实时扣「对局牌库」
//   - 从对局卡组快照（Redis battle:{id}:deck:{cid}）移除该牌
//     → 同一张牌本局只能打出一次，防止被多次消耗
//   - 把 player_cards.id 记入本局消耗清单（Redis SET battle:{id}:consumed_cards）
//   - 公共池卡（source='public_pool'）跳过：无限复用，不入库存、不扣牌库
//     （specs.md §3.5：公共池卡「不入 player_cards，无归属；打出后回池」）
//
// 【对局外】对局结束时一次性扣「玩家库存」
//   - 读消耗清单 → DELETE FROM player_cards WHERE id = ANY(...) AND player_id = ?
//   - 释放玩家的卡牌数量上限额度（card_templates.max_quantity）
//   - 幂等：battles.cards_settled_at（migration 014）
//   - 触发点：recordVictory（服务端权威终局漏斗）+ settleBattle（兜底）
//
// 【为什么库存不实时扣】
//   库存扣减延后到对局结束，保证：
//   1) 扣减数量 = 本局「实际消耗量」，而不是「尝试消耗量」
//   2) 中途退出/断线/异常终局都由服务端终局路径统一处理，不依赖客户端调用
//   3) 对局内卡牌库视图稳定（牌库 UI 不会在战斗中跳变）
//
// 【历史背景：T053 的 bug】
//   T053 原本在出牌时实时 DELETE character_deck + player_cards，但：
//   - 两条 DELETE 在同一事务内顺序执行，第二条的子查询引用了第一条刚删掉的行
//     → 恒 0 行 → PartialDeleteError → 整体 ROLLBACK → 什么都没删
//   - T1012 引入快照制后 deck_id 语义从 character_deck.id 漂移为 player_cards.id
//   - 牌库快照 battle:{id}:deck:{cid} 从写入起就只读不删，「牌库消耗」从未实现
//   本服务重建了这条链路，并按用户决策拆分为「对局内扣牌库 / 对局外扣库存」两级。

import { redisClient } from '../config/redis';
import { withTransaction } from '../config/database';
import type { PoolClient } from 'pg';
import { redisKey } from '../utils/redisKeys';

// ========================================
// 类型
// ========================================

/** 快照行最小结构（与 deploymentService.DeckSnapshotRow 同构，此处不重复 import 避免耦合） */
interface DeckSnapshotRowLike {
  deck_id: string;
  card_id: string;
}

export type CardSource = 'deck' | 'public_pool';

export type PlayConsumeResult =
  | { ok: true; deckRemoved: boolean; recorded: boolean }
  | { ok: false; reason: 'public_pool' | 'snapshot_missing' | 'redis_error'; detail?: string };

export type SettleConsumeResult =
  | { ok: true; deducted: number; alreadySettled: boolean }
  | { ok: false; deducted: 0; alreadySettled: false; reason: 'battle_not_found' | 'redis_error'; detail?: string };

/** UUID 形态校验（= ANY($1::uuid[]) 遇到非法 UUID 会整条 SQL 报错，需前置过滤） */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 消耗清单兜底 TTL（秒）：24h。玩家不调结算接口时 battle:{id}:* 不会被清理，防止 key 无限堆积 */
const CONSUMED_LIST_TTL_SECONDS = 24 * 60 * 60;

// ========================================
// 对局内：出牌时扣牌库 + 记消耗清单
// ========================================

/**
 * T1018: 出牌时实时扣减「对局牌库」，并把该卡记入本局消耗清单。
 *
 * 1. 公共池卡跳过（无限复用，不入库存、不扣牌库）
 * 2. 从对局卡组快照移除该牌 → 同一张牌本局不能被再次抽到/打出
 * 3. sAdd 记入本局消耗清单（SET 天然去重）→ 对局结束时据此扣库存
 *
 * best-effort：失败不抛错给上层（出牌效果已结算，不能因扣减失败回滚整个操作）。
 * 调用方（executePlayCard）负责记录日志。
 *
 * @param battleId 对局 id
 * @param characterId 出牌棋子 id（快照按棋子维度存储）
 * @param cardId player_cards.id
 * @param deckId 手牌唯一标识（快照路径下 = card_id；旧 character_deck 路径下 = character_deck.id）
 * @param source 卡牌来源（public_pool 跳过）
 */
export async function consumeDeckCardOnPlay(
  battleId: string,
  characterId: string,
  cardId: string,
  deckId: string,
  source: CardSource
): Promise<PlayConsumeResult> {
  // 1. 公共池卡：无限复用，不消耗
  if (source === 'public_pool') {
    return { ok: false, reason: 'public_pool' };
  }

  // 2. 从对局卡组快照移除该牌
  //    ★ 快照被抽空后必须保留 '[]'，不能 DEL：
  //      handService.drawCards 用 `snapshotRaw !== null` 区分「快照权威」与
  //      「回落 character_deck」，DEL 会让已消耗的牌被重新抽到。
  let deckRemoved = false;
  try {
    const snapRaw = await redisClient.get(redisKey.deck(battleId, characterId));
    if (snapRaw === null) {
      // 快照不存在 = 旧 character_deck 路径（防御性回落，实践中罕见）
      // 该路径下牌库本体在 PG，由结算时的 CASCADE 清理，本函数只记消耗清单
      return await recordConsumption(battleId, cardId, false);
    }

    let rows: DeckSnapshotRowLike[];
    try {
      rows = JSON.parse(snapRaw) as DeckSnapshotRowLike[];
    } catch {
      // 快照 JSON 损坏：无法从中移除，但仍要记消耗清单 ——
      // 否则该卡不会进库存扣减清单，等于玩家白嫖一张卡
      rows = [];
    }

    const next = rows.filter((r) => r.deck_id !== deckId);
    if (next.length !== rows.length) {
      await redisClient.set(
        redisKey.deck(battleId, characterId),
        JSON.stringify(next)
      );
      deckRemoved = true;
    }
  } catch (err) {
    console.error(
      `[T1018] consumeDeckCardOnPlay: snapshot removal failed: ` +
        `battleId=${battleId} charId=${characterId} deckId=${deckId}`,
      err
    );
    return { ok: false, reason: 'redis_error', detail: (err as Error).message };
  }

  // 3. 记入本局消耗清单
  return await recordConsumption(battleId, cardId, deckRemoved);
}

/**
 * 把卡牌记入本局消耗清单（Redis SET）
 * SET 天然去重：同一张卡实例即使被重复记录，结算时也只会扣一次。
 */
async function recordConsumption(
  battleId: string,
  cardId: string,
  deckRemoved: boolean
): Promise<PlayConsumeResult> {
  try {
    const key = redisKey.consumedCards(battleId);
    await redisClient.sAdd(key, cardId);
    // 兜底 TTL：玩家不调 /api/battle/result 时 battle:{id}:* 不会被清理，
    // 给消耗清单设 24h 上界，避免 Redis key 无限堆积（对局本身不可能跑满 24h）。
    await redisClient.expire(key, CONSUMED_LIST_TTL_SECONDS);
    return { ok: true, deckRemoved, recorded: true };
  } catch (err) {
    console.error(
      `[T1018] recordConsumption failed: battleId=${battleId} cardId=${cardId}`,
      err
    );
    return { ok: false, reason: 'redis_error', detail: (err as Error).message };
  }
}

/**
 * 读取本局已消耗的卡牌 id 集合（供 handService.drawCards 过滤，防止重复抽到已消耗的牌）
 *
 * 返回空 Set 表示：清单不存在 / 读失败 / 本局未消耗任何牌。
 * 读失败时保守放行（不阻塞抽牌），真正的硬保证来自快照移除。
 */
export async function getConsumedCardIdSet(battleId: string): Promise<Set<string>> {
  try {
    const members = await redisClient.sMembers(redisKey.consumedCards(battleId));
    return new Set(members);
  } catch (err) {
    console.error(
      `[T1018] getConsumedCardIdSet failed: battleId=${battleId}`,
      err
    );
    return new Set<string>();
  }
}

// ========================================
// 对局外：对局结束时扣玩家库存
// ========================================

/**
 * T1018: 对局结束时，按本局消耗清单扣除玩家卡牌库存。
 *
 * 幂等：battles.cards_settled_at（migration 014）+ 事务内 SELECT ... FOR UPDATE 行锁。
 * 两个调用点（recordVictory / settleBattle）共用本函数，谁先到谁扣，后到的跳过。
 *
 * 归属复核：按 player_id 分别删除，只扣各自名下的卡。
 * 清单里若混入他人/非本局的卡 id，DELETE 影响 0 行，不会误删。
 *
 * @param battleId 对局 id
 * @param p1PlayerId 先手玩家 id
 * @param p2PlayerId 后手玩家 id
 */
export async function settleCardConsumption(
  battleId: string,
  p1PlayerId: string,
  p2PlayerId: string
): Promise<SettleConsumeResult> {
  // 1. 读消耗清单（Redis）
  //    读失败时直接返回、不标记 settled —— 保留重试机会，避免因瞬时故障永久漏扣
  let consumed: string[];
  try {
    consumed = await redisClient.sMembers(redisKey.consumedCards(battleId));
  } catch (err) {
    console.error(
      `[T1018] settleCardConsumption: read consumed list failed: battleId=${battleId}`,
      err
    );
    return { ok: false, deducted: 0, alreadySettled: false, reason: 'redis_error', detail: (err as Error).message };
  }

  // 过滤非法 UUID（= ANY($1::uuid[]) 遇到非法值会整条 SQL 报错）
  const cardIds = consumed.filter((id) => UUID_RE.test(id));

  // 2. 事务内：幂等锁 + 扣库存 + 标记
  return await withTransaction(async (client: PoolClient) => {
    // 2.1 行锁 + 幂等复核
    const lockRes = await client.query<{ cards_settled_at: Date | null }>(
      'SELECT cards_settled_at FROM battles WHERE id = $1 FOR UPDATE',
      [battleId]
    );
    if (lockRes.rows.length === 0) {
      return { ok: false, deducted: 0, alreadySettled: false, reason: 'battle_not_found' };
    }
    if (lockRes.rows[0].cards_settled_at !== null) {
      return { ok: true, deducted: 0, alreadySettled: true };
    }

    // 2.2 双方各自扣（归属复核内联在 WHERE）
    let deducted = 0;
    for (const playerId of [p1PlayerId, p2PlayerId]) {
      if (cardIds.length === 0) break;
      const res = await client.query(
        `DELETE FROM player_cards
         WHERE id = ANY($1::uuid[]) AND player_id = $2`,
        [cardIds, playerId]
      );
      deducted += res.rowCount ?? 0;
    }

    // 2.3 标记已结算
    await client.query(
      'UPDATE battles SET cards_settled_at = NOW(), updated_at = NOW() WHERE id = $1',
      [battleId]
    );

    return { ok: true, deducted, alreadySettled: false };
  });
}
