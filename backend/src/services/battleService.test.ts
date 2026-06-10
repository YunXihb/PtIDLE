// Unit tests for battleService - attack validation

// Define mocks before importing the module
const mockRedisClient = {
  hGet: jest.fn(),
  hSet: jest.fn(),
  hDel: jest.fn(),
  hGetAll: jest.fn(),
  hSetNX: jest.fn(),
  del: jest.fn(),
  get: jest.fn(),
  set: jest.fn(),
  lRange: jest.fn(),
  rPush: jest.fn(),
  lRem: jest.fn(),
};

const mockQuery = jest.fn();

jest.mock('../config/redis', () => ({
  redisClient: mockRedisClient,
}));

jest.mock('../config/database', () => ({
  query: mockQuery,
}));

// Mock the new professionMechanicService module so warrior triggers don't
// actually hit Redis.
const mockCanUseProfession = jest.fn();
const mockGetTauntRedirect = jest.fn();
const mockOnWarriorAttackCardPlayed = jest.fn();
const mockApplyWarriorTaunt = jest.fn();

jest.mock('./professionMechanicService', () => ({
  canUseProfession: mockCanUseProfession,
  getTauntRedirect: mockGetTauntRedirect,
  onWarriorAttackCardPlayed: mockOnWarriorAttackCardPlayed,
  applyWarriorTaunt: mockApplyWarriorTaunt,
}));

import {
  validateAttack,
  validateAOEAttack,
  validateTauntCard,
  euclideanDistance,
  BoardPosition,
} from './battleService';

describe('battleService - attack validation', () => {
  const mockBattleId = 'battle-123';
  const mockAttackerId = 'char-attacker';
  const mockTargetId = 'char-target';
  const mockCardId = 'card-123';

  const mockAttacker = {
    character_id: 'char-attacker',
    player_id: 'player-1',
    profession: 'warrior',
    name: 'Attacker',
    health: 20,
    max_health: 20,
    movement: 2,
    energy: 3,
    max_energy: 3,
    position_x: 2,
    position_y: 2,
    is_alive: true,
  };

  const mockTarget = {
    character_id: 'char-target',
    player_id: 'player-2',
    profession: 'mage',
    name: 'Target',
    health: 15,
    max_health: 15,
    movement: 2,
    energy: 3,
    max_energy: 3,
    position_x: 3,
    position_y: 2,
    is_alive: true,
  };

  const mockCard = {
    id: 'card-123',
    player_id: 'player-1',
    cost: 1,
    effect: { damage: 2 },
    type: 'attack',
    profession: 'common',
  };

  beforeEach(() => {
    jest.resetAllMocks();
    // Set default returns for hGet to return undefined (will use mockResolvedValueOnce for specific tests)
    mockRedisClient.hGet.mockImplementation(() => Promise.resolve(undefined));
    mockQuery.mockImplementation(() => Promise.resolve(undefined));
    // Default: profession always allowed
    mockCanUseProfession.mockReturnValue(true);
    // Default: no taunt redirect
    mockGetTauntRedirect.mockResolvedValue({ mustRedirectTo: null, sourceId: null });
    // Default: warrior attack returns no shield gained
    mockOnWarriorAttackCardPlayed.mockResolvedValue({
      attackCounter: 0,
      shieldGained: 0,
      totalShield: 0,
    });
    // Default: applyWarriorTaunt succeeds
    mockApplyWarriorTaunt.mockResolvedValue({ success: true });
  });

  describe('validateAttack', () => {
    it('should reject when attacker not found', async () => {
      mockRedisClient.hGet.mockResolvedValueOnce(null);
      mockQuery.mockResolvedValueOnce([]);

      const result = await validateAttack(
        mockBattleId,
        'nonexistent',
        mockCardId,
        mockTargetId
      );

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Attacker not found');
    });

    it('should reject when attacker is not alive', async () => {
      mockRedisClient.hGet.mockResolvedValueOnce(
        JSON.stringify({ ...mockAttacker, is_alive: false })
      );

      const result = await validateAttack(
        mockBattleId,
        mockAttackerId,
        mockCardId,
        mockTargetId
      );

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Attacker is not alive');
    });

    it('should reject when card not found', async () => {
      mockRedisClient.hGet.mockResolvedValueOnce(JSON.stringify(mockAttacker));
      mockQuery.mockResolvedValueOnce([]);

      const result = await validateAttack(
        mockBattleId,
        mockAttackerId,
        'nonexistent',
        mockTargetId
      );

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Card not found');
    });

    it('should reject when card does not belong to attacker', async () => {
      mockRedisClient.hGet.mockResolvedValueOnce(JSON.stringify(mockAttacker));
      mockQuery.mockResolvedValueOnce([
        { ...mockCard, player_id: 'player-2' },
      ]);

      const result = await validateAttack(
        mockBattleId,
        mockAttackerId,
        mockCardId,
        mockTargetId
      );

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Card does not belong to attacker');
    });

    it('should reject when not enough energy', async () => {
      mockRedisClient.hGet.mockResolvedValueOnce(
        JSON.stringify({ ...mockAttacker, energy: 0 })
      );
      mockQuery.mockResolvedValueOnce([mockCard]);

      const result = await validateAttack(
        mockBattleId,
        mockAttackerId,
        mockCardId,
        mockTargetId
      );

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Not enough energy (need 1, have 0)');
      expect(result.energyCost).toBe(1);
    });

    it('should reject when target not found', async () => {
      // getCharacterPiece(attacker) -> hGet; getPlayerCard -> query
      // getCharacterPiece(target='nonexistent') -> hGet miss -> query fallback miss
      mockRedisClient.hGet.mockResolvedValueOnce(JSON.stringify(mockAttacker));
      mockQuery
        .mockResolvedValueOnce([mockCard])   // getPlayerCard: card found
        .mockResolvedValueOnce([]);          // getCharacterPiece fallback: target not in DB

      const result = await validateAttack(
        mockBattleId,
        mockAttackerId,
        mockCardId,
        'nonexistent'
      );

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Target not found');
    });

    it('should reject when target is not alive', async () => {
      mockRedisClient.hGet
        .mockResolvedValueOnce(JSON.stringify(mockAttacker))
        .mockResolvedValueOnce(JSON.stringify({ ...mockTarget, is_alive: false }));
      mockQuery.mockResolvedValueOnce([mockCard]);

      const result = await validateAttack(
        mockBattleId,
        mockAttackerId,
        mockCardId,
        mockTargetId
      );

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Target is not alive');
    });

    it('should reject when target is friendly', async () => {
      mockRedisClient.hGet
        .mockResolvedValueOnce(JSON.stringify(mockAttacker))
        .mockResolvedValueOnce(JSON.stringify({ ...mockTarget, player_id: 'player-1' }));
      mockQuery.mockResolvedValueOnce([mockCard]);

      const result = await validateAttack(
        mockBattleId,
        mockAttackerId,
        mockCardId,
        mockTargetId
      );

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Cannot attack friendly target');
    });

    it('should reject when target is out of melee range', async () => {
      // Attacker at (0,0), target at (5,5): euclideanDistance ~7.07 > 1.5
      const attackerAt00 = { ...mockAttacker, position_x: 0, position_y: 0 };
      const targetAt55 = { ...mockTarget, position_x: 5, position_y: 5 };
      const positions = { '0,0': mockAttackerId, '5,5': mockTargetId };

      mockRedisClient.hGet
        .mockResolvedValueOnce(JSON.stringify(attackerAt00))
        .mockResolvedValueOnce(JSON.stringify(targetAt55));
      mockQuery.mockResolvedValueOnce([mockCard]);
      mockRedisClient.hGetAll
        .mockResolvedValueOnce(positions)
        .mockResolvedValueOnce(positions);

      const result = await validateAttack(
        mockBattleId,
        mockAttackerId,
        mockCardId,
        mockTargetId
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Target out of range');
    });

    it('should accept valid melee attack', async () => {
      // Attacker at (2,2), target at (3,2): euclideanDistance 1.0 within melee range
      const positions = { '2,2': mockAttackerId, '3,2': mockTargetId };

      mockRedisClient.hGet
        .mockResolvedValueOnce(JSON.stringify(mockAttacker))
        .mockResolvedValueOnce(JSON.stringify(mockTarget));
      mockQuery.mockResolvedValueOnce([mockCard]);
      mockRedisClient.hGetAll
        .mockResolvedValueOnce(positions)
        .mockResolvedValueOnce(positions);

      const result = await validateAttack(
        mockBattleId,
        mockAttackerId,
        mockCardId,
        mockTargetId
      );

      expect(result.valid).toBe(true);
      expect(result.damage).toBe(2);
      expect(result.targets).toEqual([mockTargetId]);
      expect(result.energyCost).toBe(1);
    });

    it('should accept valid ranged attack', async () => {
      // Attacker at (0,0), target at (2,1): euclideanDistance ~2.24 within range 3
      const rangedCard = { ...mockCard, effect: { damage: 3, range: 3 } };
      const attackerAt00 = { ...mockAttacker, position_x: 0, position_y: 0 };
      const targetAt21 = { ...mockTarget, position_x: 2, position_y: 1 };
      const positions = { '0,0': mockAttackerId, '2,1': mockTargetId };

      mockRedisClient.hGet
        .mockResolvedValueOnce(JSON.stringify(attackerAt00))
        .mockResolvedValueOnce(JSON.stringify(targetAt21));
      mockQuery.mockResolvedValueOnce([rangedCard]);
      mockRedisClient.hGetAll
        .mockResolvedValueOnce(positions)
        .mockResolvedValueOnce(positions);

      const result = await validateAttack(
        mockBattleId,
        mockAttackerId,
        mockCardId,
        mockTargetId
      );

      expect(result.valid).toBe(true);
      expect(result.damage).toBe(3);
      expect(result.targets).toEqual([mockTargetId]);
    });

    it('should reject ranged attack when target out of range', async () => {
      // Attacker at (0,0), target at (4,4): euclideanDistance ~5.66 > range 2
      const rangedCard = { ...mockCard, effect: { damage: 3, range: 2 } };
      const attackerAt00 = { ...mockAttacker, position_x: 0, position_y: 0 };
      const targetAt44 = { ...mockTarget, position_x: 4, position_y: 4 };
      const positions = { '0,0': mockAttackerId, '4,4': mockTargetId };

      mockRedisClient.hGet
        .mockResolvedValueOnce(JSON.stringify(attackerAt00))
        .mockResolvedValueOnce(JSON.stringify(targetAt44));
      mockQuery.mockResolvedValueOnce([rangedCard]);
      mockRedisClient.hGetAll
        .mockResolvedValueOnce(positions)
        .mockResolvedValueOnce(positions);

      const result = await validateAttack(
        mockBattleId,
        mockAttackerId,
        mockCardId,
        mockTargetId
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Target out of range');
    });
  });

  describe('validateAOEAttack', () => {
    it('should reject when card is not AOE', async () => {
      mockRedisClient.hGet.mockResolvedValueOnce(JSON.stringify(mockAttacker));
      mockQuery.mockResolvedValueOnce([mockCard]);

      const result = await validateAOEAttack(
        mockBattleId,
        mockAttackerId,
        mockCardId
      );

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Card is not an AOE attack');
    });

    it('should reject when no targets in range', async () => {
      const aoeCard = { ...mockCard, effect: { damage: 3, aoe: true, range: 2 } };
      const attackerAt00 = { ...mockAttacker, position_x: 0, position_y: 0 };
      // Only attacker on the board; getTargetsInRange excludes the attacker itself,
      // so the result is an empty targets list.
      const positions = { '0,0': mockAttackerId };

      mockRedisClient.hGet.mockResolvedValueOnce(JSON.stringify(attackerAt00));
      mockQuery.mockResolvedValueOnce([aoeCard]);
      mockRedisClient.hGetAll
        .mockResolvedValueOnce(positions)
        .mockResolvedValueOnce(positions);

      const result = await validateAOEAttack(
        mockBattleId,
        mockAttackerId,
        mockCardId
      );

      expect(result.valid).toBe(false);
      expect(result.error).toBe('No targets in range');
    });

    it('should accept valid AOE attack and return all enemy targets in range', async () => {
      // Attacker at (4, 4); AOE range 2
      const aoeCard = { ...mockCard, effect: { damage: 3, aoe: true, range: 2 }, type: 'attack', profession: 'common' };
      const attackerAt44 = { ...mockAttacker, position_x: 4, position_y: 4 };

      // Board state (attacker at (4,4) is also included so getCharacterPosition
      // can find it; getTargetsInRange will skip it via the player_id check):
      //   attacker @ (4, 4) -> distance 0.00  EXCLUDED (self)
      //   enemy-1  @ (5, 4) -> distance 1.00  IN RANGE
      //   enemy-2  @ (4, 5) -> distance 1.00  IN RANGE
      //   friend-1 @ (3, 4) -> distance 1.00  EXCLUDED (friendly)
      //   enemy-3  @ (6, 6) -> distance 2.83  EXCLUDED (out of range)
      //   dead-1   @ (5, 5) -> distance 1.41  EXCLUDED (not alive)
      const positions = {
        '4,4': mockAttackerId,
        '5,4': 'enemy-1',
        '4,5': 'enemy-2',
        '3,4': 'friend-1',
        '6,6': 'enemy-3',
        '5,5': 'dead-1',
      };

      const enemyPiece = {
        character_id: 'x',
        player_id: 'player-2',
        profession: 'mage',
        name: 'Enemy',
        health: 12,
        max_health: 12,
        movement: 2,
        energy: 3,
        max_energy: 3,
        position_x: 0,
        position_y: 0,
        is_alive: true,
      };
      const friendPiece = { ...enemyPiece, player_id: 'player-1', name: 'Friend' };
      const deadPiece = { ...enemyPiece, character_id: 'dead-1', is_alive: false };

      // Mock call order (see battleService.ts:778-845):
      //   1) hGet     -> attacker piece
      //   2) query    -> AOE card
      //   3) hGetAll  -> board positions (for getCharacterPosition(attacker))
      //   4) hGetAll  -> board positions (for getTargetsInRange)
      //   5) hGet x 5 -> attacker self, enemy-1, enemy-2, friend-1, dead-1
      //                  (enemy-3 is skipped by the distance check before hGet)
      mockRedisClient.hGet.mockResolvedValueOnce(JSON.stringify(attackerAt44));
      mockQuery.mockResolvedValueOnce([aoeCard]);
      mockRedisClient.hGetAll
        .mockResolvedValueOnce(positions)
        .mockResolvedValueOnce(positions);
      mockRedisClient.hGet
        .mockResolvedValueOnce(JSON.stringify(attackerAt44))
        .mockResolvedValueOnce(JSON.stringify({ ...enemyPiece, character_id: 'enemy-1' }))
        .mockResolvedValueOnce(JSON.stringify({ ...enemyPiece, character_id: 'enemy-2' }))
        .mockResolvedValueOnce(JSON.stringify(friendPiece))
        .mockResolvedValueOnce(JSON.stringify(deadPiece));

      const result = await validateAOEAttack(
        mockBattleId,
        mockAttackerId,
        mockCardId
      );

      expect(result.valid).toBe(true);
      expect(result.damage).toBe(3);
      expect(result.energyCost).toBe(1);
      expect(result.targets).toEqual(['enemy-1', 'enemy-2']);
    });
  });

  describe('euclideanDistance', () => {
    it('should calculate correct distance for adjacent cells', () => {
      const p1: BoardPosition = { x: 0, y: 0 };
      const p2: BoardPosition = { x: 1, y: 0 };
      expect(euclideanDistance(p1, p2)).toBe(1);
    });

    it('should calculate correct distance for diagonal cells', () => {
      const p1: BoardPosition = { x: 0, y: 0 };
      const p2: BoardPosition = { x: 1, y: 1 };
      expect(euclideanDistance(p1, p2)).toBeCloseTo(Math.sqrt(2));
    });

    it('should calculate correct distance for far cells', () => {
      const p1: BoardPosition = { x: 0, y: 0 };
      const p2: BoardPosition = { x: 3, y: 4 };
      expect(euclideanDistance(p1, p2)).toBe(5);
    });

    it('should return 0 for same position', () => {
      const p: BoardPosition = { x: 5, y: 5 };
      expect(euclideanDistance(p, p)).toBe(0);
    });
  });

  // ========================================
  // T039: 职业-卡牌匹配校验 (validateAttack)
  // ========================================
  describe('validateAttack - profession check (T039)', () => {
    const positions = { '2,2': mockAttackerId, '3,2': mockTargetId };

    it('should reject when char profession does not match card profession', async () => {
      mockCanUseProfession.mockReturnValue(false);
      mockRedisClient.hGet
        .mockResolvedValueOnce(JSON.stringify(mockAttacker))
        .mockResolvedValueOnce(JSON.stringify(mockTarget));
      mockQuery.mockResolvedValueOnce([{ ...mockCard, profession: 'mage' }]);

      const result = await validateAttack(
        mockBattleId, mockAttackerId, mockCardId, mockTargetId, 1
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain('warrior');
      expect(result.error).toContain('mage');
    });

    it('should accept when profession matches', async () => {
      mockCanUseProfession.mockReturnValue(true);
      mockRedisClient.hGet
        .mockResolvedValueOnce(JSON.stringify(mockAttacker))
        .mockResolvedValueOnce(JSON.stringify(mockTarget));
      mockQuery.mockResolvedValueOnce([{ ...mockCard, profession: 'warrior' }]);
      mockRedisClient.hGetAll
        .mockResolvedValueOnce(positions)
        .mockResolvedValueOnce(positions);

      const result = await validateAttack(
        mockBattleId, mockAttackerId, mockCardId, mockTargetId, 1
      );
      expect(result.valid).toBe(true);
    });

    it('should accept common card for any profession', async () => {
      mockCanUseProfession.mockReturnValue(true);  // common card matches
      mockRedisClient.hGet
        .mockResolvedValueOnce(JSON.stringify(mockAttacker))
        .mockResolvedValueOnce(JSON.stringify(mockTarget));
      mockQuery.mockResolvedValueOnce([{ ...mockCard, profession: 'common' }]);
      mockRedisClient.hGetAll
        .mockResolvedValueOnce(positions)
        .mockResolvedValueOnce(positions);

      const result = await validateAttack(
        mockBattleId, mockAttackerId, mockCardId, mockTargetId, 1
      );
      expect(result.valid).toBe(true);
    });
  });

  // ========================================
  // T039: 嘲讽读取 (validateAttack)
  // ========================================
  describe('validateAttack - taunt redirect (T039)', () => {
    it('should reject when target is taunted by another warrior', async () => {
      mockGetTauntRedirect.mockResolvedValue({
        mustRedirectTo: 'warrior-x',
        sourceId: 'warrior-x',
      });
      mockRedisClient.hGet
        .mockResolvedValueOnce(JSON.stringify(mockAttacker))
        .mockResolvedValueOnce(JSON.stringify(mockTarget));
      mockQuery.mockResolvedValueOnce([mockCard]);

      const result = await validateAttack(
        mockBattleId, mockAttackerId, mockCardId, mockTargetId, 1
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain('taunted');
      expect(result.forcedTarget).toBe('warrior-x');
    });

    it('should not redirect when no taunt present', async () => {
      mockGetTauntRedirect.mockResolvedValue({ mustRedirectTo: null, sourceId: null });
      const positions = { '2,2': mockAttackerId, '3,2': mockTargetId };
      mockRedisClient.hGet
        .mockResolvedValueOnce(JSON.stringify(mockAttacker))
        .mockResolvedValueOnce(JSON.stringify(mockTarget));
      mockQuery.mockResolvedValueOnce([mockCard]);
      mockRedisClient.hGetAll
        .mockResolvedValueOnce(positions)
        .mockResolvedValueOnce(positions);

      const result = await validateAttack(
        mockBattleId, mockAttackerId, mockCardId, mockTargetId, 1
      );
      expect(result.valid).toBe(true);
      expect(result.forcedTarget).toBeUndefined();
    });
  });

  // ========================================
  // T039: warrior 攻击累计护盾触发 (validateAttack)
  // ========================================
  describe('validateAttack - warrior attack shield trigger (T039)', () => {
    it('should call onWarriorAttackCardPlayed when warrior plays attack card', async () => {
      mockOnWarriorAttackCardPlayed.mockResolvedValue({
        attackCounter: 1,
        shieldGained: 0,
        totalShield: 0,
      });
      const positions = { '2,2': mockAttackerId, '3,2': mockTargetId };
      mockRedisClient.hGet
        .mockResolvedValueOnce(JSON.stringify(mockAttacker))
        .mockResolvedValueOnce(JSON.stringify(mockTarget));
      mockQuery.mockResolvedValueOnce([{ ...mockCard, type: 'attack' }]);
      mockRedisClient.hGetAll
        .mockResolvedValueOnce(positions)
        .mockResolvedValueOnce(positions);

      await validateAttack(mockBattleId, mockAttackerId, mockCardId, mockTargetId, 1);
      expect(mockOnWarriorAttackCardPlayed).toHaveBeenCalledWith(
        mockBattleId, mockAttackerId, mockCard.cost, 1
      );
    });

    it('should include shieldGained in result when triggered', async () => {
      mockOnWarriorAttackCardPlayed.mockResolvedValue({
        attackCounter: 0,
        shieldGained: 5,
        totalShield: 5,
      });
      const positions = { '2,2': mockAttackerId, '3,2': mockTargetId };
      mockRedisClient.hGet
        .mockResolvedValueOnce(JSON.stringify(mockAttacker))
        .mockResolvedValueOnce(JSON.stringify(mockTarget));
      mockQuery.mockResolvedValueOnce([{ ...mockCard, type: 'attack' }]);
      mockRedisClient.hGetAll
        .mockResolvedValueOnce(positions)
        .mockResolvedValueOnce(positions);

      const result = await validateAttack(mockBattleId, mockAttackerId, mockCardId, mockTargetId, 1);
      expect(result.shieldGained).toBe(5);
    });
  });

  // ========================================
  // T039: validateAOEAttack 职业校验
  // ========================================
  describe('validateAOEAttack - profession check (T039)', () => {
    it('should reject when profession does not match', async () => {
      mockCanUseProfession.mockReturnValue(false);
      mockRedisClient.hGet.mockResolvedValueOnce(JSON.stringify(mockAttacker));
      mockQuery.mockResolvedValueOnce([mockCard]);

      const result = await validateAOEAttack(mockBattleId, mockAttackerId, mockCardId);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('warrior');
    });

    it('should accept when profession matches', async () => {
      mockCanUseProfession.mockReturnValue(true);
      const aoeCard = { ...mockCard, effect: { damage: 3, aoe: true, range: 2 }, type: 'attack' };
      const attackerAt44 = { ...mockAttacker, position_x: 4, position_y: 4 };
      const positions = {
        '4,4': mockAttackerId,
        '5,4': 'enemy-1',
      };
      mockRedisClient.hGet.mockResolvedValueOnce(JSON.stringify(attackerAt44));
      mockQuery.mockResolvedValueOnce([aoeCard]);
      mockRedisClient.hGetAll
        .mockResolvedValueOnce(positions)
        .mockResolvedValueOnce(positions);
      mockRedisClient.hGet
        .mockResolvedValueOnce(JSON.stringify(attackerAt44))
        .mockResolvedValueOnce(JSON.stringify({
          character_id: 'enemy-1',
          player_id: 'player-2',
          profession: 'mage',
          name: 'Enemy',
          health: 12, max_health: 12,
          movement: 2, energy: 3, max_energy: 3,
          position_x: 5, position_y: 4, is_alive: true,
        }));

      const result = await validateAOEAttack(mockBattleId, mockAttackerId, mockCardId);
      expect(result.valid).toBe(true);
    });
  });

  // ========================================
  // T039: validateTauntCard
  // ========================================
  describe('validateTauntCard (T039)', () => {
    const positions = { '2,2': mockAttackerId, '3,2': mockTargetId };

    it('should fail when warrior not found', async () => {
      mockRedisClient.hGet.mockResolvedValueOnce(null);
      mockQuery.mockResolvedValueOnce([]);

      const result = await validateTauntCard(mockBattleId, 'nonexistent', 'card-1', mockTargetId, 1);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should fail when card is not a taunt card', async () => {
      mockRedisClient.hGet.mockResolvedValueOnce(JSON.stringify(mockAttacker));
      mockQuery.mockResolvedValueOnce([{ ...mockCard, effect: { damage: 2 }, profession: 'common' }]);

      const result = await validateTauntCard(mockBattleId, mockAttackerId, mockCardId, mockTargetId, 1);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not a taunt card');
    });

    it('should fail when target is friendly', async () => {
      mockRedisClient.hGet.mockResolvedValueOnce(JSON.stringify(mockAttacker));
      mockQuery.mockResolvedValueOnce([{ ...mockCard, effect: { type: 'taunt', range: 3 }, profession: 'warrior' }]);
      // 第二步：能量足够，第三步：目标存在但 friendly
      mockRedisClient.hGet.mockResolvedValueOnce(JSON.stringify({ ...mockTarget, player_id: 'player-1' }));

      const result = await validateTauntCard(mockBattleId, mockAttackerId, mockCardId, mockTargetId, 1);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('friendly');
    });

    it('should succeed and call applyWarriorTaunt on valid input', async () => {
      mockApplyWarriorTaunt.mockResolvedValue({ success: true });
      // hGet #1: warrior piece
      // query #1: card
      // hGet #2: target piece
      // hGetAll #1: positions (for getCharacterPosition warrior)
      // hGetAll #2: positions (for getCharacterPosition target)
      mockRedisClient.hGet
        .mockResolvedValueOnce(JSON.stringify(mockAttacker))
        .mockResolvedValueOnce(JSON.stringify(mockTarget));
      mockQuery.mockResolvedValueOnce([{
        ...mockCard,
        effect: { type: 'taunt', range: 3, duration: 1 },
        profession: 'warrior',
      }]);
      mockRedisClient.hGetAll
        .mockResolvedValueOnce(positions)
        .mockResolvedValueOnce(positions);

      const result = await validateTauntCard(mockBattleId, mockAttackerId, mockCardId, mockTargetId, 1);
      expect(result.valid).toBe(true);
      expect(mockApplyWarriorTaunt).toHaveBeenCalled();
    });

    it('should fail when applyWarriorTaunt fails (e.g. out of range)', async () => {
      mockApplyWarriorTaunt.mockResolvedValue({ success: false, error: 'Taunt target out of range' });
      mockRedisClient.hGet
        .mockResolvedValueOnce(JSON.stringify(mockAttacker))
        .mockResolvedValueOnce(JSON.stringify(mockTarget));
      mockQuery.mockResolvedValueOnce([{
        ...mockCard,
        effect: { type: 'taunt', range: 3 },
        profession: 'warrior',
      }]);
      mockRedisClient.hGetAll
        .mockResolvedValueOnce(positions)
        .mockResolvedValueOnce(positions);

      const result = await validateTauntCard(mockBattleId, mockAttackerId, mockCardId, mockTargetId, 1);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('out of range');
    });
  });
});
