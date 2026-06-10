// Unit tests for statusEffectService

const mockRedisClient = {
  rPush: jest.fn(),
  lRange: jest.fn(),
  lRem: jest.fn(),
  del: jest.fn(),
};

jest.mock('../config/redis', () => ({
  redisClient: mockRedisClient,
}));

import {
  applyEffect,
  removeEffect,
  removeEffectsByType,
  getActiveEffects,
  tickEffects,
  clearEffects,
  sumActiveShield,
  StatusEffect,
} from './statusEffectService';

describe('statusEffectService', () => {
  const battleId = 'battle-1';
  const charId = 'char-1';

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisClient.lRange.mockResolvedValue([]);
    mockRedisClient.rPush.mockResolvedValue(1);
    mockRedisClient.lRem.mockResolvedValue(1);
    mockRedisClient.del.mockResolvedValue(1);
  });

  describe('applyEffect', () => {
    it('should RPUSH JSON effect with effect_id and compute expire_round', async () => {
      const result = await applyEffect(battleId, charId, {
        type: 'shield',
        value: 5,
        duration_rounds: 2,
        currentRound: 3,
      });

      expect(result.effect_id).toBeDefined();
      expect(result.created_round).toBe(3);
      expect(result.expire_round).toBe(5); // 3 + 2
      expect(mockRedisClient.rPush).toHaveBeenCalledWith(
        `battle:${battleId}:effects:${charId}`,
        JSON.stringify(result)
      );
    });

    it('should generate unique effect_id per call', async () => {
      const a = await applyEffect(battleId, charId, {
        type: 'shield', value: 1, duration_rounds: 1, currentRound: 1,
      });
      const b = await applyEffect(battleId, charId, {
        type: 'shield', value: 1, duration_rounds: 1, currentRound: 1,
      });
      expect(a.effect_id).not.toBe(b.effect_id);
    });

    it('should preserve source_id and target_id fields', async () => {
      const result = await applyEffect(battleId, charId, {
        type: 'taunt',
        value: 3,
        duration_rounds: 1,
        source_id: 'warrior-1',
        target_id: 'warrior-1',
        currentRound: 5,
      });
      expect(result.source_id).toBe('warrior-1');
      expect(result.target_id).toBe('warrior-1');
      expect(result.expire_round).toBe(6);
    });
  });

  describe('removeEffect', () => {
    it('should remove effect by effect_id', async () => {
      const stored = JSON.stringify({
        effect_id: 'e-1', type: 'shield', value: 5, duration_rounds: 2,
        created_round: 1, expire_round: 3,
      });
      mockRedisClient.lRange.mockResolvedValueOnce([stored]);
      mockRedisClient.lRem.mockResolvedValueOnce(1);

      const result = await removeEffect(battleId, charId, 'e-1');
      expect(result).toBe(true);
      expect(mockRedisClient.lRem).toHaveBeenCalledWith(
        `battle:${battleId}:effects:${charId}`,
        0,
        stored
      );
    });

    it('should return false when effect_id not found', async () => {
      const stored = JSON.stringify({
        effect_id: 'e-1', type: 'shield', value: 5, duration_rounds: 2,
        created_round: 1, expire_round: 3,
      });
      mockRedisClient.lRange.mockResolvedValueOnce([stored]);

      const result = await removeEffect(battleId, charId, 'e-999');
      expect(result).toBe(false);
      expect(mockRedisClient.lRem).not.toHaveBeenCalled();
    });

    it('should skip corrupted JSON entries', async () => {
      mockRedisClient.lRange.mockResolvedValueOnce([
        'not-valid-json',
        JSON.stringify({ effect_id: 'e-1', type: 'shield', value: 5, duration_rounds: 2, created_round: 1, expire_round: 3 }),
      ]);
      mockRedisClient.lRem.mockResolvedValueOnce(1);

      const result = await removeEffect(battleId, charId, 'e-1');
      expect(result).toBe(true);
    });
  });

  describe('removeEffectsByType', () => {
    it('should remove all effects of the given type and return count', async () => {
      const shield1 = JSON.stringify({ effect_id: 'e-1', type: 'shield', value: 5, duration_rounds: 2, created_round: 1, expire_round: 3 });
      const shield2 = JSON.stringify({ effect_id: 'e-2', type: 'shield', value: 3, duration_rounds: 2, created_round: 1, expire_round: 3 });
      const taunt = JSON.stringify({ effect_id: 'e-3', type: 'taunt', value: 3, duration_rounds: 1, created_round: 1, expire_round: 2 });
      mockRedisClient.lRange.mockResolvedValueOnce([shield1, shield2, taunt]);
      mockRedisClient.lRem
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1);

      const result = await removeEffectsByType(battleId, charId, 'shield');
      expect(result).toBe(2);
      expect(mockRedisClient.lRem).toHaveBeenCalledTimes(2);
      // taunt 不应被 LREM
      const removedRaw = mockRedisClient.lRem.mock.calls.map(c => c[2]);
      expect(removedRaw).toContain(shield1);
      expect(removedRaw).toContain(shield2);
      expect(removedRaw).not.toContain(taunt);
    });

    it('should return 0 when no matching type', async () => {
      mockRedisClient.lRange.mockResolvedValueOnce([
        JSON.stringify({ effect_id: 'e-1', type: 'shield', value: 5, duration_rounds: 2, created_round: 1, expire_round: 3 }),
      ]);
      const result = await removeEffectsByType(battleId, charId, 'taunt');
      expect(result).toBe(0);
    });
  });

  describe('getActiveEffects', () => {
    it('should return only effects where expire_round > currentRound', async () => {
      const active = { effect_id: 'a', type: 'shield', value: 5, duration_rounds: 2, created_round: 2, expire_round: 4 };
      const expired = { effect_id: 'b', type: 'shield', value: 5, duration_rounds: 1, created_round: 1, expire_round: 2 };
      const onBoundary = { effect_id: 'c', type: 'taunt', value: 3, duration_rounds: 1, created_round: 3, expire_round: 3 };
      mockRedisClient.lRange.mockResolvedValueOnce([
        JSON.stringify(active),
        JSON.stringify(expired),
        JSON.stringify(onBoundary),
      ]);

      const result = await getActiveEffects(battleId, charId, 3);
      // expire_round=3, currentRound=3 → not active (3 > 3 is false)
      // expire_round=4, currentRound=3 → active
      // expire_round=2, currentRound=3 → expired
      expect(result).toHaveLength(1);
      expect(result[0].effect_id).toBe('a');
    });

    it('should silently filter corrupted JSON', async () => {
      mockRedisClient.lRange.mockResolvedValueOnce([
        'not-json',
        JSON.stringify({ effect_id: 'a', type: 'shield', value: 5, duration_rounds: 2, created_round: 2, expire_round: 4 }),
      ]);
      const result = await getActiveEffects(battleId, charId, 3);
      expect(result).toHaveLength(1);
    });
  });

  describe('tickEffects', () => {
    it('should remove expired effects and return them', async () => {
      const active = JSON.stringify({ effect_id: 'a', type: 'shield', value: 5, duration_rounds: 2, created_round: 2, expire_round: 4 });
      const expired1 = JSON.stringify({ effect_id: 'b', type: 'shield', value: 5, duration_rounds: 1, created_round: 1, expire_round: 2 });
      const expired2 = JSON.stringify({ effect_id: 'c', type: 'taunt', value: 3, duration_rounds: 1, created_round: 1, expire_round: 2 });
      mockRedisClient.lRange.mockResolvedValueOnce([active, expired1, expired2]);
      mockRedisClient.lRem
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1);

      const result = await tickEffects(battleId, charId, 3);
      expect(result).toHaveLength(2);
      const ids = result.map(e => e.effect_id);
      expect(ids).toContain('b');
      expect(ids).toContain('c');
    });

    it('should return empty array when nothing expires', async () => {
      const active = JSON.stringify({ effect_id: 'a', type: 'shield', value: 5, duration_rounds: 5, created_round: 1, expire_round: 6 });
      mockRedisClient.lRange.mockResolvedValueOnce([active]);

      const result = await tickEffects(battleId, charId, 3);
      expect(result).toHaveLength(0);
      expect(mockRedisClient.lRem).not.toHaveBeenCalled();
    });

    it('should also remove corrupted JSON', async () => {
      mockRedisClient.lRange.mockResolvedValueOnce(['not-json']);
      mockRedisClient.lRem.mockResolvedValueOnce(1);

      const result = await tickEffects(battleId, charId, 3);
      expect(result).toHaveLength(0);
      expect(mockRedisClient.lRem).toHaveBeenCalled();
    });
  });

  describe('clearEffects', () => {
    it('should DEL the effects key', async () => {
      await clearEffects(battleId, charId);
      expect(mockRedisClient.del).toHaveBeenCalledWith(`battle:${battleId}:effects:${charId}`);
    });
  });

  describe('sumActiveShield', () => {
    it('should sum values of all active shield effects', async () => {
      const shields = [
        { effect_id: 'a', type: 'shield', value: 5, duration_rounds: 2, created_round: 1, expire_round: 4 },
        { effect_id: 'b', type: 'shield', value: 3, duration_rounds: 2, created_round: 1, expire_round: 4 },
        { effect_id: 'c', type: 'taunt', value: 99, duration_rounds: 1, created_round: 1, expire_round: 4 },
      ];
      mockRedisClient.lRange.mockResolvedValueOnce(shields.map(s => JSON.stringify(s)));

      const total = await sumActiveShield(battleId, charId, 3);
      expect(total).toBe(8); // 5 + 3, 忽略 taunt
    });

    it('should return 0 when no active shields', async () => {
      mockRedisClient.lRange.mockResolvedValueOnce([]);
      const total = await sumActiveShield(battleId, charId, 3);
      expect(total).toBe(0);
    });

    it('should treat missing value as 0', async () => {
      mockRedisClient.lRange.mockResolvedValueOnce([
        JSON.stringify({ effect_id: 'a', type: 'shield', duration_rounds: 2, created_round: 1, expire_round: 4 }),
      ]);
      const total = await sumActiveShield(battleId, charId, 3);
      expect(total).toBe(0);
    });
  });
});
