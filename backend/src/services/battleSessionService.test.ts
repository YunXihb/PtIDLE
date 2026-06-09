// Unit tests for battleSessionService

// Define mocks before importing the module
const mockRedisClient = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  hGet: jest.fn(),
  hSet: jest.fn(),
  hDel: jest.fn(),
  hGetAll: jest.fn(),
  hSetNX: jest.fn(),
};

const mockQuery = jest.fn();
const mockQueryOne = jest.fn();
const mockExecute = jest.fn();

jest.mock('../config/redis', () => ({
  redisClient: mockRedisClient,
}));

jest.mock('../config/database', () => ({
  query: mockQuery,
  queryOne: mockQueryOne,
  execute: mockExecute,
}));

import {
  buildSnakeOrder,
  initializeSession,
  getCurrentState,
  activateCurrentUnit,
  completeDrawPhase,
  completeMovePhase,
  completePlayPhase,
  endCurrentStep,
  endCurrentRound,
  finishSession,
  deleteSession,
  BattleSessionState,
} from './battleSessionService';

describe('battleSessionService', () => {
  const battleId = 'battle-test-123';
  const p1Chars = ['char-1a', 'char-1b', 'char-1c'];
  const p2Chars = ['char-2a', 'char-2b', 'char-2c'];

  // In-memory session state used to mock redisClient.get behavior
  let sessionStore: Record<string, string> = {};

  beforeEach(() => {
    jest.resetAllMocks();
    sessionStore = {};

    // Make redisClient.get parse from sessionStore
    mockRedisClient.get.mockImplementation((key: string) =>
      Promise.resolve(sessionStore[key] ?? null)
    );

    // Make redisClient.set store into sessionStore
    mockRedisClient.set.mockImplementation((key: string, value: string) => {
      sessionStore[key] = value;
      return Promise.resolve('OK');
    });

    mockRedisClient.del.mockImplementation((key: string) => {
      delete sessionStore[key];
      return Promise.resolve(1);
    });

    mockExecute.mockResolvedValue(1);
  });

  // ========================================
  // buildSnakeOrder (pure function)
  // ========================================
  describe('buildSnakeOrder', () => {
    it('should generate ABABAB order for 3v3', () => {
      const order = buildSnakeOrder(p1Chars, p2Chars);
      expect(order).toEqual([
        'char-1a', // step 0: p1[0]
        'char-2a', // step 1: p2[0]
        'char-1b', // step 2: p1[1]
        'char-2b', // step 3: p2[1]
        'char-1c', // step 4: p1[2]
        'char-2c', // step 5: p2[2]
      ]);
    });

    it('should generate 2-element order for 1v1', () => {
      const order = buildSnakeOrder(['p1-only'], ['p2-only']);
      expect(order).toEqual(['p1-only', 'p2-only']);
    });

    it('should generate 4-element order for 2v2', () => {
      const order = buildSnakeOrder(['p1-a', 'p1-b'], ['p2-a', 'p2-b']);
      expect(order).toEqual(['p1-a', 'p2-a', 'p1-b', 'p2-b']);
    });

    it('should generate 8-element order for 4v4', () => {
      const p1 = ['a1', 'a2', 'a3', 'a4'];
      const p2 = ['b1', 'b2', 'b3', 'b4'];
      const order = buildSnakeOrder(p1, p2);
      expect(order).toEqual(['a1', 'b1', 'a2', 'b2', 'a3', 'b3', 'a4', 'b4']);
    });

    it('should produce all elements even when sides have different counts', () => {
      // 3v2: p1 has 3, p2 has 2 → still produces 5 elements
      const order = buildSnakeOrder(['a', 'b', 'c'], ['x', 'y']);
      expect(order).toEqual(['a', 'x', 'b', 'y', 'c']);
    });
  });

  // ========================================
  // initializeSession
  // ========================================
  describe('initializeSession', () => {
    it('should create session with snake order and idle phase', async () => {
      const result = await initializeSession(battleId, p1Chars, p2Chars);

      expect(result.success).toBe(true);
      expect(result.state).toBeDefined();
      expect(result.state!.currentRound).toBe(1);
      expect(result.state!.currentStep).toBe(0);
      expect(result.state!.currentPhase).toBe('idle');
      expect(result.state!.currentActorId).toBe('char-1a'); // first in order
      expect(result.state!.activationOrder).toEqual([
        'char-1a', 'char-2a', 'char-1b', 'char-2b', 'char-1c', 'char-2c',
      ]);
      expect(result.state!.player1Chars).toEqual(p1Chars);
      expect(result.state!.player2Chars).toEqual(p2Chars);
    });

    it('should persist state to Redis', async () => {
      await initializeSession(battleId, p1Chars, p2Chars);
      expect(mockRedisClient.set).toHaveBeenCalledWith(
        `battle:${battleId}:session`,
        expect.any(String)
      );
    });

    it('should persist state to PostgreSQL', async () => {
      await initializeSession(battleId, p1Chars, p2Chars);
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE battles'),
        expect.arrayContaining([battleId, 1, 0, 'char-1a', 'idle'])
      );
    });

    it('should reject empty p1 chars', async () => {
      const result = await initializeSession(battleId, [], p2Chars);
      expect(result.success).toBe(false);
      expect(result.error).toContain('at least 1 character');
    });

    it('should reject empty p2 chars', async () => {
      const result = await initializeSession(battleId, p1Chars, []);
      expect(result.success).toBe(false);
      expect(result.error).toContain('at least 1 character');
    });
  });

  // ========================================
  // getCurrentState
  // ========================================
  describe('getCurrentState', () => {
    beforeEach(async () => {
      await initializeSession(battleId, p1Chars, p2Chars);
    });

    it('should return null when session not found', async () => {
      const result = await getCurrentState('nonexistent-battle');
      expect(result).toBeNull();
    });

    it('should return full state view with computed fields', async () => {
      const view = await getCurrentState(battleId);
      expect(view).not.toBeNull();
      expect(view!.totalSteps).toBe(6);
      expect(view!.isLastStepInRound).toBe(false);
      expect(view!.nextActorId).toBeNull(); // idle phase, no next yet
    });

    it('should compute nextActorId in end_step phase', async () => {
      // Advance to end_step of step 0
      await activateCurrentUnit(battleId);
      await completeDrawPhase(battleId);
      await completeMovePhase(battleId);
      await completePlayPhase(battleId);

      const view = await getCurrentState(battleId);
      expect(view!.currentPhase).toBe('end_step');
      expect(view!.nextActorId).toBe('char-2a'); // next in order
      expect(view!.isLastStepInRound).toBe(false);
    });

    it('should indicate last step of round', async () => {
      // Move state to step 5 (last) at end_step
      sessionStore[`battle:${battleId}:session`] = JSON.stringify({
        battleId,
        currentRound: 1,
        currentStep: 5, // last
        currentPhase: 'end_step',
        currentActorId: 'char-2c',
        activationOrder: p1Chars.concat(p2Chars).flatMap((c, i) =>
          i % 2 === 0 ? [p1Chars[i / 2]] : [p2Chars[Math.floor(i / 2)]]
        ),
        player1Chars: p1Chars,
        player2Chars: p2Chars,
        updatedAt: new Date().toISOString(),
      });

      const view = await getCurrentState(battleId);
      expect(view!.isLastStepInRound).toBe(true);
      expect(view!.nextActorId).toBeNull(); // end_step + last → no next
    });
  });

  // ========================================
  // Phase transitions
  // ========================================
  describe('activateCurrentUnit', () => {
    beforeEach(async () => {
      await initializeSession(battleId, p1Chars, p2Chars);
    });

    it('should transition idle → draw', async () => {
      const result = await activateCurrentUnit(battleId);
      expect(result.success).toBe(true);
      expect(result.state!.currentPhase).toBe('draw');
    });

    it('should reject when phase is not idle', async () => {
      await activateCurrentUnit(battleId); // now in draw
      const result = await activateCurrentUnit(battleId);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid phase');
    });

    it('should fail when session not found', async () => {
      const result = await activateCurrentUnit('missing-battle');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Session not found');
    });
  });

  describe('completeDrawPhase', () => {
    beforeEach(async () => {
      await initializeSession(battleId, p1Chars, p2Chars);
      await activateCurrentUnit(battleId);
    });

    it('should transition draw → move', async () => {
      const result = await completeDrawPhase(battleId);
      expect(result.success).toBe(true);
      expect(result.state!.currentPhase).toBe('move');
    });

    it('should reject when phase is not draw', async () => {
      const result = await completeDrawPhase('another-battle');
      expect(result.success).toBe(false);
    });
  });

  describe('completeMovePhase', () => {
    beforeEach(async () => {
      await initializeSession(battleId, p1Chars, p2Chars);
      await activateCurrentUnit(battleId);
      await completeDrawPhase(battleId);
    });

    it('should transition move → play', async () => {
      const result = await completeMovePhase(battleId);
      expect(result.success).toBe(true);
      expect(result.state!.currentPhase).toBe('play');
    });

    it('should reject when phase is not move', async () => {
      // session is currently in 'play' (just transitioned)
      // Roll back to draw to test rejection
      sessionStore[`battle:${battleId}:session`] = JSON.stringify({
        ...JSON.parse(sessionStore[`battle:${battleId}:session`]),
        currentPhase: 'idle',
      });
      const result = await completeMovePhase(battleId);
      expect(result.success).toBe(false);
    });
  });

  describe('completePlayPhase', () => {
    beforeEach(async () => {
      await initializeSession(battleId, p1Chars, p2Chars);
      await activateCurrentUnit(battleId);
      await completeDrawPhase(battleId);
      await completeMovePhase(battleId);
    });

    it('should transition play → end_step', async () => {
      const result = await completePlayPhase(battleId);
      expect(result.success).toBe(true);
      expect(result.state!.currentPhase).toBe('end_step');
    });

    it('should reject when phase is not play', async () => {
      sessionStore[`battle:${battleId}:session`] = JSON.stringify({
        ...JSON.parse(sessionStore[`battle:${battleId}:session`]),
        currentPhase: 'idle',
      });
      const result = await completePlayPhase(battleId);
      expect(result.success).toBe(false);
    });
  });

  // ========================================
  // Step and round advancement
  // ========================================
  describe('endCurrentStep', () => {
    beforeEach(async () => {
      await initializeSession(battleId, p1Chars, p2Chars);
      await activateCurrentUnit(battleId);
      await completeDrawPhase(battleId);
      await completeMovePhase(battleId);
      await completePlayPhase(battleId);
    });

    it('should advance to next actor and reset to idle (not last step)', async () => {
      const result = await endCurrentStep(battleId);
      expect(result.success).toBe(true);
      expect(result.state!.currentStep).toBe(1);
      expect(result.state!.currentActorId).toBe('char-2a');
      expect(result.state!.currentPhase).toBe('idle');
    });

    it('should transition to end_round on last step (3v3 step 5)', async () => {
      // Manually place state at step 5 / end_step
      sessionStore[`battle:${battleId}:session`] = JSON.stringify({
        ...JSON.parse(sessionStore[`battle:${battleId}:session`]),
        currentStep: 5,
        currentActorId: 'char-2c',
        currentPhase: 'end_step',
      });

      const result = await endCurrentStep(battleId);
      expect(result.success).toBe(true);
      expect(result.state!.currentStep).toBe(5); // unchanged
      expect(result.state!.currentPhase).toBe('end_round');
    });

    it('should reject when not in end_step', async () => {
      // Roll back to idle
      sessionStore[`battle:${battleId}:session`] = JSON.stringify({
        ...JSON.parse(sessionStore[`battle:${battleId}:session`]),
        currentPhase: 'idle',
      });
      const result = await endCurrentStep(battleId);
      expect(result.success).toBe(false);
    });
  });

  describe('endCurrentRound', () => {
    beforeEach(async () => {
      // Push to end_round phase
      await initializeSession(battleId, p1Chars, p2Chars);
      sessionStore[`battle:${battleId}:session`] = JSON.stringify({
        ...JSON.parse(sessionStore[`battle:${battleId}:session`]),
        currentPhase: 'end_round',
        currentStep: 5,
      });
    });

    it('should increment round, reset step, set actor to order[0], phase to idle', async () => {
      const result = await endCurrentRound(battleId);
      expect(result.success).toBe(true);
      expect(result.state!.currentRound).toBe(2);
      expect(result.state!.currentStep).toBe(0);
      expect(result.state!.currentActorId).toBe('char-1a');
      expect(result.state!.currentPhase).toBe('idle');
    });

    it('should persist round change to PostgreSQL', async () => {
      await endCurrentRound(battleId);
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE battles'),
        expect.arrayContaining([battleId, 2, 0, 'char-1a', 'idle'])
      );
    });

    it('should reject when not in end_round', async () => {
      sessionStore[`battle:${battleId}:session`] = JSON.stringify({
        ...JSON.parse(sessionStore[`battle:${battleId}:session`]),
        currentPhase: 'idle',
      });
      const result = await endCurrentRound(battleId);
      expect(result.success).toBe(false);
    });
  });

  describe('finishSession', () => {
    beforeEach(async () => {
      await initializeSession(battleId, p1Chars, p2Chars);
    });

    it('should set phase to finished and clear actor', async () => {
      const result = await finishSession(battleId);
      expect(result.success).toBe(true);
      expect(result.state!.currentPhase).toBe('finished');
      expect(result.state!.currentActorId).toBeNull();
    });

    it('should persist to PostgreSQL', async () => {
      await finishSession(battleId);
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE battles'),
        expect.arrayContaining([battleId, 1, 0, null, 'finished'])
      );
    });

    it('should fail when session not found', async () => {
      const result = await finishSession('missing-battle');
      expect(result.success).toBe(false);
    });
  });

  // ========================================
  // Full round trip
  // ========================================
  describe('full round trip (3v3 ABABAB)', () => {
    it('should correctly cycle through 6 actors in one round', async () => {
      await initializeSession(battleId, p1Chars, p2Chars);

      const expected = [
        'char-1a',
        'char-2a',
        'char-1b',
        'char-2b',
        'char-1c',
        'char-2c',
      ];

      for (let i = 0; i < 6; i++) {
        // Each iteration: state should be idle, currentActor should be expected[i]
        let view = await getCurrentState(battleId);
        expect(view!.currentActorId).toBe(expected[i]);
        expect(view!.currentPhase).toBe('idle');

        // Activate → draw → move → play → end_step
        await activateCurrentUnit(battleId);
        await completeDrawPhase(battleId);
        await completeMovePhase(battleId);
        await completePlayPhase(battleId);

        view = await getCurrentState(battleId);
        expect(view!.currentPhase).toBe('end_step');

        // End step → next actor OR end_round
        await endCurrentStep(battleId);
      }

      // After 6 steps, we should be in end_round
      const final = await getCurrentState(battleId);
      expect(final!.currentPhase).toBe('end_round');
      expect(final!.currentRound).toBe(1);

      // End round → round 2, step 0, actor=char-1a
      await endCurrentRound(battleId);
      const afterRound = await getCurrentState(battleId);
      expect(afterRound!.currentRound).toBe(2);
      expect(afterRound!.currentStep).toBe(0);
      expect(afterRound!.currentActorId).toBe('char-1a');
      expect(afterRound!.currentPhase).toBe('idle');
    });
  });

  // ========================================
  // Session cleanup
  // ========================================
  describe('deleteSession', () => {
    it('should remove session from Redis', async () => {
      await initializeSession(battleId, p1Chars, p2Chars);
      await deleteSession(battleId);
      expect(mockRedisClient.del).toHaveBeenCalledWith(
        `battle:${battleId}:session`
      );
      const view = await getCurrentState(battleId);
      expect(view).toBeNull();
    });
  });
});
