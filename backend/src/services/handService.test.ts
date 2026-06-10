// Unit tests for handService

// Define mocks before importing the module
const mockRedisClient = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  lRange: jest.fn(),
  rPush: jest.fn(),
};

const mockGetCharacterDeckCards = jest.fn();
const mockDrawFromPublicPool = jest.fn();

jest.mock('../config/redis', () => ({
  redisClient: mockRedisClient,
}));

jest.mock('./characterService', () => ({
  getCharacterDeckCards: mockGetCharacterDeckCards,
}));

jest.mock('./publicPoolService', () => ({
  drawFromPublicPool: mockDrawFromPublicPool,
  isPublicPoolDeckId: (id: string) => id.startsWith('pool:'),
}));

import {
  drawCards,
  getActorHand,
  clearActorHand,
  retainHandOnStepEnd,
  getDiscardPile,
  addToDiscardPile,
  clearDiscardPile,
  HandCard,
} from './handService';

describe('handService', () => {
  const battleId = 'battle-test-123';
  const characterId = 'char-1a';

  // In-memory stores keyed by Redis key
  // - handStore / retainedStore: STRING values (`battle:{id}:hand:{cid}` / `battle:{id}:retained:{cid}`)
  // - discardStore: LIST values (`battle:{id}:discard:{cid}`)
  let stringStore: Record<string, string> = {};
  let discardStore: Record<string, string[]> = {};

  // Backward-compat alias used by legacy tests; points at same object as stringStore
  let handStore: Record<string, string>;

  beforeEach(() => {
    jest.resetAllMocks();
    stringStore = {};
    discardStore = {};
    handStore = stringStore;

    // T1001 default: public pool returns empty array unless a test sets it up explicitly
    mockDrawFromPublicPool.mockResolvedValue([]);

    // redisClient.get reads STRING store (hand + retained share namespace by key prefix)
    mockRedisClient.get.mockImplementation((key: string) =>
      Promise.resolve(stringStore[key] ?? null)
    );

    // redisClient.set writes STRING store
    mockRedisClient.set.mockImplementation((key: string, value: string) => {
      stringStore[key] = value;
      return Promise.resolve('OK');
    });

    // redisClient.del clears both stores at the same key (one of them will be no-op)
    mockRedisClient.del.mockImplementation((key: string) => {
      const hadString = key in stringStore;
      const hadList = key in discardStore;
      delete stringStore[key];
      delete discardStore[key];
      return Promise.resolve(hadString || hadList ? 1 : 0);
    });

    // redisClient.lRange reads LIST store slice
    mockRedisClient.lRange.mockImplementation(
      (key: string, start: number, stop: number) => {
        const arr = discardStore[key] ?? [];
        if (arr.length === 0) {
          return Promise.resolve([]);
        }
        // Redis lRange supports negative indices, but we only need 0/-1 here
        const end = stop === -1 ? arr.length - 1 : Math.min(stop, arr.length - 1);
        return Promise.resolve(arr.slice(start, end + 1));
      }
    );

    // redisClient.rPush appends to LIST store. v4 supports both `rPush(key, value)` and
    // `rPush(key, [v1, v2, ...])` — handService passes the array form.
    mockRedisClient.rPush.mockImplementation(
      (key: string, values: string | string[]) => {
        if (!discardStore[key]) {
          discardStore[key] = [];
        }
        if (Array.isArray(values)) {
          discardStore[key].push(...values);
        } else {
          discardStore[key].push(values);
        }
        return Promise.resolve(discardStore[key].length);
      }
    );
  });

  // ========================================
  // 工具：构造测试牌库
  // ========================================
  function makeDeckRow(
    deck_id: string,
    card_id: string,
    name: string,
    type: string,
    cost: number,
    effect: Record<string, unknown> = {},
    template_no: number = 0
  ) {
    return { deck_id, card_id, name, type, cost, effect, template_no };
  }

  // ========================================
  // drawCards
  // ========================================
  describe('drawCards', () => {
    it('should draw default 3 cards from deck', async () => {
      mockGetCharacterDeckCards.mockResolvedValueOnce([
        makeDeckRow('d1', 'c1', '轻击', 'attack', 1, { damage: 2 }, 1),
        makeDeckRow('d2', 'c2', '移动', 'tactical', 0, { movement: 1 }, 2),
        makeDeckRow('d3', 'c3', '防御', 'defense', 1, { shield: 3 }, 6),
        makeDeckRow('d4', 'c4', '治疗', 'tactical', 1, { heal: 3 }, 7),
        makeDeckRow('d5', 'c5', '重击', 'attack', 2, { damage: 4 }, 3),
      ]);

      const result = await drawCards(battleId, characterId);

      expect(result.success).toBe(true);
      expect(result.drawn_count).toBe(3);
      expect(result.deck_size).toBe(5);
      expect(result.cards).toHaveLength(3);
      // Verify shape
      for (const card of result.cards!) {
        expect(card).toHaveProperty('deck_id');
        expect(card).toHaveProperty('card_id');
        expect(card).toHaveProperty('name');
        expect(card).toHaveProperty('type');
        expect(card).toHaveProperty('cost');
        expect(card).toHaveProperty('effect');
        expect(card).toHaveProperty('template_no');
      }
    });

    it('should draw specified count when count is provided', async () => {
      mockGetCharacterDeckCards.mockResolvedValueOnce([
        makeDeckRow('d1', 'c1', '轻击', 'attack', 1),
        makeDeckRow('d2', 'c2', '移动', 'tactical', 0),
        makeDeckRow('d3', 'c3', '防御', 'defense', 1),
        makeDeckRow('d4', 'c4', '治疗', 'tactical', 1),
        makeDeckRow('d5', 'c5', '重击', 'attack', 2),
      ]);

      const result = await drawCards(battleId, characterId, 2);

      expect(result.success).toBe(true);
      expect(result.drawn_count).toBe(2);
      expect(result.cards).toHaveLength(2);
    });

    it('should return empty hand when deck is empty', async () => {
      mockGetCharacterDeckCards.mockResolvedValueOnce([]);

      const result = await drawCards(battleId, characterId);

      expect(result.success).toBe(true);
      expect(result.cards).toEqual([]);
      expect(result.drawn_count).toBe(0);
      expect(result.deck_size).toBe(0);
    });

    it('should write empty hand to Redis when deck is empty', async () => {
      mockGetCharacterDeckCards.mockResolvedValueOnce([]);

      await drawCards(battleId, characterId);

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        `battle:${battleId}:hand:${characterId}`,
        JSON.stringify([])
      );
    });

    it('should draw all cards when count exceeds deck size', async () => {
      mockGetCharacterDeckCards.mockResolvedValueOnce([
        makeDeckRow('d1', 'c1', '轻击', 'attack', 1),
        makeDeckRow('d2', 'c2', '移动', 'tactical', 0),
      ]);

      const result = await drawCards(battleId, characterId, 5);

      expect(result.success).toBe(true);
      expect(result.drawn_count).toBe(2);
      expect(result.deck_size).toBe(2);
      expect(result.cards).toHaveLength(2);
    });

    it('should draw all cards when count equals deck size', async () => {
      mockGetCharacterDeckCards.mockResolvedValueOnce([
        makeDeckRow('d1', 'c1', '轻击', 'attack', 1),
        makeDeckRow('d2', 'c2', '移动', 'tactical', 0),
        makeDeckRow('d3', 'c3', '防御', 'defense', 1),
      ]);

      const result = await drawCards(battleId, characterId, 3);

      expect(result.drawn_count).toBe(3);
      expect(result.deck_size).toBe(3);
      expect(result.cards).toHaveLength(3);
    });

    it('should draw count 0 and return empty hand', async () => {
      mockGetCharacterDeckCards.mockResolvedValueOnce([
        makeDeckRow('d1', 'c1', '轻击', 'attack', 1),
      ]);

      const result = await drawCards(battleId, characterId, 0);

      expect(result.success).toBe(true);
      expect(result.drawn_count).toBe(0);
      expect(result.cards).toEqual([]);
    });

    it('should not produce duplicate deck_ids in a single draw (5 from 10)', async () => {
      const tenCards = Array.from({ length: 10 }, (_, i) =>
        makeDeckRow(`d${i + 1}`, `c${i + 1}`, `卡${i + 1}`, 'attack', 1)
      );
      mockGetCharacterDeckCards.mockResolvedValueOnce(tenCards);

      const result = await drawCards(battleId, characterId, 5);

      expect(result.drawn_count).toBe(5);
      const deckIds = result.cards!.map((c) => c.deck_id);
      const uniqueIds = new Set(deckIds);
      expect(uniqueIds.size).toBe(5);
    });

    it('should persist hand to Redis at the correct key', async () => {
      mockGetCharacterDeckCards.mockResolvedValueOnce([
        makeDeckRow('d1', 'c1', '轻击', 'attack', 1, { damage: 2 }, 1),
        makeDeckRow('d2', 'c2', '移动', 'tactical', 0, { movement: 1 }, 2),
        makeDeckRow('d3', 'c3', '防御', 'defense', 1, { shield: 3 }, 6),
      ]);

      await drawCards(battleId, characterId);

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        `battle:${battleId}:hand:${characterId}`,
        expect.stringMatching(/^\[/)
      );
    });

    it('should overwrite existing hand on subsequent draw', async () => {
      // Pre-populate handStore with an old hand
      const oldHand: HandCard[] = [
        {
          deck_id: 'old-d1',
          card_id: 'old-c1',
          name: '旧卡',
          type: 'attack',
          cost: 1,
          effect: {},
          template_no: 99,
          source: 'deck',
        },
      ];
      handStore[`battle:${battleId}:hand:${characterId}`] = JSON.stringify(oldHand);

      // New draw
      mockGetCharacterDeckCards.mockResolvedValueOnce([
        makeDeckRow('new-d1', 'new-c1', '新卡', 'attack', 1),
      ]);

      const result = await drawCards(battleId, characterId, 1);

      expect(result.cards).toHaveLength(1);
      expect(result.cards![0].deck_id).toBe('new-d1');
      // Redis should now contain only the new card
      const stored = JSON.parse(handStore[`battle:${battleId}:hand:${characterId}`]);
      expect(stored).toHaveLength(1);
      expect(stored[0].deck_id).toBe('new-d1');
    });

    it('should reject negative count', async () => {
      const result = await drawCards(battleId, characterId, -1);

      expect(result.success).toBe(false);
      expect(result.drawn_count).toBe(0);
      expect(result.deck_size).toBe(0);
      expect(result.error).toBe('count must be a non-negative integer');
    });

    it('should reject non-integer count (float)', async () => {
      const result = await drawCards(battleId, characterId, 2.5);

      expect(result.success).toBe(false);
      expect(result.error).toBe('count must be a non-negative integer');
    });

    it('should reject NaN count', async () => {
      const result = await drawCards(battleId, characterId, NaN);

      expect(result.success).toBe(false);
      expect(result.error).toBe('count must be a non-negative integer');
    });

    it('should reject Infinity count', async () => {
      const result = await drawCards(battleId, characterId, Infinity);

      expect(result.success).toBe(false);
      expect(result.error).toBe('count must be a non-negative integer');
    });

    it('should preserve card type, cost, effect, template_no', async () => {
      mockGetCharacterDeckCards.mockResolvedValueOnce([
        makeDeckRow(
          'd1',
          'c1',
          '精准射击',
          'attack',
          1,
          { damage: 3, range: 3 },
          4
        ),
      ]);

      const result = await drawCards(battleId, characterId, 1);

      const card = result.cards![0];
      expect(card.type).toBe('attack');
      expect(card.cost).toBe(1);
      expect(card.effect).toEqual({ damage: 3, range: 3 });
      expect(card.template_no).toBe(4);
    });
  });

  // ========================================
  // T1001: 公共池补足
  // ========================================
  describe('drawCards with public pool topup (T1001)', () => {
    const poolCard: HandCard = {
      deck_id: 'pool:1',
      card_id: 'template-qj',
      name: '轻击',
      type: 'attack',
      cost: 1,
      effect: { damage: 2 },
      template_no: 1,
      source: 'public_pool',
    };

    it('should topup from public pool when deck is empty', async () => {
      mockGetCharacterDeckCards.mockResolvedValueOnce([]);
      mockDrawFromPublicPool.mockResolvedValueOnce([poolCard, poolCard, poolCard]);

      const result = await drawCards(battleId, characterId, 3);

      expect(result.success).toBe(true);
      expect(result.deck_size).toBe(0);
      expect(result.drawn_count).toBe(3); // pool cards count as drawn
      expect(result.cards).toHaveLength(3);
      for (const c of result.cards!) {
        expect(c.source).toBe('public_pool');
        expect(c.deck_id).toBe('pool:1');
      }
      // drawFromPublicPool should be called with count=3
      expect(mockDrawFromPublicPool).toHaveBeenCalledWith(3);
    });

    it('should topup from public pool when deck < count (partial)', async () => {
      mockGetCharacterDeckCards.mockResolvedValueOnce([
        makeDeckRow('d1', 'c1', '移动', 'tactical', 0),
      ]);
      mockDrawFromPublicPool.mockResolvedValueOnce([poolCard, poolCard]);

      const result = await drawCards(battleId, characterId, 3);

      expect(result.success).toBe(true);
      expect(result.deck_size).toBe(1);
      expect(result.drawn_count).toBe(3); // 1 deck + 2 pool
      expect(result.cards).toHaveLength(3);
      expect(result.cards![0].source).toBe('deck');
      expect(result.cards![1].source).toBe('public_pool');
      expect(result.cards![2].source).toBe('public_pool');
      // drawFromPublicPool called with deficit (count - deckSize) = 2
      expect(mockDrawFromPublicPool).toHaveBeenCalledWith(2);
    });

    it('should not call public pool when deck has enough cards', async () => {
      mockGetCharacterDeckCards.mockResolvedValueOnce([
        makeDeckRow('d1', 'c1', 'A', 'attack', 1),
        makeDeckRow('d2', 'c2', 'B', 'attack', 1),
        makeDeckRow('d3', 'c3', 'C', 'attack', 1),
      ]);

      const result = await drawCards(battleId, characterId, 3);

      expect(result.success).toBe(true);
      expect(result.drawn_count).toBe(3);
      expect(mockDrawFromPublicPool).not.toHaveBeenCalled();
    });

    it('should yield empty hand when deck empty and public pool empty', async () => {
      mockGetCharacterDeckCards.mockResolvedValueOnce([]);
      // public pool default mock returns []
      mockDrawFromPublicPool.mockResolvedValueOnce([]);

      const result = await drawCards(battleId, characterId, 3);

      expect(result.success).toBe(true);
      expect(result.deck_size).toBe(0);
      expect(result.drawn_count).toBe(0);
      expect(result.cards).toEqual([]);
    });

    it('should persist pool cards to Redis with source=public_pool', async () => {
      mockGetCharacterDeckCards.mockResolvedValueOnce([]);
      mockDrawFromPublicPool.mockResolvedValueOnce([poolCard]);

      await drawCards(battleId, characterId, 1);

      const stored = JSON.parse(handStore[handKey(battleId, characterId)]);
      expect(stored).toHaveLength(1);
      expect(stored[0].source).toBe('public_pool');
    });

    it('should merge retained + public pool topup when deck empty', async () => {
      const retained = makeHandCard('retained-d', 'retained-c', 'KeptCard');
      stringStore[retainedKey(battleId, characterId)] = JSON.stringify(retained);

      mockGetCharacterDeckCards.mockResolvedValueOnce([]);
      mockDrawFromPublicPool.mockResolvedValueOnce([poolCard, poolCard]);

      const result = await drawCards(battleId, characterId, 3);

      expect(result.success).toBe(true);
      expect(result.drawn_count).toBe(2); // pool cards, retained is separate
      expect(result.cards).toHaveLength(3); // 1 retained + 2 pool
      expect(result.cards![0]).toEqual(retained); // retained on top
      expect(result.cards![1].source).toBe('public_pool');
      expect(result.cards![2].source).toBe('public_pool');
      expect(result.retained_from_previous).toEqual(retained);
    });
  });

  // ========================================
  // getActorHand
  // ========================================
  describe('getActorHand', () => {
    it('should return empty array when no hand exists', async () => {
      const hand = await getActorHand(battleId, characterId);
      expect(hand).toEqual([]);
    });

    it('should read and parse hand from Redis', async () => {
      const stored: HandCard[] = [
        {
          deck_id: 'd1',
          card_id: 'c1',
          name: '轻击',
          type: 'attack',
          cost: 1,
          effect: { damage: 2 },
          template_no: 1,
          source: 'deck',
        },
        {
          deck_id: 'd2',
          card_id: 'c2',
          name: '移动',
          type: 'tactical',
          cost: 0,
          effect: { movement: 1 },
          template_no: 2,
          source: 'deck',
        },
      ];
      handStore[`battle:${battleId}:hand:${characterId}`] =
        JSON.stringify(stored);

      const hand = await getActorHand(battleId, characterId);

      expect(hand).toHaveLength(2);
      expect(hand[0].name).toBe('轻击');
      expect(hand[1].name).toBe('移动');
    });

    it('should return empty array on corrupted JSON', async () => {
      handStore[`battle:${battleId}:hand:${characterId}`] = 'not-valid-json{';

      const hand = await getActorHand(battleId, characterId);

      expect(hand).toEqual([]);
    });

    it('should use battle-specific key when called with different battleIds', async () => {
      const otherBattleId = 'battle-other';
      const handA: HandCard[] = [
        {
          deck_id: 'dA',
          card_id: 'cA',
          name: '卡A',
          type: 'attack',
          cost: 1,
          effect: {},
          template_no: 1,
          source: 'deck',
        },
      ];
      handStore[`battle:${battleId}:hand:${characterId}`] =
        JSON.stringify(handA);

      const hand = await getActorHand(otherBattleId, characterId);

      expect(hand).toEqual([]);
    });
  });

  // ========================================
  // clearActorHand
  // ========================================
  describe('clearActorHand', () => {
    it('should delete the hand key from Redis', async () => {
      handStore[`battle:${battleId}:hand:${characterId}`] = JSON.stringify([]);

      await clearActorHand(battleId, characterId);

      expect(mockRedisClient.del).toHaveBeenCalledWith(
        `battle:${battleId}:hand:${characterId}`
      );
      expect(handStore[`battle:${battleId}:hand:${characterId}`]).toBeUndefined();
    });

    it('should be a no-op when hand does not exist', async () => {
      await expect(clearActorHand(battleId, characterId)).resolves.toBeUndefined();
      expect(mockRedisClient.del).toHaveBeenCalled();
    });
  });

  // ========================================
  // T038：测试辅助
  // ========================================
  /**
   * Build a HandCard for in-memory preloading.
   */
  function makeHandCard(
    deck_id: string,
    card_id: string,
    name: string,
    type: HandCard['type'] = 'attack',
    cost: number = 1,
    effect: Record<string, unknown> = {},
    template_no: number = 0,
    source: HandCard['source'] = 'deck'
  ): HandCard {
    return { deck_id, card_id, name, type, cost, effect, template_no, source };
  }

  const handKey = (b: string, c: string) => `battle:${b}:hand:${c}`;
  const retainedKey = (b: string, c: string) => `battle:${b}:retained:${c}`;
  const discardKey = (b: string, c: string) => `battle:${b}:discard:${c}`;

  // ========================================
  // retainHandOnStepEnd
  // ========================================
  describe('retainHandOnStepEnd', () => {
    it('should be no-op on empty hand', async () => {
      // No hand preloaded → empty
      const result = await retainHandOnStepEnd(battleId, characterId, 'd1');

      expect(result.success).toBe(true);
      expect(result.retained).toBeNull();
      expect(result.discarded).toEqual([]);
      // No retain key should be written; no rPush should be invoked
      expect(stringStore[retainedKey(battleId, characterId)]).toBeUndefined();
      expect(mockRedisClient.rPush).not.toHaveBeenCalled();
    });

    it('should discard all cards when retainDeckId is null', async () => {
      const hand: HandCard[] = [
        makeHandCard('d1', 'c1', '轻击'),
        makeHandCard('d2', 'c2', '移动', 'tactical'),
        makeHandCard('d3', 'c3', '防御', 'defense'),
      ];
      stringStore[handKey(battleId, characterId)] = JSON.stringify(hand);

      const result = await retainHandOnStepEnd(battleId, characterId, null);

      expect(result.success).toBe(true);
      expect(result.retained).toBeNull();
      expect(result.discarded).toEqual(hand);
      // Discard pile contains all 3 cards
      const pile = (discardStore[discardKey(battleId, characterId)] ?? []).map(
        (s) => JSON.parse(s)
      );
      expect(pile).toEqual(hand);
      // No retained key written
      expect(stringStore[retainedKey(battleId, characterId)]).toBeUndefined();
    });

    it('should retain matching card and discard the rest', async () => {
      const hand: HandCard[] = [
        makeHandCard('d1', 'c1', '轻击'),
        makeHandCard('d2', 'c2', '移动', 'tactical'),
        makeHandCard('d3', 'c3', '防御', 'defense'),
      ];
      stringStore[handKey(battleId, characterId)] = JSON.stringify(hand);

      const result = await retainHandOnStepEnd(battleId, characterId, 'd2');

      expect(result.success).toBe(true);
      expect(result.retained).toEqual(hand[1]);
      expect(result.discarded).toEqual([hand[0], hand[2]]);
      // retained key holds the chosen card
      expect(stringStore[retainedKey(battleId, characterId)]).toBe(
        JSON.stringify(hand[1])
      );
    });

    it('should RPUSH discarded cards in hand order (minus retained)', async () => {
      const hand: HandCard[] = [
        makeHandCard('d1', 'c1', 'A'),
        makeHandCard('d2', 'c2', 'B'),
        makeHandCard('d3', 'c3', 'C'),
        makeHandCard('d4', 'c4', 'D'),
      ];
      stringStore[handKey(battleId, characterId)] = JSON.stringify(hand);

      await retainHandOnStepEnd(battleId, characterId, 'd3');

      const pile = (discardStore[discardKey(battleId, characterId)] ?? []).map(
        (s) => JSON.parse(s)
      );
      // Order should be A, B, D (skipping C which is retained)
      expect(pile.map((c) => c.deck_id)).toEqual(['d1', 'd2', 'd4']);
    });

    it('should DEL the hand key after retain', async () => {
      const hand: HandCard[] = [
        makeHandCard('d1', 'c1', '轻击'),
        makeHandCard('d2', 'c2', '移动', 'tactical'),
      ];
      stringStore[handKey(battleId, characterId)] = JSON.stringify(hand);

      await retainHandOnStepEnd(battleId, characterId, 'd1');

      expect(stringStore[handKey(battleId, characterId)]).toBeUndefined();
      expect(mockRedisClient.del).toHaveBeenCalledWith(
        handKey(battleId, characterId)
      );
    });

    it('should discard all and return error when retainDeckId is not in hand', async () => {
      const hand: HandCard[] = [
        makeHandCard('d1', 'c1', '轻击'),
        makeHandCard('d2', 'c2', '移动', 'tactical'),
      ];
      stringStore[handKey(battleId, characterId)] = JSON.stringify(hand);

      const result = await retainHandOnStepEnd(
        battleId,
        characterId,
        'non-existent-deck-id'
      );

      expect(result.success).toBe(false);
      expect(result.retained).toBeNull();
      expect(result.discarded).toEqual(hand);
      expect(result.error).toBe('retainDeckId not found in hand');
      // All cards land in discard pile (safe degradation)
      const pile = (discardStore[discardKey(battleId, characterId)] ?? []).map(
        (s) => JSON.parse(s)
      );
      expect(pile).toEqual(hand);
      // No retained key written
      expect(stringStore[retainedKey(battleId, characterId)]).toBeUndefined();
    });

    it('should preserve original hand order in discarded array (minus retained)', async () => {
      const hand: HandCard[] = [
        makeHandCard('d1', 'c1', 'A'),
        makeHandCard('d2', 'c2', 'B'),
        makeHandCard('d3', 'c3', 'C'),
      ];
      stringStore[handKey(battleId, characterId)] = JSON.stringify(hand);

      const result = await retainHandOnStepEnd(battleId, characterId, 'd1');

      expect(result.discarded.map((c) => c.deck_id)).toEqual(['d2', 'd3']);
    });

    it('should retain the only card when hand has 1 and retainDeckId matches', async () => {
      const hand: HandCard[] = [makeHandCard('d1', 'c1', 'Solo')];
      stringStore[handKey(battleId, characterId)] = JSON.stringify(hand);

      const result = await retainHandOnStepEnd(battleId, characterId, 'd1');

      expect(result.success).toBe(true);
      expect(result.retained).toEqual(hand[0]);
      expect(result.discarded).toEqual([]);
      expect(stringStore[retainedKey(battleId, characterId)]).toBe(
        JSON.stringify(hand[0])
      );
      // Empty discard list → no rPush invoked
      expect(mockRedisClient.rPush).not.toHaveBeenCalled();
    });

    it('should isolate retained / discard state across different battleIds', async () => {
      const handA: HandCard[] = [makeHandCard('d1', 'c1', 'A')];
      const otherBattleId = 'battle-other-999';
      stringStore[handKey(battleId, characterId)] = JSON.stringify(handA);

      await retainHandOnStepEnd(battleId, characterId, 'd1');

      // Other battle's retained / discard / hand keys must remain untouched
      expect(stringStore[retainedKey(otherBattleId, characterId)]).toBeUndefined();
      expect(discardStore[discardKey(otherBattleId, characterId)]).toBeUndefined();
      expect(stringStore[handKey(otherBattleId, characterId)]).toBeUndefined();
    });

    it('should be idempotent — second call on empty hand is a no-op', async () => {
      const hand: HandCard[] = [
        makeHandCard('d1', 'c1', 'A'),
        makeHandCard('d2', 'c2', 'B'),
      ];
      stringStore[handKey(battleId, characterId)] = JSON.stringify(hand);

      const first = await retainHandOnStepEnd(battleId, characterId, 'd1');
      expect(first.success).toBe(true);
      expect(first.retained).toEqual(hand[0]);

      // Reset rPush counts so the second-call assertion is unambiguous
      mockRedisClient.rPush.mockClear();

      const second = await retainHandOnStepEnd(battleId, characterId, 'd1');
      expect(second.success).toBe(true);
      expect(second.retained).toBeNull();
      expect(second.discarded).toEqual([]);
      expect(mockRedisClient.rPush).not.toHaveBeenCalled();
    });

    // T1001: 公共池卡不能被保留（强制全弃 + error）
    it('should reject retain of a public_pool card and discard the whole hand (T1001)', async () => {
      const hand: HandCard[] = [
        makeHandCard('d1', 'c1', 'deck-A', 'attack', 1, {}, 5, 'deck'),
        makeHandCard(
          'pool:1',
          'template-qj',
          '轻击',
          'attack',
          1,
          { damage: 2 },
          1,
          'public_pool'
        ),
      ];
      stringStore[handKey(battleId, characterId)] = JSON.stringify(hand);

      const result = await retainHandOnStepEnd(battleId, characterId, 'pool:1');

      expect(result.success).toBe(false);
      expect(result.retained).toBeNull();
      expect(result.discarded).toEqual(hand);
      expect(result.error).toBe('public pool cards cannot be retained');
      // All cards in discard pile
      const pile = (discardStore[discardKey(battleId, characterId)] ?? []).map(
        (s) => JSON.parse(s)
      );
      expect(pile).toEqual(hand);
      // No retained key written
      expect(stringStore[retainedKey(battleId, characterId)]).toBeUndefined();
    });

    it('should still allow retaining a deck card when public_pool cards are present (T1001)', async () => {
      const hand: HandCard[] = [
        makeHandCard('d1', 'c1', 'deck-A', 'attack', 1, {}, 5, 'deck'),
        makeHandCard(
          'pool:1',
          'template-qj',
          '轻击',
          'attack',
          1,
          { damage: 2 },
          1,
          'public_pool'
        ),
        makeHandCard('d3', 'c3', 'deck-B', 'defense', 1, {}, 6, 'deck'),
      ];
      stringStore[handKey(battleId, characterId)] = JSON.stringify(hand);

      const result = await retainHandOnStepEnd(battleId, characterId, 'd3');

      expect(result.success).toBe(true);
      expect(result.retained).toEqual(hand[2]); // deck-B retained
      expect(result.discarded).toEqual([hand[0], hand[1]]); // deck-A + pool
      // retained key holds the chosen deck card
      expect(stringStore[retainedKey(battleId, characterId)]).toBe(
        JSON.stringify(hand[2])
      );
    });
  });

  // ========================================
  // getDiscardPile
  // ========================================
  describe('getDiscardPile', () => {
    it('should return [] when discard pile does not exist', async () => {
      const pile = await getDiscardPile(battleId, characterId);
      expect(pile).toEqual([]);
    });

    it('should read all cards from discard pile in push order', async () => {
      const cards: HandCard[] = [
        makeHandCard('d1', 'c1', 'A'),
        makeHandCard('d2', 'c2', 'B'),
        makeHandCard('d3', 'c3', 'C'),
      ];
      discardStore[discardKey(battleId, characterId)] = cards.map((c) =>
        JSON.stringify(c)
      );

      const pile = await getDiscardPile(battleId, characterId);

      expect(pile).toEqual(cards);
    });

    it('should silently skip corrupted JSON entries', async () => {
      const goodCard = makeHandCard('d1', 'c1', 'A');
      discardStore[discardKey(battleId, characterId)] = [
        JSON.stringify(goodCard),
        'corrupted-json{',
        JSON.stringify(makeHandCard('d2', 'c2', 'B')),
      ];

      const pile = await getDiscardPile(battleId, characterId);

      expect(pile).toHaveLength(2);
      expect(pile[0].deck_id).toBe('d1');
      expect(pile[1].deck_id).toBe('d2');
    });

    it('should isolate discard piles across different battleIds', async () => {
      discardStore[discardKey(battleId, characterId)] = [
        JSON.stringify(makeHandCard('d1', 'c1', 'A')),
      ];

      const otherPile = await getDiscardPile('battle-other-x', characterId);
      expect(otherPile).toEqual([]);
    });
  });

  // ========================================
  // addToDiscardPile
  // ========================================
  describe('addToDiscardPile', () => {
    it('should RPUSH multiple cards in order', async () => {
      const cards: HandCard[] = [
        makeHandCard('d1', 'c1', 'A'),
        makeHandCard('d2', 'c2', 'B'),
      ];

      await addToDiscardPile(battleId, characterId, cards);

      expect(mockRedisClient.rPush).toHaveBeenCalledTimes(1);
      const stored = discardStore[discardKey(battleId, characterId)].map((s) =>
        JSON.parse(s)
      );
      expect(stored).toEqual(cards);
    });

    it('should not invoke Redis when given an empty array', async () => {
      await addToDiscardPile(battleId, characterId, []);

      expect(mockRedisClient.rPush).not.toHaveBeenCalled();
      expect(discardStore[discardKey(battleId, characterId)]).toBeUndefined();
    });

    it('should append to an existing discard pile (preserve prior entries)', async () => {
      const existing = [makeHandCard('d0', 'c0', 'Existing')];
      discardStore[discardKey(battleId, characterId)] = existing.map((c) =>
        JSON.stringify(c)
      );

      const newCards: HandCard[] = [
        makeHandCard('d1', 'c1', 'A'),
        makeHandCard('d2', 'c2', 'B'),
      ];
      await addToDiscardPile(battleId, characterId, newCards);

      const stored = discardStore[discardKey(battleId, characterId)].map((s) =>
        JSON.parse(s)
      );
      expect(stored).toEqual([...existing, ...newCards]);
    });
  });

  // ========================================
  // clearDiscardPile
  // ========================================
  describe('clearDiscardPile', () => {
    it('should DEL the discard pile key', async () => {
      discardStore[discardKey(battleId, characterId)] = [
        JSON.stringify(makeHandCard('d1', 'c1', 'A')),
      ];

      await clearDiscardPile(battleId, characterId);

      expect(mockRedisClient.del).toHaveBeenCalledWith(
        discardKey(battleId, characterId)
      );
      expect(discardStore[discardKey(battleId, characterId)]).toBeUndefined();
    });

    it('should be a no-op when discard pile does not exist', async () => {
      await expect(
        clearDiscardPile(battleId, characterId)
      ).resolves.toBeUndefined();
      expect(mockRedisClient.del).toHaveBeenCalledWith(
        discardKey(battleId, characterId)
      );
    });
  });

  // ========================================
  // drawCards with retained card (T038 integration)
  // ========================================
  describe('drawCards with retained card', () => {
    it('should merge retained card to the top of new hand', async () => {
      const retained = makeHandCard('retained-d', 'retained-c', 'KeptCard');
      stringStore[retainedKey(battleId, characterId)] = JSON.stringify(retained);

      mockGetCharacterDeckCards.mockResolvedValueOnce([
        makeDeckRow('d1', 'c1', '轻击', 'attack', 1),
        makeDeckRow('d2', 'c2', '移动', 'tactical', 0),
        makeDeckRow('d3', 'c3', '防御', 'defense', 1),
      ]);

      const result = await drawCards(battleId, characterId, 3);

      expect(result.success).toBe(true);
      expect(result.drawn_count).toBe(3); // only counts newly drawn
      expect(result.deck_size).toBe(3);
      expect(result.cards).toHaveLength(4); // 3 drawn + 1 retained
      expect(result.cards![0]).toEqual(retained); // retained on top
      expect(result.retained_from_previous).toEqual(retained);
    });

    it('should DEL the retained key after merging into hand', async () => {
      const retained = makeHandCard('retained-d', 'retained-c', 'KeptCard');
      stringStore[retainedKey(battleId, characterId)] = JSON.stringify(retained);

      mockGetCharacterDeckCards.mockResolvedValueOnce([
        makeDeckRow('d1', 'c1', '轻击', 'attack', 1),
      ]);

      await drawCards(battleId, characterId, 1);

      expect(stringStore[retainedKey(battleId, characterId)]).toBeUndefined();
      expect(mockRedisClient.del).toHaveBeenCalledWith(
        retainedKey(battleId, characterId)
      );
    });

    it('should yield hand = [retained] when deck is empty but retained exists', async () => {
      const retained = makeHandCard('retained-d', 'retained-c', 'KeptCard');
      stringStore[retainedKey(battleId, characterId)] = JSON.stringify(retained);

      mockGetCharacterDeckCards.mockResolvedValueOnce([]);

      const result = await drawCards(battleId, characterId, 3);

      expect(result.success).toBe(true);
      expect(result.drawn_count).toBe(0);
      expect(result.deck_size).toBe(0);
      expect(result.cards).toEqual([retained]);
      expect(result.retained_from_previous).toEqual(retained);
      // Hand key is persisted with just the retained card
      const stored = JSON.parse(stringStore[handKey(battleId, characterId)]);
      expect(stored).toEqual([retained]);
    });

    it('should behave identically to legacy contract when retained key does not exist', async () => {
      // No retained key preloaded — same as a fresh battle / first draw
      mockGetCharacterDeckCards.mockResolvedValueOnce([
        makeDeckRow('d1', 'c1', '轻击', 'attack', 1),
        makeDeckRow('d2', 'c2', '移动', 'tactical', 0),
      ]);

      const result = await drawCards(battleId, characterId, 2);

      expect(result.success).toBe(true);
      expect(result.drawn_count).toBe(2);
      expect(result.deck_size).toBe(2);
      expect(result.cards).toHaveLength(2);
      // retained_from_previous must be absent (not just undefined-as-key)
      expect(result.retained_from_previous).toBeUndefined();
    });
  });
});
