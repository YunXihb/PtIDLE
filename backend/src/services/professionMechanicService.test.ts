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
  onRangerAttackCardPlayed,
  getRangerDamageBoost,
  consumeRangerDamageBoost,
  RANGER_DAMAGE_BOOST_VALUE,
  attachFireMark,
  applyBurnDamage,
  getMageMarkState,
  MAGE_MARK_NEVER_EXPIRE_ROUND,
  MAGE_BURN_DURATION_ROUNDS,
  MAGE_BURN_DAMAGE_PER_TICK,
  MAGE_MARK_BURN_THRESHOLD,
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

  // ========================================
  // T040: Ranger 机制 1 - 攻击累计增伤
  // ========================================
  describe('RANGER_DAMAGE_BOOST_VALUE constant', () => {
    it('should be 0.5 (i.e. 1.5x damage multiplier)', () => {
      expect(RANGER_DAMAGE_BOOST_VALUE).toBe(0.5);
    });
  });

  describe('onRangerAttackCardPlayed - ranger 私有状态', () => {
    it('initial state: attack_counter=0 when no key in Redis', async () => {
      // onRangerAttackCardPlayed 内部 readRangerStatus → get
      // 1st attack: counter 0→1, 不触发
      // 内部 getActiveEffects 检查时 lRange (空)
      mockRedisClient.get.mockResolvedValueOnce(null);
      mockRedisClient.lRange.mockResolvedValueOnce([]);

      const result = await onRangerAttackCardPlayed('b-1', 'r-1', 1);
      expect(result.attackCounter).toBe(1);
      expect(result.damageBoostApplied).toBe(false);
      expect(result.damageBoostValue).toBe(0.5);
      // 不写入 damage_boost effect
      expect(mockRedisClient.rPush).not.toHaveBeenCalled();
    });

    it('should write ranger status JSON with attack_counter=1 after 1st attack', async () => {
      mockRedisClient.get.mockResolvedValueOnce(null);
      mockRedisClient.lRange.mockResolvedValueOnce([]);

      await onRangerAttackCardPlayed('b-1', 'r-1', 1);
      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'battle:b-1:ranger_status:r-1',
        expect.stringContaining('"attack_counter":1')
      );
    });
  });

  describe('onRangerAttackCardPlayed - 触发模式', () => {
    it('2nd attack: counter 1→0, triggers damage_boost effect (value=0.5)', async () => {
      // 1st attack 已写入 counter=1
      mockRedisClient.get.mockResolvedValueOnce(
        JSON.stringify({ attack_counter: 1 })
      );
      // 触发后内部 getActiveEffects 不需要 (damage_boost 写入走 applyEffect)
      // applyEffect 内部不调 lRange
      const result = await onRangerAttackCardPlayed('b-1', 'r-1', 1);
      expect(result.attackCounter).toBe(0);
      expect(result.damageBoostApplied).toBe(true);
      expect(result.damageBoostValue).toBe(0.5);
      // rPush 应当被调用（写入 damage_boost effect）
      expect(mockRedisClient.rPush).toHaveBeenCalled();
      const pushed = JSON.parse(mockRedisClient.rPush.mock.calls[0][1]);
      expect(pushed.type).toBe('damage_boost');
      expect(pushed.value).toBe(0.5);
      expect(pushed.duration_rounds).toBe(1);
    });

    it('3rd attack: counter 0→1, no new boost (counter 重启累加)', async () => {
      // 2nd attack 触发了：counter 归 0
      mockRedisClient.get.mockResolvedValueOnce(
        JSON.stringify({ attack_counter: 0 })
      );
      // 触发判断前内部 getActiveEffects
      mockRedisClient.lRange.mockResolvedValueOnce([]);
      const result = await onRangerAttackCardPlayed('b-1', 'r-1', 2);
      expect(result.attackCounter).toBe(1);
      expect(result.damageBoostApplied).toBe(false);
    });

    it('4th attack: counter 1→0, triggers damage_boost again (cycle 2)', async () => {
      // 3rd attack 累积到 counter=1
      mockRedisClient.get.mockResolvedValueOnce(
        JSON.stringify({ attack_counter: 1 })
      );
      const result = await onRangerAttackCardPlayed('b-1', 'r-1', 3);
      expect(result.attackCounter).toBe(0);
      expect(result.damageBoostApplied).toBe(true);
    });

    it('should ignore corrupted JSON in get()', async () => {
      mockRedisClient.get.mockResolvedValueOnce('not-json');
      mockRedisClient.lRange.mockResolvedValueOnce([]);

      const result = await onRangerAttackCardPlayed('b-1', 'r-1', 1);
      expect(result.attackCounter).toBe(1);
    });
  });

  describe('getRangerDamageBoost - 读取', () => {
    it('should return null when no active damage_boost', async () => {
      mockRedisClient.lRange.mockResolvedValueOnce([]);
      const result = await getRangerDamageBoost('b-1', 'r-1', 1);
      expect(result).toBeNull();
    });

    it('should return boost info when active damage_boost exists', async () => {
      mockRedisClient.lRange.mockResolvedValueOnce([
        JSON.stringify({
          effect_id: 'boost-1', type: 'damage_boost', value: 0.5,
          duration_rounds: 1, created_round: 1, expire_round: 5,
        }),
      ]);
      const result = await getRangerDamageBoost('b-1', 'r-1', 1);
      expect(result).not.toBeNull();
      expect(result!.value).toBe(0.5);
      expect(result!.effectId).toBe('boost-1');
    });

    it('should ignore non-damage_boost effects (shield coexisting)', async () => {
      mockRedisClient.lRange.mockResolvedValueOnce([
        JSON.stringify({
          effect_id: 'shield-1', type: 'shield', value: 5,
          duration_rounds: 2, created_round: 1, expire_round: 5,
        }),
      ]);
      const result = await getRangerDamageBoost('b-1', 'r-1', 1);
      expect(result).toBeNull();
    });

    it('should return first damage_boost when multiple effects (shield + damage_boost)', async () => {
      mockRedisClient.lRange.mockResolvedValueOnce([
        JSON.stringify({
          effect_id: 'shield-1', type: 'shield', value: 5,
          duration_rounds: 2, created_round: 1, expire_round: 5,
        }),
        JSON.stringify({
          effect_id: 'boost-1', type: 'damage_boost', value: 0.5,
          duration_rounds: 1, created_round: 1, expire_round: 5,
        }),
      ]);
      const result = await getRangerDamageBoost('b-1', 'r-1', 1);
      expect(result).not.toBeNull();
      expect(result!.value).toBe(0.5);
      expect(result!.effectId).toBe('boost-1');
    });

    it('should default value to 0 when damage_boost.value is undefined', async () => {
      mockRedisClient.lRange.mockResolvedValueOnce([
        JSON.stringify({
          effect_id: 'boost-1', type: 'damage_boost',
          duration_rounds: 1, created_round: 1, expire_round: 5,
        }),
      ]);
      const result = await getRangerDamageBoost('b-1', 'r-1', 1);
      expect(result).not.toBeNull();
      expect(result!.value).toBe(0);
    });
  });

  describe('consumeRangerDamageBoost - 消耗', () => {
    it('should return null and not remove anything when no active damage_boost', async () => {
      mockRedisClient.lRange.mockResolvedValueOnce([]);
      const result = await consumeRangerDamageBoost('b-1', 'r-1', 1);
      expect(result).toBeNull();
      // 不应调用 lRem
      expect(mockRedisClient.lRem).not.toHaveBeenCalled();
    });

    it('should remove effect and return boost info when active damage_boost exists', async () => {
      const boostJson = JSON.stringify({
        effect_id: 'boost-1', type: 'damage_boost', value: 0.5,
        duration_rounds: 1, created_round: 1, expire_round: 5,
      });
      mockRedisClient.lRange
        .mockResolvedValueOnce([boostJson])
        .mockResolvedValueOnce([boostJson]);  // removeEffect also calls lRange
      mockRedisClient.lRem.mockResolvedValueOnce(1);

      const result = await consumeRangerDamageBoost('b-1', 'r-1', 1);
      expect(result).not.toBeNull();
      expect(result!.value).toBe(0.5);
      expect(result!.effectId).toBe('boost-1');
      expect(mockRedisClient.lRem).toHaveBeenCalled();
    });

    it('after consume, getRangerDamageBoost should return null', async () => {
      const boostJson = JSON.stringify({
        effect_id: 'boost-1', type: 'damage_boost', value: 0.5,
        duration_rounds: 1, created_round: 1, expire_round: 5,
      });
      // First call: consumeRangerDamageBoost
      mockRedisClient.lRange
        .mockResolvedValueOnce([boostJson])
        .mockResolvedValueOnce([boostJson]);
      mockRedisClient.lRem.mockResolvedValueOnce(1);
      // Second call: getRangerDamageBoost (after consume)
      mockRedisClient.lRange.mockResolvedValueOnce([]);

      await consumeRangerDamageBoost('b-1', 'r-1', 1);
      const result = await getRangerDamageBoost('b-1', 'r-1', 1);
      expect(result).toBeNull();
    });

    it('should not remove shield effect when consuming damage_boost', async () => {
      const shieldJson = JSON.stringify({
        effect_id: 'shield-1', type: 'shield', value: 5,
        duration_rounds: 2, created_round: 1, expire_round: 5,
      });
      const boostJson = JSON.stringify({
        effect_id: 'boost-1', type: 'damage_boost', value: 0.5,
        duration_rounds: 1, created_round: 1, expire_round: 5,
      });
      // First lRange: getActiveEffects (returns both)
      // Second lRange: removeEffect (returns both, then lRem only boost)
      mockRedisClient.lRange
        .mockResolvedValueOnce([shieldJson, boostJson])
        .mockResolvedValueOnce([shieldJson, boostJson]);
      mockRedisClient.lRem.mockResolvedValueOnce(1);

      const result = await consumeRangerDamageBoost('b-1', 'r-1', 1);
      expect(result).not.toBeNull();
      expect(result!.effectId).toBe('boost-1');
      // lRem should be called with the boost json specifically
      expect(mockRedisClient.lRem).toHaveBeenCalledWith(
        'battle:b-1:effects:r-1',
        0,
        boostJson
      );
    });
  });

  describe('ranger vs warrior key 隔离', () => {
    it('ranger_status key should not affect warrior_status key', async () => {
      mockRedisClient.get.mockResolvedValueOnce(null);
      mockRedisClient.lRange.mockResolvedValueOnce([]);
      await onRangerAttackCardPlayed('b-1', 'r-1', 1);

      // 应当写入 ranger_status key, 不写 warrior_status key
      const setCalls = mockRedisClient.set.mock.calls;
      const rangerKeyCalls = setCalls.filter(
        (call: unknown[]) => (call[0] as string).includes('ranger_status')
      );
      const warriorKeyCalls = setCalls.filter(
        (call: unknown[]) => (call[0] as string).includes('warrior_status')
      );
      expect(rangerKeyCalls.length).toBe(1);
      expect(warriorKeyCalls.length).toBe(0);
    });
  });

  // ========================================
  // T041: Mage 机制 2 - debuff/灼伤系统
  // ========================================

  describe('T041 constants', () => {
    it('MAGE_MARK_NEVER_EXPIRE_ROUND should be 99999', () => {
      expect(MAGE_MARK_NEVER_EXPIRE_ROUND).toBe(99999);
    });

    it('MAGE_BURN_DURATION_ROUNDS should be 2', () => {
      expect(MAGE_BURN_DURATION_ROUNDS).toBe(2);
    });

    it('MAGE_BURN_DAMAGE_PER_TICK should be 1', () => {
      expect(MAGE_BURN_DAMAGE_PER_TICK).toBe(1);
    });

    it('MAGE_MARK_BURN_THRESHOLD should be 2', () => {
      expect(MAGE_MARK_BURN_THRESHOLD).toBe(2);
    });
  });

  describe('attachFireMark - 基础路径', () => {
    it('public_pool source: should return early without marking', async () => {
      const result = await attachFireMark('b-1', 't-1', 1, 'public_pool');
      expect(result.marksAdded).toBe(false);
      expect(result.burnTriggered).toBe(false);
      expect(mockRedisClient.rPush).not.toHaveBeenCalled();
    });

    it('target with 0 mark: should add 1 mark, no burn triggered', async () => {
      // getActiveEffects (1st): check burn → 0
      mockRedisClient.lRange.mockResolvedValueOnce([]);
      // applyEffect 内部不调 lRange
      // getActiveEffects (2nd): count mark → 0
      mockRedisClient.lRange.mockResolvedValueOnce([]);

      const result = await attachFireMark('b-1', 't-1', 1, 'deck');
      expect(result.marksAdded).toBe(true);
      expect(result.burnTriggered).toBe(false);
      expect(result.currentMarkCount).toBe(0);  // 转换前 mark 数
      expect(result.currentBurnCount).toBe(0);
      expect(mockRedisClient.rPush).toHaveBeenCalledTimes(1);
      const pushed = JSON.parse(mockRedisClient.rPush.mock.calls[0][1]);
      expect(pushed.type).toBe('mark_fire');
      expect(pushed.duration_rounds).toBe(99999);
    });

    it('target with 1 mark: add 1 mark → trigger burn (mark 清 + 加 1 burn)', async () => {
      const markJson = JSON.stringify({
        effect_id: 'mark-1', type: 'mark_fire',
        duration_rounds: 99999, created_round: 1, expire_round: 99999,
      });
      // getActiveEffects (1st): check burn → 0 (只 mark)
      mockRedisClient.lRange.mockResolvedValueOnce([markJson]);
      // applyEffect (RPUSH) 不调 lRange
      // getActiveEffects (2nd): count mark → 1 mark (RPUSH 后再 read 仍 1，因为 mark 列表只反映 LREM 前)
      // 等等，RPUSH 后再 read 应该 = 2 (1 old + 1 new)
      // 这里按实现：调用 getActiveEffects → lRange 1 次
      mockRedisClient.lRange.mockResolvedValueOnce([markJson, markJson]);
      // removeEffect: lRange + lRem
      mockRedisClient.lRange
        .mockResolvedValueOnce([markJson, markJson])  // removeEffect 1st mark
        .mockResolvedValueOnce([markJson]);          // removeEffect 2nd mark
      mockRedisClient.lRem.mockResolvedValue(1);

      const result = await attachFireMark('b-1', 't-1', 1, 'deck');
      expect(result.marksAdded).toBe(true);
      expect(result.burnTriggered).toBe(true);
      expect(result.currentMarkCount).toBe(2);
      // rPush 应当被调用 2 次：1 mark_fire + 1 burn
      expect(mockRedisClient.rPush).toHaveBeenCalledTimes(2);
      // 第 2 个 rPush 是 burn
      const burnPushed = JSON.parse(mockRedisClient.rPush.mock.calls[1][1]);
      expect(burnPushed.type).toBe('burn');
      expect(burnPushed.value).toBe(1);
      expect(burnPushed.duration_rounds).toBe(2);
    });

    it('target with 2 marks: add 1 mark → trigger burn (same as 1 mark case)', async () => {
      const markJson1 = JSON.stringify({
        effect_id: 'mark-1', type: 'mark_fire',
        duration_rounds: 99999, created_round: 1, expire_round: 99999,
      });
      const markJson2 = JSON.stringify({
        effect_id: 'mark-2', type: 'mark_fire',
        duration_rounds: 99999, created_round: 1, expire_round: 99999,
      });
      // 1st: check burn
      mockRedisClient.lRange.mockResolvedValueOnce([markJson1, markJson2]);
      // 2nd: count mark after RPUSH
      mockRedisClient.lRange.mockResolvedValueOnce([markJson1, markJson2, markJson1]);
      // removeEffect x2
      mockRedisClient.lRange.mockResolvedValue([markJson1, markJson2, markJson1]);
      mockRedisClient.lRem.mockResolvedValue(1);

      const result = await attachFireMark('b-1', 't-1', 1, 'deck');
      expect(result.marksAdded).toBe(true);
      expect(result.burnTriggered).toBe(true);
    });

    it('target with active burn: mark should be ignored (no mark added)', async () => {
      const burnJson = JSON.stringify({
        effect_id: 'burn-1', type: 'burn', value: 1,
        duration_rounds: 2, created_round: 1, expire_round: 5,
      });
      mockRedisClient.lRange.mockResolvedValueOnce([burnJson]);

      const result = await attachFireMark('b-1', 't-1', 1, 'deck');
      expect(result.marksAdded).toBe(false);
      expect(result.burnTriggered).toBe(false);
      expect(result.currentBurnCount).toBe(1);
      // 不应调用 rPush
      expect(mockRedisClient.rPush).not.toHaveBeenCalled();
    });
  });

  describe('applyBurnDamage - 灼伤结算', () => {
    it('no burn: totalDamage=0, burnCount=0', async () => {
      mockRedisClient.lRange.mockResolvedValueOnce([]);
      const result = await applyBurnDamage('b-1', 't-1', 1);
      expect(result.totalDamage).toBe(0);
      expect(result.burnCount).toBe(0);
      expect(result.burnEffectIds).toEqual([]);
    });

    it('1 burn: totalDamage=1, burnCount=1', async () => {
      mockRedisClient.lRange.mockResolvedValueOnce([
        JSON.stringify({
          effect_id: 'burn-1', type: 'burn', value: 1,
          duration_rounds: 2, created_round: 1, expire_round: 5,
        }),
      ]);
      const result = await applyBurnDamage('b-1', 't-1', 1);
      expect(result.totalDamage).toBe(1);
      expect(result.burnCount).toBe(1);
      expect(result.burnEffectIds).toEqual(['burn-1']);
    });

    it('2 burns: totalDamage=2 (stacking)', async () => {
      mockRedisClient.lRange.mockResolvedValueOnce([
        JSON.stringify({
          effect_id: 'burn-1', type: 'burn', value: 1,
          duration_rounds: 2, created_round: 1, expire_round: 5,
        }),
        JSON.stringify({
          effect_id: 'burn-2', type: 'burn', value: 1,
          duration_rounds: 2, created_round: 1, expire_round: 5,
        }),
      ]);
      const result = await applyBurnDamage('b-1', 't-1', 1);
      expect(result.totalDamage).toBe(2);
      expect(result.burnCount).toBe(2);
      expect(result.burnEffectIds).toEqual(['burn-1', 'burn-2']);
    });

    it('burn + shield + mark_fire coexist: only burn counts', async () => {
      mockRedisClient.lRange.mockResolvedValueOnce([
        JSON.stringify({
          effect_id: 's-1', type: 'shield', value: 5,
          duration_rounds: 2, created_round: 1, expire_round: 5,
        }),
        JSON.stringify({
          effect_id: 'b-1', type: 'burn', value: 1,
          duration_rounds: 2, created_round: 1, expire_round: 5,
        }),
        JSON.stringify({
          effect_id: 'm-1', type: 'mark_fire',
          duration_rounds: 99999, created_round: 1, expire_round: 99999,
        }),
      ]);
      const result = await applyBurnDamage('b-1', 't-1', 1);
      expect(result.totalDamage).toBe(1);
      expect(result.burnCount).toBe(1);
      expect(result.burnEffectIds).toEqual(['b-1']);
    });

    it('burn expired (not in active list): 0 damage', async () => {
      // getActiveEffects 过滤了过期的 burn
      mockRedisClient.lRange.mockResolvedValueOnce([]);
      const result = await applyBurnDamage('b-1', 't-1', 5);
      expect(result.totalDamage).toBe(0);
      expect(result.burnCount).toBe(0);
    });
  });

  describe('getMageMarkState - 读取', () => {
    it('empty effects: markCount=0, burnCount=0', async () => {
      mockRedisClient.lRange.mockResolvedValueOnce([]);
      const result = await getMageMarkState('b-1', 't-1', 1);
      expect(result.markCount).toBe(0);
      expect(result.burnCount).toBe(0);
      expect(result.totalBurnDamage).toBe(0);
    });

    it('only marks: markCount=N, burnCount=0, totalBurnDamage=0', async () => {
      mockRedisClient.lRange.mockResolvedValueOnce([
        JSON.stringify({
          effect_id: 'm-1', type: 'mark_fire',
          duration_rounds: 99999, created_round: 1, expire_round: 99999,
        }),
        JSON.stringify({
          effect_id: 'm-2', type: 'mark_fire',
          duration_rounds: 99999, created_round: 1, expire_round: 99999,
        }),
      ]);
      const result = await getMageMarkState('b-1', 't-1', 1);
      expect(result.markCount).toBe(2);
      expect(result.burnCount).toBe(0);
      expect(result.totalBurnDamage).toBe(0);
    });

    it('only burns: markCount=0, burnCount=N, totalBurnDamage=N', async () => {
      mockRedisClient.lRange.mockResolvedValueOnce([
        JSON.stringify({
          effect_id: 'b-1', type: 'burn', value: 1,
          duration_rounds: 2, created_round: 1, expire_round: 5,
        }),
        JSON.stringify({
          effect_id: 'b-2', type: 'burn', value: 1,
          duration_rounds: 2, created_round: 1, expire_round: 5,
        }),
      ]);
      const result = await getMageMarkState('b-1', 't-1', 1);
      expect(result.markCount).toBe(0);
      expect(result.burnCount).toBe(2);
      expect(result.totalBurnDamage).toBe(2);
    });

    it('mark + burn coexist: both returned (test function independence)', async () => {
      mockRedisClient.lRange.mockResolvedValueOnce([
        JSON.stringify({
          effect_id: 'm-1', type: 'mark_fire',
          duration_rounds: 99999, created_round: 1, expire_round: 99999,
        }),
        JSON.stringify({
          effect_id: 'b-1', type: 'burn', value: 1,
          duration_rounds: 2, created_round: 1, expire_round: 5,
        }),
      ]);
      const result = await getMageMarkState('b-1', 't-1', 1);
      expect(result.markCount).toBe(1);
      expect(result.burnCount).toBe(1);
      expect(result.totalBurnDamage).toBe(1);
    });
  });

  describe('mark + burn 共存边界', () => {
    it('target with 1 burn + 0 mark: attach mark → ignored', async () => {
      const burnJson = JSON.stringify({
        effect_id: 'b-1', type: 'burn', value: 1,
        duration_rounds: 2, created_round: 1, expire_round: 5,
      });
      mockRedisClient.lRange.mockResolvedValueOnce([burnJson]);
      const result = await attachFireMark('b-1', 't-1', 1, 'deck');
      expect(result.marksAdded).toBe(false);
      expect(result.burnTriggered).toBe(false);
      expect(result.currentBurnCount).toBe(1);
    });

    it('target with 2 burns + 0 mark: attach mark → ignored', async () => {
      const burnJson1 = JSON.stringify({
        effect_id: 'b-1', type: 'burn', value: 1,
        duration_rounds: 2, created_round: 1, expire_round: 5,
      });
      const burnJson2 = JSON.stringify({
        effect_id: 'b-2', type: 'burn', value: 1,
        duration_rounds: 2, created_round: 1, expire_round: 5,
      });
      mockRedisClient.lRange.mockResolvedValueOnce([burnJson1, burnJson2]);
      const result = await attachFireMark('b-1', 't-1', 1, 'deck');
      expect(result.marksAdded).toBe(false);
      expect(result.burnTriggered).toBe(false);
      expect(result.currentBurnCount).toBe(2);
    });

    it('target with 0 burn + 1 mark: attach mark → trigger burn', async () => {
      const markJson = JSON.stringify({
        effect_id: 'm-1', type: 'mark_fire',
        duration_rounds: 99999, created_round: 1, expire_round: 99999,
      });
      // 1st: check burn → 0
      mockRedisClient.lRange.mockResolvedValueOnce([markJson]);
      // 2nd: count mark after RPUSH
      mockRedisClient.lRange.mockResolvedValueOnce([markJson, markJson]);
      // removeEffect
      mockRedisClient.lRange.mockResolvedValue([markJson, markJson]);
      mockRedisClient.lRem.mockResolvedValue(1);

      const result = await attachFireMark('b-1', 't-1', 1, 'deck');
      expect(result.marksAdded).toBe(true);
      expect(result.burnTriggered).toBe(true);
      expect(result.currentMarkCount).toBe(2);
    });
  });

  describe('mage key 隔离 (与 warrior/ranger)', () => {
    it('mark_fire should not affect warrior shield', async () => {
      const shieldJson = JSON.stringify({
        effect_id: 's-1', type: 'shield', value: 5,
        duration_rounds: 2, created_round: 1, expire_round: 5,
      });
      const markJson = JSON.stringify({
        effect_id: 'm-1', type: 'mark_fire',
        duration_rounds: 99999, created_round: 1, expire_round: 99999,
      });
      mockRedisClient.lRange.mockResolvedValueOnce([shieldJson]);
      const result = await getMageMarkState('b-1', 't-1', 1);
      expect(result.markCount).toBe(0);
      expect(result.burnCount).toBe(0);
      // shield 没有被误读为 mark/burn
    });

    it('mark_fire should not affect ranger damage_boost', async () => {
      const boostJson = JSON.stringify({
        effect_id: 'b-1', type: 'damage_boost', value: 0.5,
        duration_rounds: 1, created_round: 1, expire_round: 5,
      });
      const markJson = JSON.stringify({
        effect_id: 'm-1', type: 'mark_fire',
        duration_rounds: 99999, created_round: 1, expire_round: 99999,
      });
      mockRedisClient.lRange.mockResolvedValueOnce([boostJson]);
      const result = await getMageMarkState('b-1', 't-1', 1);
      expect(result.markCount).toBe(0);
      expect(result.burnCount).toBe(0);
    });

    it('mark_fire/burn should use effects:{target_id} key (shared with warrior/ranger)', async () => {
      // attachFireMark 写入的 effect 应该用同一个 effects LIST
      mockRedisClient.lRange.mockResolvedValueOnce([]);   // check burn
      mockRedisClient.lRange.mockResolvedValueOnce([]);   // count mark
      await attachFireMark('b-1', 't-1', 1, 'deck');
      // rPush 应该用 'battle:b-1:effects:t-1' 这个 key
      const rPushKey = mockRedisClient.rPush.mock.calls[0][0];
      expect(rPushKey).toBe('battle:b-1:effects:t-1');
    });
  });
});
