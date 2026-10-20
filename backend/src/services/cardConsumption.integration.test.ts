// T1018 卡牌消耗 —— 真实 PostgreSQL + Redis 集成测试
//
// ★ 为什么必须有真库测试
//   T053 的原实现（出牌时实时 DELETE character_deck + player_cards）在纯 mock
//   测试下永远「绿」：断言的是「调用了 DELETE 语句」而不是「行真的消失了」。
//   而两条 DELETE 在同一事务内顺序执行、第二条的子查询又引用了第一条刚删掉的
//   character_deck 行 → 恒 0 行 → PartialDeleteError → 整体 ROLLBACK
//   → 实际什么都没删。这个 bug 从 2026-06-18 存活到 2026-10-20 才被发现。
//
//   本文件用真库验证「行真的消失了」——mock 永远测不出这类 bug。
//
// ★ 依赖真实 PG + Redis（CI 已具备；本地无依赖时优雅跳过）
//   本地无 PG/Redis 时全部用例跳过并打印醒目告警；
//   但 CI 环境（process.env.CI === 'true'）下若依赖缺失则直接失败，
//   保证 CI 一定真正跑到这些断言。

import { randomUUID } from 'crypto';
import { pool, query } from '../config/database';
import { redisClient, connectRedis } from '../config/redis';
import {
  consumeDeckCardOnPlay,
  getConsumedCardIdSet,
  settleCardConsumption,
} from './cardConsumptionService';

// ========================================
// 基础设施探测
// ========================================

let infraReady = false;
let skipReason = '';

const BATTLE_ID_KEY_SUFFIX = 't1018-it';

/** fixture id 集合（afterAll 清理用） */
const created = {
  battles: [] as string[],
  playerCards: [] as string[],
  characterDecks: [] as string[],
  characters: [] as string[],
  players: [] as string[],
  users: [] as string[],
  templates: [] as string[],
};

beforeAll(async () => {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
  } catch (err) {
    skipReason = `PostgreSQL 不可用: ${(err as Error).message}`;
    return;
  }

  // migration 014 未应用时 cards_settled_at 列不存在，跳过（避免误报失败）
  try {
    const cols = await query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'battles' AND column_name = 'cards_settled_at'`
    );
    if (cols.length === 0) {
      skipReason = 'migration 014 未应用（battles.cards_settled_at 列缺失）——请先跑 npm run db:migrate';
      return;
    }
  } catch (err) {
    skipReason = `检查 battles 列失败: ${(err as Error).message}`;
    return;
  }

  try {
    await connectRedis();
  } catch (err) {
    skipReason = `Redis 不可用: ${(err as Error).message}`;
    return;
  }

  infraReady = true;
});

afterAll(async () => {
  if (infraReady) {
    // 清理顺序：先子表后父表
    await query(`DELETE FROM character_deck WHERE id = ANY($1::uuid[])`, [created.characterDecks]);
    await query(`DELETE FROM player_cards WHERE id = ANY($1::uuid[])`, [created.playerCards]);
    await query(`DELETE FROM battles WHERE id = ANY($1::uuid[])`, [created.battles]);
    await query(`DELETE FROM characters WHERE id = ANY($1::uuid[])`, [created.characters]);
    await query(`DELETE FROM players WHERE id = ANY($1::uuid[])`, [created.players]);
    await query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [created.users]);
    await query(`DELETE FROM card_templates WHERE id = ANY($1::uuid[])`, [created.templates]);
    if (BATTLE_ID) {
      await redisClient.del(`battle:${BATTLE_ID}:consumed_cards`);
      await redisClient.del(`battle:${BATTLE_ID}:deck:${CHAR_ID}`);
    }
  }
  await pool.end().catch(() => undefined);
  if (redisClient.isOpen) {
    await redisClient.disconnect().catch(() => undefined);
  }
});

// ========================================
// Fixture 构造
// ========================================

// battles.id / characters.id 等列是 UUID 类型 —— fixture 必须用真 UUID
// （真库集成测试的价值：字符串常量会被 PG 直接拒掉，mock 永远测不出来）
let BATTLE_ID = '';
let CHAR_ID = '';

interface Fixture {
  p1Id: string;
  p2Id: string;
  p1CardId: string;
  p2CardId: string;
  deckId: string;
}
let fx: Fixture;

beforeEach(async () => {
  if (!infraReady) return;

  const suffix = randomUUID().slice(0, 8);
  const u1 = randomUUID();
  const u2 = randomUUID();
  const p1 = randomUUID();
  const p2 = randomUUID();
  const tpl = randomUUID();
  const pc1 = randomUUID();
  const pc2 = randomUUID();
  const deck = randomUUID();
  BATTLE_ID = randomUUID();
  CHAR_ID = randomUUID();
  // template_no 有 UNIQUE 约束（migration 004）——每个用例用不同值
  const templateNo = 90000 + Math.floor(Math.random() * 9000);

  created.users.push(u1, u2);
  created.players.push(p1, p2);
  created.characters.push(CHAR_ID);
  created.playerCards.push(pc1, pc2);
  created.characterDecks.push(deck);
  created.templates.push(tpl);
  created.battles.push(BATTLE_ID);

  await query(
    `INSERT INTO users (id, username, password_hash) VALUES ($1, $2, 'x'), ($3, $4, 'x')`,
    [u1, `t1018_u1_${suffix}`, u2, `t1018_u2_${suffix}`]
  );
  await query(
    `INSERT INTO players (id, user_id) VALUES ($1, $2), ($3, $4)`,
    [p1, u1, p2, u2]
  );
  await query(
    `INSERT INTO characters (id, player_id, name, profession) VALUES ($1, $2, 'T1018战士', 'warrior')`,
    [CHAR_ID, p1]
  );
  await query(
    `INSERT INTO card_templates (id, name, type, cost, effect, profession, template_no, max_quantity)
     VALUES ($1, $2, 'attack', 1, '{"damage": 2}', 'common', $3, 5)`,
    [tpl, `T1018测试卡_${suffix}`, templateNo]
  );
  await query(
    `INSERT INTO player_cards (id, player_id, card_template_id, name, type, cost, effect, quantity, card_sequence)
     VALUES ($1, $2, $5, 'T1018测试卡', 'attack', 1, '{"damage": 2}', 1, 1),
            ($3, $4, $5, 'T1018测试卡', 'attack', 1, '{"damage": 2}', 1, 1)`,
    [pc1, p1, pc2, p2, tpl]
  );
  await query(
    `INSERT INTO character_deck (id, character_id, player_card_id) VALUES ($1, $2, $3)`,
    [deck, CHAR_ID, pc1]
  );
  await query(
    `INSERT INTO battles (id, player1_id, player2_id, status) VALUES ($1, $2, $3, 'finished')`,
    [BATTLE_ID, p1, p2]
  );

  fx = { p1Id: p1, p2Id: p2, p1CardId: pc1, p2CardId: pc2, deckId: deck };

  // 对局卡组快照：p1 的棋子带着 1 张卡
  await redisClient.set(
    `battle:${BATTLE_ID}:deck:${CHAR_ID}`,
    JSON.stringify([{ deck_id: pc1, card_id: pc1, name: 'T1018测试卡', type: 'attack', cost: 1, effect: { damage: 2 }, template_no: templateNo }])
  );
  await redisClient.del(`battle:${BATTLE_ID}:consumed_cards`);
});

// ========================================
// 用例
// ========================================

/** 无 PG/Redis 时跳过（CI 下改为显式失败） */
function itWithInfra(name: string, fn: () => Promise<void>): void {
  it(name, async () => {
    if (!infraReady) {
      if (process.env.CI === 'true') {
        throw new Error(
          `[T1018 integration] CI 环境必须有 PG + Redis，但不可用: ${skipReason}`
        );
      }
      console.warn(`[T1018 integration] SKIPPED — ${skipReason} :: ${name}`);
      return;
    }
    await fn();
  });
}

describe('T1018 集成：卡牌消耗（真库）', () => {
  itWithInfra('I1: 出牌后从对局卡组快照移除该牌 + 记入消耗清单', async () => {
    const result = await consumeDeckCardOnPlay(
      BATTLE_ID, CHAR_ID, fx.p1CardId, fx.p1CardId, 'deck'
    );

    expect(result).toEqual({ ok: true, deckRemoved: true, recorded: true });

    // 快照里已经没有这张卡
    const snap = JSON.parse((await redisClient.get(`battle:${BATTLE_ID}:deck:${CHAR_ID}`))!);
    expect(snap.find((r: { deck_id: string }) => r.deck_id === fx.p1CardId)).toBeUndefined();

    // 消耗清单里有
    const consumed = await getConsumedCardIdSet(BATTLE_ID);
    expect(consumed.has(fx.p1CardId)).toBe(true);
  });

  itWithInfra('I2: 对局结束扣库存 — player_cards 行真的消失 + character_deck 级联消失', async () => {
    // ★ 这一条正是 T053 当初没验证到的：行是否真的被删掉
    await consumeDeckCardOnPlay(BATTLE_ID, CHAR_ID, fx.p1CardId, fx.p1CardId, 'deck');

    const result = await settleCardConsumption(BATTLE_ID, fx.p1Id, fx.p2Id);
    expect(result).toEqual({ ok: true, deducted: 1, alreadySettled: false });

    // player_cards 行真的没了
    const cards = await query<{ id: string }>(
      'SELECT id FROM player_cards WHERE id = $1',
      [fx.p1CardId]
    );
    expect(cards).toHaveLength(0);

    // character_deck 行被 ON DELETE CASCADE 连带清掉
    const decks = await query<{ id: string }>(
      'SELECT id FROM character_deck WHERE id = $1',
      [fx.deckId]
    );
    expect(decks).toHaveLength(0);

    // 对手方的卡不受影响
    const p2cards = await query<{ id: string }>(
      'SELECT id FROM player_cards WHERE id = $1',
      [fx.p2CardId]
    );
    expect(p2cards).toHaveLength(1);
  });

  itWithInfra('I3: 幂等 — 第二次结算不再扣（cards_settled_at 标记）', async () => {
    await consumeDeckCardOnPlay(BATTLE_ID, CHAR_ID, fx.p1CardId, fx.p1CardId, 'deck');

    const first = await settleCardConsumption(BATTLE_ID, fx.p1Id, fx.p2Id);
    expect(first).toEqual({ ok: true, deducted: 1, alreadySettled: false });

    const second = await settleCardConsumption(BATTLE_ID, fx.p1Id, fx.p2Id);
    expect(second).toEqual({ ok: true, deducted: 0, alreadySettled: true });
  });

  itWithInfra('I4: 归属复核 — 清单里混入非本局玩家的卡 id 时不会被误删', async () => {
    // 造一个「局外第三方玩家」的卡 —— 他不是本局参与者，
    // 就算他的 card_id 混进了消耗清单也不能被删（DELETE 带 player_id 复核）
    const u3 = randomUUID();
    const p3 = randomUUID();
    const pc3 = randomUUID();
    created.users.push(u3);
    created.players.push(p3);
    created.playerCards.push(pc3);
    await query(
      `INSERT INTO users (id, username, password_hash) VALUES ($1, $2, 'x')`,
      [u3, `t1018_u3_${randomUUID().slice(0, 8)}`]
    );
    await query(`INSERT INTO players (id, user_id) VALUES ($1, $2)`, [p3, u3]);
    await query(
      `INSERT INTO player_cards (id, player_id, card_template_id, name, type, cost, effect, quantity, card_sequence)
       SELECT $1, $2, ct.id, ct.name, ct.type, ct.cost, ct.effect, 1, 1
       FROM card_templates ct WHERE ct.name LIKE 'T1018测试卡_%' LIMIT 1`,
      [pc3, p3]
    );

    // 把局外玩家的卡 id 塞进本局消耗清单
    await redisClient.sAdd(`battle:${BATTLE_ID}:consumed_cards`, pc3);

    const result = await settleCardConsumption(BATTLE_ID, fx.p1Id, fx.p2Id);

    // 归属复核拦下 —— 局外玩家的卡一张都没被删
    expect(result).toEqual({ ok: true, deducted: 0, alreadySettled: false });
    const p3cards = await query<{ id: string }>(
      'SELECT id FROM player_cards WHERE id = $1',
      [pc3]
    );
    expect(p3cards).toHaveLength(1);
  });

  itWithInfra('I5: 双方各自的卡分别扣到各自名下', async () => {
    await consumeDeckCardOnPlay(BATTLE_ID, CHAR_ID, fx.p1CardId, fx.p1CardId, 'deck');
    // p2 也打出一张（对手棋子用不同快照 key，这里直接记清单模拟）
    await redisClient.sAdd(`battle:${BATTLE_ID}:consumed_cards`, fx.p2CardId);

    const result = await settleCardConsumption(BATTLE_ID, fx.p1Id, fx.p2Id);

    expect(result).toEqual({ ok: true, deducted: 2, alreadySettled: false });
    const p1 = await query('SELECT id FROM player_cards WHERE id = $1', [fx.p1CardId]);
    const p2 = await query('SELECT id FROM player_cards WHERE id = $1', [fx.p2CardId]);
    expect(p1).toHaveLength(0);
    expect(p2).toHaveLength(0);
  });
});
