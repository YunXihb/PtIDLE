// Unit tests for professionMechanicService

const mockRedisClient = {
  get: jest.fn(),
  set: jest.fn(),
  rPush: jest.fn(),
  lRange: jest.fn(),
  lRem: jest.fn(),
  del: jest.fn(),
};

const mockQuery = jest.fn();

jest.mock('../config/redis', () => ({
  redisClient: mockRedisClient,
}));

jest.mock('../config/database', () => ({
  query: mockQuery,
}));

import {
  canUseProfession,
  getCardProfession,
  getCharacterProfession,
  validateCardForDeckAssignment,
  validateCardForCombat,
  onWarriorAttackCardPlayed,
  applyWarriorTaunt,
  getTauntRedirect,
} from './professionMechanicService';

describe('professionMechanicService', () => {
  beforeEach(() => {
    // mockReset 会清空 mockResolvedValueOnce 队列；clearAllMocks 不会
    mockRedisClient.get.mockReset();
    mockRedisClient.set.mockReset();
    mockRedisClient.lRange.mockReset();
    mockRedisClient.rPush.mockReset();
    mockRedisClient.lRem.mockReset();
    mockRedisClient.del.mockReset();
    mockQuery.mockReset();
    // 重新设置默认值
    mockRedisClient.get.mockResolvedValue(null);
    mockRedisClient.set.mockResolvedValue('OK');
    mockRedisClient.lRange.mockResolvedValue([]);
    mockRedisClient.rPush.mockResolvedValue(1);
    mockRedisClient.lRem.mockResolvedValue(1);
    mockRedisClient.del.mockResolvedValue(1);
  });

  // ========================================
  // canUseProfession
  // ========================================
  describe('canUseProfession', () => {
    it('should return true when char profession matches card profession', () => {
      expect(canUseProfession('warrior', 'warrior')).toBe(true);
      expect(canUseProfession('ranger', 'ranger')).toBe(true);
      expect(canUseProfession('mage', 'mage')).toBe(true);
    });

    it('should return false when char profession differs from card profession', () => {
      expect(canUseProfession('warrior', 'ranger')).toBe(false);
      expect(canUseProfession('ranger', 'mage')).toBe(false);
      expect(canUseProfession('mage', 'warrior')).toBe(false);
    });

    it('should return true for any char profession when card is common', () => {
      expect(canUseProfession('warrior', 'common')).toBe(true);
      expect(canUseProfession('ranger', 'common')).toBe(true);
      expect(canUseProfession('mage', 'common')).toBe(true);
    });

    it('should return false for null inputs', () => {
      expect(canUseProfession(null, 'warrior')).toBe(false);
      expect(canUseProfession('warrior', null)).toBe(false);
      expect(canUseProfession(null, null)).toBe(false);
      expect(canUseProfession(undefined, 'warrior')).toBe(false);
    });
  });

  // ========================================
  // getCardProfession
  // ========================================
  describe('getCardProfession', () => {
    it('should return profession from card_templates', async () => {
      mockQuery.mockResolvedValueOnce([{ profession: 'warrior' }]);
      const result = await getCardProfession('pc-1');
      expect(result).toBe('warrior');
    });

    it('should return common for common cards', async () => {
      mockQuery.mockResolvedValueOnce([{ profession: 'common' }]);
      expect(await getCardProfession('pc-1')).toBe('common');
    });

    it('should return null when card not found', async () => {
      mockQuery.mockResolvedValueOnce([]);
      expect(await getCardProfession('nope')).toBeNull();
    });

    it('should return null when profession column is null', async () => {
      mockQuery.mockResolvedValueOnce([{ profession: null }]);
      expect(await getCardProfession('pc-1')).toBeNull();
    });
  });

  // ========================================
  // getCharacterProfession
  // ========================================
  describe('getCharacterProfession', () => {
    it('should return warrior/ranger/mage as-is', async () => {
      mockQuery.mockResolvedValueOnce([{ profession: 'ranger' }]);
      expect(await getCharacterProfession('c-1')).toBe('ranger');
    });

    it('should return null when character not found', async () => {
      mockQuery.mockResolvedValueOnce([]);
      expect(await getCharacterProfession('c-1')).toBeNull();
    });

    it('should return null when profession is invalid', async () => {
      mockQuery.mockResolvedValueOnce([{ profession: 'common' }]);
      expect(await getCharacterProfession('c-1')).toBeNull();
    });
  });

  // ========================================
  // validateCardForDeckAssignment / validateCardForCombat
  // ========================================
  describe('validateCardForDeckAssignment / validateCardForCombat', () => {
    it('should return valid when char prof matches card prof', async () => {
      mockQuery
        .mockResolvedValueOnce([{ profession: 'warrior' }])   // char
        .mockResolvedValueOnce([{ profession: 'warrior' }]);  // card
      const result = await validateCardForDeckAssignment('c-1', 'pc-1');
      expect(result.valid).toBe(true);
    });

    it('should return invalid with profession error when mismatch', async () => {
      mockQuery
        .mockResolvedValueOnce([{ profession: 'mage' }])
        .mockResolvedValueOnce([{ profession: 'warrior' }]);
      const result = await validateCardForDeckAssignment('c-1', 'pc-1');
      expect(result.valid).toBe(false);
      expect(result.error).toContain("'mage'");
      expect(result.error).toContain("'warrior'");
      expect(result.error).toContain('profession');
    });

    it('should return valid when char not found (caller responsibility)', async () => {
      mockQuery.mockResolvedValueOnce([]);  // char
      const result = await validateCardForDeckAssignment('c-1', 'pc-1');
      expect(result.valid).toBe(true);
    });

    it('should return valid when card not found (caller responsibility)', async () => {
      mockQuery
        .mockResolvedValueOnce([{ profession: 'warrior' }])  // char
        .mockResolvedValueOnce([]);                          // card
      const result = await validateCardForDeckAssignment('c-1', 'pc-1');
      expect(result.valid).toBe(true);
    });

    it('should allow common card for any profession', async () => {
      mockQuery
        .mockResolvedValueOnce([{ profession: 'ranger' }])
        .mockResolvedValueOnce([{ profession: 'common' }]);
      const result = await validateCardForDeckAssignment('c-1', 'pc-1');
      expect(result.valid).toBe(true);
    });

    it('validateCardForCombat should be equivalent to validateCardForDeckAssignment', async () => {
      mockQuery
        .mockResolvedValueOnce([{ profession: 'warrior' }])
        .mockResolvedValueOnce([{ profession: 'mage' }]);
      const result = await validateCardForCombat('c-1', 'pc-1');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('profession');
    });
  });

  // ========================================
  // onWarriorAttackCardPlayed - Warrior 机制 1
  // ========================================
  describe('onWarriorAttackCardPlayed', () => {
    it('1st attack card: counter=1, no shield gained', async () => {
      mockRedisClient.get.mockResolvedValueOnce(null);
      mockRedisClient.lRange.mockResolvedValueOnce([]);

      const result = await onWarriorAttackCardPlayed('b-1', 'w-1', 2, 1);
      expect(result.attackCounter).toBe(1);
      expect(result.shieldGained).toBe(0);
      expect(result.totalShield).toBe(0);
      // 应当写回状态
      expect(mockRedisClient.set).toHaveBeenCalled();
      // 不应调用 rPush（无 shield effect 写入）
      expect(mockRedisClient.rPush).not.toHaveBeenCalled();
    });

    it('2nd attack card (cost 2) with 1st cost 3: shield should be 5 (sum of last 2)', async () => {
      mockRedisClient.get.mockResolvedValueOnce(
        JSON.stringify({ attack_counter: 1, attack_cost_buffer: [3] })
      );
      mockRedisClient.lRange.mockResolvedValueOnce([]);

      const result = await onWarriorAttackCardPlayed('b-1', 'w-1', 2, 1);
      // buffer is now [3, 2], lastTwo = [3, 2], sum = 5
      expect(result.shieldGained).toBe(5);
      expect(result.attackCounter).toBe(0);
      // rPush 应当被调用（写入 shield effect）
      expect(mockRedisClient.rPush).toHaveBeenCalled();
    });

    it('3rd attack card (cost 1) without trigger: counter=1', async () => {
      // 上次触发了所以 counter=0, buffer=[]
      mockRedisClient.get.mockResolvedValueOnce(
        JSON.stringify({ attack_counter: 0, attack_cost_buffer: [] })
      );
      mockRedisClient.lRange.mockResolvedValueOnce([]);

      const result = await onWarriorAttackCardPlayed('b-1', 'w-1', 1, 2);
      expect(result.attackCounter).toBe(1);
      expect(result.shieldGained).toBe(0);
    });

    it('4th attack card (cost 2): trigger again, shield sum of last 2 in new window', async () => {
      // 上次只打了 1 张（counter=1, buffer=[1]）
      mockRedisClient.get.mockResolvedValueOnce(
        JSON.stringify({ attack_counter: 1, attack_cost_buffer: [1] })
      );
      mockRedisClient.lRange.mockResolvedValueOnce([]);

      const result = await onWarriorAttackCardPlayed('b-1', 'w-1', 2, 3);
      // buffer: [1, 2], lastTwo = [1, 2], sum = 3
      expect(result.shieldGained).toBe(3);
      expect(result.attackCounter).toBe(0);
    });

    it('should write warrior status after each call', async () => {
      mockRedisClient.get.mockResolvedValueOnce(null);
      mockRedisClient.lRange.mockResolvedValueOnce([]);

      await onWarriorAttackCardPlayed('b-1', 'w-1', 1, 1);
      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'battle:b-1:warrior_status:w-1',
        expect.stringContaining('"attack_counter":1')
      );
    });

    it('should ignore corrupted JSON in get()', async () => {
      mockRedisClient.get.mockResolvedValueOnce('not-json');
      mockRedisClient.lRange.mockResolvedValueOnce([]);

      const result = await onWarriorAttackCardPlayed('b-1', 'w-1', 1, 1);
      expect(result.attackCounter).toBe(1);
    });
  });

  // ========================================
  // applyWarriorTaunt - Warrior 机制 2
  // ========================================
  describe('applyWarriorTaunt', () => {
    const makeGetPos = (warriorPos: { x: number; y: number } | null, targetPos: { x: number; y: number } | null) =>
      jest.fn(async (_b: string, id: string) => {
        if (id === 'w-1') return warriorPos;
        if (id === 't-1') return targetPos;
        return null;
      });

    const makeGetPiece = (target: any) =>
      jest.fn(async (_b: string, id: string) => (id === 't-1' ? target : null));

    it('should succeed and write taunt effect when target in range', async () => {
      const getPos = makeGetPos({ x: 0, y: 0 }, { x: 2, y: 0 });
      const getPiece = makeGetPiece({ is_alive: true, profession: 'mage', player_id: 'p-2' });
      mockRedisClient.lRange.mockResolvedValueOnce([]);

      const result = await applyWarriorTaunt('b-1', 'w-1', 't-1', 3, 1, getPos, getPiece);
      expect(result.success).toBe(true);
      expect(mockRedisClient.rPush).toHaveBeenCalled();
      const pushed = JSON.parse(mockRedisClient.rPush.mock.calls[0][1]);
      expect(pushed.type).toBe('taunt');
      expect(pushed.source_id).toBe('w-1');
      expect(pushed.target_id).toBe('w-1');
      expect(pushed.value).toBe(3);
      expect(pushed.duration_rounds).toBe(1);
    });

    it('should fail when target not found', async () => {
      const getPos = makeGetPos({ x: 0, y: 0 }, null);
      const getPiece = makeGetPiece(null);
      const result = await applyWarriorTaunt('b-1', 'w-1', 't-1', 3, 1, getPos, getPiece);
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should fail when target not alive', async () => {
      const getPos = makeGetPos({ x: 0, y: 0 }, { x: 1, y: 0 });
      const getPiece = makeGetPiece({ is_alive: false });
      const result = await applyWarriorTaunt('b-1', 'w-1', 't-1', 3, 1, getPos, getPiece);
      expect(result.success).toBe(false);
      expect(result.error).toContain('not alive');
    });

    it('should fail when target out of range', async () => {
      const getPos = makeGetPos({ x: 0, y: 0 }, { x: 4, y: 4 });  // dist = 5.66 > 3
      const getPiece = makeGetPiece({ is_alive: true, player_id: 'p-2' });
      const result = await applyWarriorTaunt('b-1', 'w-1', 't-1', 3, 1, getPos, getPiece);
      expect(result.success).toBe(false);
      expect(result.error).toContain('out of range');
    });

    it('should remove existing taunt from same source (覆盖语义)', async () => {
      const getPos = makeGetPos({ x: 0, y: 0 }, { x: 1, y: 0 });
      const getPiece = makeGetPiece({ is_alive: true, player_id: 'p-2' });
      // pre-existing taunt from same source
      // removeTauntFromSource: getActiveEffects → lRange, then removeEffect → lRange + lRem
      // 两次 lRange 都需要返回该 taunt
      const tauntJson = JSON.stringify({
        effect_id: 'old-taunt', type: 'taunt', value: 3, duration_rounds: 1,
        created_round: 1, expire_round: 999, source_id: 'w-1', target_id: 'w-1',
      });
      mockRedisClient.lRange
        .mockResolvedValueOnce([tauntJson])
        .mockResolvedValueOnce([tauntJson]);
      mockRedisClient.lRem.mockResolvedValueOnce(1);

      const result = await applyWarriorTaunt('b-1', 'w-1', 't-1', 3, 1, getPos, getPiece);
      expect(result.success).toBe(true);
      // lRem 应当被调用（移除旧 taunt）
      expect(mockRedisClient.lRem).toHaveBeenCalled();
    });
  });

  // ========================================
  // getTauntRedirect
  // ========================================
  describe('getTauntRedirect', () => {
    it('should return redirect info when target has active taunt', async () => {
      mockRedisClient.lRange.mockResolvedValueOnce([
        JSON.stringify({
          effect_id: 't-1', type: 'taunt', value: 3, duration_rounds: 1,
          created_round: 1, expire_round: 5, source_id: 'w-1', target_id: 'w-1',
        }),
      ]);
      const result = await getTauntRedirect('b-1', 'attacker-1', 't-1', 3);
      expect(result.mustRedirectTo).toBe('w-1');
      expect(result.sourceId).toBe('w-1');
    });

    it('should return null when no active taunt', async () => {
      mockRedisClient.lRange.mockResolvedValueOnce([]);
      const result = await getTauntRedirect('b-1', 'attacker-1', 't-1', 3);
      expect(result.mustRedirectTo).toBeNull();
      expect(result.sourceId).toBeNull();
    });

    it('should return null when taunt is by the attacker themselves (no redirect needed)', async () => {
      // taunt target_id = attacker (自己)，无需重定向
      mockRedisClient.lRange.mockResolvedValueOnce([
        JSON.stringify({
          effect_id: 't-1', type: 'taunt', value: 3, duration_rounds: 1,
          created_round: 1, expire_round: 5, source_id: 'attacker-1', target_id: 'attacker-1',
        }),
      ]);
      const result = await getTauntRedirect('b-1', 'attacker-1', 't-1', 3);
      expect(result.mustRedirectTo).toBeNull();
    });

    it('should ignore non-taunt effects', async () => {
      mockRedisClient.lRange.mockResolvedValueOnce([
        JSON.stringify({
          effect_id: 's-1', type: 'shield', value: 5, duration_rounds: 2,
          created_round: 1, expire_round: 5,
        }),
      ]);
      const result = await getTauntRedirect('b-1', 'attacker-1', 't-1', 3);
      expect(result.mustRedirectTo).toBeNull();
    });
  });
});
