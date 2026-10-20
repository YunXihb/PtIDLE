// T1018 卡牌消耗服务单测
//
// 覆盖两条链路：
//   1) 对局内：consumeDeckCardOnPlay —— 扣对局牌库（Redis 快照）+ 记本局消耗清单
//   2) 对局外：settleCardConsumption —— 按消耗清单扣 player_cards 库存（幂等）
//
// mock 策略：
//   - redis 用内存 Map 模拟 get/set/del + 内存 Set 模拟 sAdd/sMembers
//   - database 的 withTransaction 用 fake client 模拟，按 SQL 内容路由
const mockWithTransaction = jest.fn();

jest.mock('../config/database', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
  execute: jest.fn(),
  withTransaction: mockWithTransaction,
}));

jest.mock('../config/redis', () => {
  const store = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  return {
    redisClient: {
      get: async (k: string) => store.get(k) ?? null,
      set: async (k: string, v: string) => {
        store.set(k, v);
        return 'OK';
      },
      del: async (k: string) => {
        store.delete(k);
        sets.delete(k);
        return 1;
      },
      sAdd: async (k: string, member: string) => {
        if (!sets.has(k)) sets.set(k, new Set());
        const s = sets.get(k)!;
        if (s.has(member)) return 0;
        s.add(member);
        return 1;
      },
      sMembers: async (k: string) => Array.from(sets.get(k) ?? []),
      expire: async (_k: string, _ttl: number) => true,
      __store: store,
      __sets: sets,
    },
  };
});

import { redisClient } from '../config/redis';
import {
  consumeDeckCardOnPlay,
  getConsumedCardIdSet,
  settleCardConsumption,
} from './cardConsumptionService';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const store = (redisClient as any).__store as Map<string, string>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sets = (redisClient as any).__sets as Map<string, Set<string>>;

const BATTLE_ID = 'b1';
const CHAR_ID = 'c1';
const PL1 = 'player-1';
const PL2 = 'player-2';

const CARD_A = '11111111-1111-4111-8111-111111111111';
const CARD_B = '22222222-2222-4222-8222-222222222222';
const CARD_C = '33333333-3333-4333-8333-333333333333';

const deckKey = (cid: string) => `battle:${BATTLE_ID}:deck:${cid}`;
const consumedKey = `battle:${BATTLE_ID}:consumed_cards`;

beforeEach(() => {
  jest.clearAllMocks();
  store.clear();
  sets.clear();
});

describe('T1018: consumeDeckCardOnPlay（对局内扣牌库 + 记消耗清单）', () => {
  it('public_pool 卡直接跳过，不碰牌库也不记清单', async () => {
    store.set(deckKey(CHAR_ID), JSON.stringify([{ deck_id: CARD_A, card_id: CARD_A }]));

    const result = await consumeDeckCardOnPlay(
      BATTLE_ID, CHAR_ID, 'template-1', 'pool:1', 'public_pool'
    );

    expect(result).toEqual({ ok: false, reason: 'public_pool' });
    // 牌库未动
    expect(JSON.parse(store.get(deckKey(CHAR_ID))!)).toHaveLength(1);
    // 消耗清单为空（公共池卡无限复用，不入库存扣减）
    expect(sets.get(consumedKey)).toBeUndefined();
  });

  it('deck 卡：从快照移除该牌 + 记入消耗清单', async () => {
    store.set(
      deckKey(CHAR_ID),
      JSON.stringify([
        { deck_id: CARD_A, card_id: CARD_A },
        { deck_id: CARD_B, card_id: CARD_B },
      ])
    );

    const result = await consumeDeckCardOnPlay(BATTLE_ID, CHAR_ID, CARD_A, CARD_A, 'deck');

    expect(result).toEqual({ ok: true, deckRemoved: true, recorded: true });
    // 牌库只剩一张
    const remaining = JSON.parse(store.get(deckKey(CHAR_ID))!);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].deck_id).toBe(CARD_B);
    // 消耗清单记录了被消耗的卡
    expect(sets.get(consumedKey)!.has(CARD_A)).toBe(true);
  });

  it('deck 卡：快照被抽空时保留 []（不能 DEL，否则 drawCards 会回落 character_deck 重抽）', async () => {
    store.set(deckKey(CHAR_ID), JSON.stringify([{ deck_id: CARD_A, card_id: CARD_A }]));

    await consumeDeckCardOnPlay(BATTLE_ID, CHAR_ID, CARD_A, CARD_A, 'deck');

    // key 仍存在，且值为 '[]'
    expect(store.has(deckKey(CHAR_ID))).toBe(true);
    expect(store.get(deckKey(CHAR_ID))).toBe('[]');
  });

  it('deck 卡：牌库中无此牌（重复消耗）— 不改快照，但仍记入消耗清单', async () => {
    store.set(deckKey(CHAR_ID), JSON.stringify([{ deck_id: CARD_B, card_id: CARD_B }]));

    const result = await consumeDeckCardOnPlay(BATTLE_ID, CHAR_ID, CARD_A, CARD_A, 'deck');

    expect(result).toEqual({ ok: true, deckRemoved: false, recorded: true });
    expect(JSON.parse(store.get(deckKey(CHAR_ID))!)).toHaveLength(1);
    expect(sets.get(consumedKey)!.has(CARD_A)).toBe(true);
  });

  it('快照不存在（旧 character_deck 回落路径）— 只记清单，不报 snapshot_missing', async () => {
    const result = await consumeDeckCardOnPlay(BATTLE_ID, CHAR_ID, CARD_A, CARD_A, 'deck');

    expect(result).toEqual({ ok: true, deckRemoved: false, recorded: true });
    expect(sets.get(consumedKey)!.has(CARD_A)).toBe(true);
  });

  it('快照 JSON 损坏 — 仍记消耗清单（否则该卡不会进库存扣减）', async () => {
    store.set(deckKey(CHAR_ID), '{broken json');

    const result = await consumeDeckCardOnPlay(BATTLE_ID, CHAR_ID, CARD_A, CARD_A, 'deck');

    expect(result).toEqual({ ok: true, deckRemoved: false, recorded: true });
    expect(sets.get(consumedKey)!.has(CARD_A)).toBe(true);
  });

  it('同一张卡重复消耗 — SET 去重，清单只留一条', async () => {
    store.set(deckKey(CHAR_ID), JSON.stringify([{ deck_id: CARD_A, card_id: CARD_A }]));

    await consumeDeckCardOnPlay(BATTLE_ID, CHAR_ID, CARD_A, CARD_A, 'deck');
    await consumeDeckCardOnPlay(BATTLE_ID, CHAR_ID, CARD_A, CARD_A, 'deck');

    expect(sets.get(consumedKey)!.size).toBe(1);
  });
});

describe('T1018: getConsumedCardIdSet', () => {
  it('返回本局已消耗卡牌 id 集合', async () => {
    sets.set(consumedKey, new Set([CARD_A, CARD_B]));

    const result = await getConsumedCardIdSet(BATTLE_ID);

    expect(result.size).toBe(2);
    expect(result.has(CARD_A)).toBe(true);
    expect(result.has(CARD_C)).toBe(false);
  });

  it('清单不存在时返回空集合', async () => {
    const result = await getConsumedCardIdSet(BATTLE_ID);
    expect(result.size).toBe(0);
  });
});

describe('T1018: settleCardConsumption（对局外扣库存）', () => {
  /** 构造 withTransaction fake client：按 SQL 文本路由 */
  function makeFakeClient(opts: {
    cardsSettledAt?: Date | null;
    battleExists?: boolean;
    deleteRowCounts?: number[];
  }) {
    const deleteCalls: Array<{ sql: string; params: unknown[] }> = [];
    let deleteIdx = 0;
    const client = {
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('cards_settled_at') && sql.includes('FOR UPDATE')) {
          if (opts.battleExists === false) return { rows: [], rowCount: 0 };
          return {
            rows: [{ cards_settled_at: opts.cardsSettledAt ?? null }],
            rowCount: 1,
          };
        }
        if (sql.includes('DELETE FROM player_cards')) {
          deleteCalls.push({ sql, params: params ?? [] });
          const rc = opts.deleteRowCounts?.[deleteIdx] ?? 1;
          deleteIdx += 1;
          return { rows: [], rowCount: rc };
        }
        if (sql.includes('UPDATE battles SET cards_settled_at')) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };
    return { client, deleteCalls };
  }

  it('清单为空 — 仍标记已结算，deducted=0', async () => {
    const { client, deleteCalls } = makeFakeClient({});
    mockWithTransaction.mockImplementation(async (fn: any) => fn(client));

    const result = await settleCardConsumption(BATTLE_ID, PL1, PL2);

    expect(result).toEqual({ ok: true, deducted: 0, alreadySettled: false });
    expect(deleteCalls).toHaveLength(0);
  });

  it('按消耗清单扣双方库存（归属复核内联在 WHERE）', async () => {
    sets.set(consumedKey, new Set([CARD_A, CARD_B]));
    const { client, deleteCalls } = makeFakeClient({ deleteRowCounts: [1, 1] });
    mockWithTransaction.mockImplementation(async (fn: any) => fn(client));

    const result = await settleCardConsumption(BATTLE_ID, PL1, PL2);

    expect(result).toEqual({ ok: true, deducted: 2, alreadySettled: false });
    // 双方各删一次
    expect(deleteCalls).toHaveLength(2);
    expect(deleteCalls[0].params[1]).toBe(PL1);
    expect(deleteCalls[1].params[1]).toBe(PL2);
    // SQL 带归属复核条件
    expect(deleteCalls[0].sql).toContain('AND player_id = $2');
  });

  it('幂等：cards_settled_at 非空 → 跳过扣减', async () => {
    sets.set(consumedKey, new Set([CARD_A]));
    const { client, deleteCalls } = makeFakeClient({
      cardsSettledAt: new Date('2026-10-20T00:00:00Z'),
    });
    mockWithTransaction.mockImplementation(async (fn: any) => fn(client));

    const result = await settleCardConsumption(BATTLE_ID, PL1, PL2);

    expect(result).toEqual({ ok: true, deducted: 0, alreadySettled: true });
    expect(deleteCalls).toHaveLength(0);
  });

  it('battle 不存在 → ok:false, battle_not_found', async () => {
    const { client } = makeFakeClient({ battleExists: false });
    mockWithTransaction.mockImplementation(async (fn: any) => fn(client));

    const result = await settleCardConsumption(BATTLE_ID, PL1, PL2);

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: 'battle_not_found' });
  });

  it('Redis 读失败 → 不进事务（保留重试机会，避免永久漏扣）', async () => {
    const spy = jest
      .spyOn(redisClient, 'sMembers')
      .mockRejectedValue(new Error('redis down'));

    const result = await settleCardConsumption(BATTLE_ID, PL1, PL2);

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: 'redis_error' });
    expect(mockWithTransaction).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('清单中的非法 UUID 被过滤（不会让 = ANY($1::uuid[]) 整条 SQL 报错）', async () => {
    sets.set(consumedKey, new Set([CARD_A, 'not-a-uuid']));
    const { client, deleteCalls } = makeFakeClient({ deleteRowCounts: [1, 0] });
    mockWithTransaction.mockImplementation(async (fn: any) => fn(client));

    const result = await settleCardConsumption(BATTLE_ID, PL1, PL2);

    expect(result).toEqual({ ok: true, deducted: 1, alreadySettled: false });
    expect(deleteCalls[0].params[0]).toEqual([CARD_A]);
  });

  it('卡已不在库存（rowCount=0）— 不报错，deducted 相应减少', async () => {
    sets.set(consumedKey, new Set([CARD_A]));
    // 双方都删不到（卡已不在库存）：p1 侧 0 行、p2 侧 0 行
    const { client } = makeFakeClient({ deleteRowCounts: [0, 0] });
    mockWithTransaction.mockImplementation(async (fn: any) => fn(client));

    const result = await settleCardConsumption(BATTLE_ID, PL1, PL2);

    expect(result).toEqual({ ok: true, deducted: 0, alreadySettled: false });
  });
});
