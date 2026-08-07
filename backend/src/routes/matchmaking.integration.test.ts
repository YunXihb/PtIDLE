// Integration tests for matchmaking API (T042 + T043 + T044)

// Mocks must be declared BEFORE imports (jest hoists jest.mock to top of file)
// Mock the redis module (singleton client never gets .connect() in test process)
jest.mock('../config/redis', () => ({
  redisClient: {
    zAdd: jest.fn(),
    zRange: jest.fn(),
    zCard: jest.fn(),
    zRem: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    eval: jest.fn(),
  },
  connectRedis: jest.fn(),
  disconnectRedis: jest.fn(),
}));

// Mock the database module
const mockQuery = jest.fn();
const mockQueryOne = jest.fn();
jest.mock('../config/database', () => ({
  query: mockQuery,
  queryOne: mockQueryOne,
}));

// Mock playerService
const mockGetPlayerIdByUserId = jest.fn();
jest.mock('../services/playerService', () => ({
  getPlayerIdByUserId: mockGetPlayerIdByUserId,
}));

// Mock characterService
const mockCountAliveCharacters = jest.fn();
jest.mock('../services/characterService', () => ({
  countAliveCharacters: mockCountAliveCharacters,
}));

// Mock battleService
const mockCreatePendingBattle = jest.fn();
const mockGetPendingBattleByPlayerId = jest.fn();
jest.mock('../services/battleService', () => ({
  createPendingBattle: mockCreatePendingBattle,
  getPendingBattleByPlayerId: mockGetPendingBattleByPlayerId,
}));

// Mock auth middleware to inject a fake user
jest.mock('../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-123' };
    next();
  },
  AuthRequest: {} as any,
}));

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _refs = { mockQuery, mockQueryOne, mockGetPlayerIdByUserId, mockCountAliveCharacters, mockCreatePendingBattle, mockGetPendingBattleByPlayerId };

// Imports must come AFTER all jest.mock calls
import request from 'supertest';
import express from 'express';
import matchmakingRoutes from './matchmaking';
import { redisClient } from '../config/redis';
import { errorHandler } from '../middleware/errorHandler';

const mockedRedis = redisClient as unknown as {
  set: jest.Mock;
  zAdd: jest.Mock;
  zRange: jest.Mock;
  zCard: jest.Mock;
  zRem: jest.Mock;
  del: jest.Mock;
  eval: jest.Mock;
};

// Create test app
const app = express();
app.use(express.json());
app.use('/api/match', matchmakingRoutes);
app.use(errorHandler);

describe('Matchmaking API Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ========================================
  // T042: POST /api/match/queue
  // ========================================

  describe('POST /api/match/queue (T042 + T044)', () => {
    it('队列空：入队 → 撮合无候选 → 201 + matched:false + entry', async () => {
      // 1. enqueueMatchmaking: SETNX 成功 + zAdd
      mockedRedis.set.mockResolvedValueOnce('OK');
      mockedRedis.zAdd.mockResolvedValueOnce(1);
      // 2. tryMatch: SETNX global 成功
      mockedRedis.set.mockResolvedValueOnce('OK');
      // 3. LUA_PICK_CANDIDATE 返 NO_CANDIDATE
      mockedRedis.eval.mockResolvedValueOnce([0, 'NO_CANDIDATE']);
      // 4. safeReleaseGlobalLock
      mockedRedis.eval.mockResolvedValueOnce([1]);

      const response = await request(app).post('/api/match/queue').send({});

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.matched).toBe(false);
      expect(response.body.data.userId).toBe('user-123');
      expect(typeof response.body.data.enqueuedAt).toBe('number');
    });

    it('队列 1 人、双方 alive OK：入队 → 撮合成功 → 201 + matched:true + battleId', async () => {
      // 1. enqueueMatchmaking
      mockedRedis.set.mockResolvedValueOnce('OK');
      mockedRedis.zAdd.mockResolvedValueOnce(1);
      // 2. tryMatch: SETNX global
      mockedRedis.set.mockResolvedValueOnce('OK');
      // 3. LUA_PICK_CANDIDATE 返 picked
      const pickedEntryStr = JSON.stringify({ userId: 'user-picked', enqueuedAt: 1000 });
      mockedRedis.eval.mockResolvedValueOnce([1, 'user-picked', pickedEntryStr]);
      // 4. findAndGetSelfEntryStr
      const selfEntryStr = JSON.stringify({ userId: 'user-123', enqueuedAt: 2000 });
      mockedRedis.zRange.mockResolvedValueOnce([selfEntryStr]);
      // 5. getPlayerIdByUserId ×2
      mockGetPlayerIdByUserId.mockResolvedValueOnce('player-123');
      mockGetPlayerIdByUserId.mockResolvedValueOnce('player-picked');
      // 6. countAliveCharacters ×2
      mockCountAliveCharacters.mockResolvedValueOnce(3);
      mockCountAliveCharacters.mockResolvedValueOnce(3);
      // 7. 防 dup 预查询
      mockQueryOne.mockResolvedValueOnce(null);
      // 8. createPendingBattle
      mockCreatePendingBattle.mockResolvedValueOnce('battle-abc');
      // 9. LUA_RELEASE_CLEANUP
      mockedRedis.eval.mockResolvedValueOnce([1]);

      const response = await request(app).post('/api/match/queue').send({});

      expect(response.status).toBe(201);
      expect(response.body.matched).toBe(true);
      expect(response.body.data.battleId).toBe('battle-abc');
      expect(response.body.data.opponentUserId).toBe('user-picked');
      expect(response.body.data.userId).toBe('user-123');
    });

    it('队列 1 人、self alive<3：入队 → 撮合失败 → 400 Not enough alive characters', async () => {
      // 1. enqueueMatchmaking
      mockedRedis.set.mockResolvedValueOnce('OK');
      mockedRedis.zAdd.mockResolvedValueOnce(1);
      // 2. tryMatch: SETNX global
      mockedRedis.set.mockResolvedValueOnce('OK');
      // 3. LUA_PICK_CANDIDATE 返 picked
      const pickedEntryStr = JSON.stringify({ userId: 'user-picked', enqueuedAt: 1000 });
      mockedRedis.eval.mockResolvedValueOnce([1, 'user-picked', pickedEntryStr]);
      // 4. findAndGetSelfEntryStr
      const selfEntryStr = JSON.stringify({ userId: 'user-123', enqueuedAt: 2000 });
      mockedRedis.zRange.mockResolvedValueOnce([selfEntryStr]);
      // 5. getPlayerIdByUserId ×2
      mockGetPlayerIdByUserId.mockResolvedValueOnce('player-123');
      mockGetPlayerIdByUserId.mockResolvedValueOnce('player-picked');
      // 6. countAliveCharacters(self) 返 2
      mockCountAliveCharacters.mockResolvedValueOnce(2);
      // 7. cleanupFailedCandidate
      mockedRedis.zRem.mockResolvedValueOnce(1);
      mockedRedis.del.mockResolvedValueOnce(1);
      mockedRedis.del.mockResolvedValueOnce(1);
      mockedRedis.eval.mockResolvedValueOnce([1]);

      const response = await request(app).post('/api/match/queue').send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Not enough alive characters (need ≥3)');
    });

    it('队列 1 人、picked alive<3：入队 → 撮合失败（opponent） → 201 + matched:false + entry', async () => {
      // 1. enqueueMatchmaking
      mockedRedis.set.mockResolvedValueOnce('OK');
      mockedRedis.zAdd.mockResolvedValueOnce(1);
      // 2. tryMatch: SETNX global
      mockedRedis.set.mockResolvedValueOnce('OK');
      // 3. LUA_PICK_CANDIDATE 返 picked
      const pickedEntryStr = JSON.stringify({ userId: 'user-picked', enqueuedAt: 1000 });
      mockedRedis.eval.mockResolvedValueOnce([1, 'user-picked', pickedEntryStr]);
      // 4. findAndGetSelfEntryStr
      const selfEntryStr = JSON.stringify({ userId: 'user-123', enqueuedAt: 2000 });
      mockedRedis.zRange.mockResolvedValueOnce([selfEntryStr]);
      // 5. getPlayerIdByUserId ×2
      mockGetPlayerIdByUserId.mockResolvedValueOnce('player-123');
      mockGetPlayerIdByUserId.mockResolvedValueOnce('player-picked');
      // 6. countAliveCharacters ×2: self=3, picked=2
      mockCountAliveCharacters.mockResolvedValueOnce(3);
      mockCountAliveCharacters.mockResolvedValueOnce(2);
      // 7. cleanupFailedCandidate
      mockedRedis.zRem.mockResolvedValueOnce(1);
      mockedRedis.del.mockResolvedValueOnce(1);
      mockedRedis.del.mockResolvedValueOnce(1);
      mockedRedis.eval.mockResolvedValueOnce([1]);

      const response = await request(app).post('/api/match/queue').send({});

      // self 仍在队列中（picked 已被清理）→ 201
      expect(response.status).toBe(201);
      expect(response.body.matched).toBe(false);
      expect(response.body.data.userId).toBe('user-123');
    });

    it('重复入队：SETNX 返 null → 400', async () => {
      mockedRedis.set.mockResolvedValueOnce(null);

      const response = await request(app).post('/api/match/queue').send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Already in matchmaking queue');
      expect(mockedRedis.zAdd).not.toHaveBeenCalled();
    });
  });

  // ========================================
  // T043 + T044: GET /api/match/queue
  // ========================================

  describe('GET /api/match/queue (T043 + T044)', () => {
    it('在队列：返 200 + data.inQueue=true', async () => {
      const enqueuedAt = Date.now() - 8000;
      mockedRedis.zRange.mockResolvedValueOnce([
        JSON.stringify({ userId: 'user-123', enqueuedAt }),
      ]);

      const response = await request(app).get('/api/match/queue');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.inQueue).toBe(true);
      expect(response.body.data.userId).toBe('user-123');
      expect(response.body.data.enqueuedAt).toBe(enqueuedAt);
      expect(typeof response.body.data.waitingSeconds).toBe('number');
    });

    it('不在队列但有 pending battle（LOSER 视角）：返 200 + data.matched=true + battleId', async () => {
      // 1. getMatchmakingStatus: zRange 空
      mockedRedis.zRange.mockResolvedValueOnce([]);
      // 2. getUserPendingBattle: getPlayerIdByUserId
      mockGetPlayerIdByUserId.mockResolvedValueOnce('player-123');
      // 3. getPendingBattleByPlayerId
      const matchedAt = new Date();
      mockGetPendingBattleByPlayerId.mockResolvedValueOnce({
        id: 'battle-loser',
        player1_id: 'player-123',
        player2_id: 'player-other',
        status: 'pending',
        matched_at: matchedAt,
        started_at: null,
      });

      const response = await request(app).get('/api/match/queue');

      expect(response.status).toBe(200);
      expect(response.body.data.inQueue).toBe(false);
      expect(response.body.data.matched).toBe(true);
      expect(response.body.data.battleId).toBe('battle-loser');
      expect(response.body.data.matchedAt).toBe(matchedAt.getTime());
    });

    it('真不在：返 200 + data.inQueue=false + data.matched=false', async () => {
      // 1. getMatchmakingStatus: zRange 空
      mockedRedis.zRange.mockResolvedValueOnce([]);
      // 2. getUserPendingBattle: getPlayerIdByUserId
      mockGetPlayerIdByUserId.mockResolvedValueOnce('player-123');
      // 3. getPendingBattleByPlayerId 返 null
      mockGetPendingBattleByPlayerId.mockResolvedValueOnce(null);

      const response = await request(app).get('/api/match/queue');

      expect(response.status).toBe(200);
      expect(response.body.data.inQueue).toBe(false);
      expect(response.body.data.matched).toBe(false);
    });
  });

  // ========================================
  // T043 + T044: DELETE /api/match/queue
  // ========================================

  describe('DELETE /api/match/queue (T043 + T044)', () => {
    it('在队列：返 200 + status:"left" + entry', async () => {
      const enqueuedAt = Date.now() - 3000;
      const entryStr = JSON.stringify({ userId: 'user-123', enqueuedAt });
      mockedRedis.zRange.mockResolvedValueOnce([entryStr]);
      mockedRedis.zRem.mockResolvedValueOnce(1);
      mockedRedis.del.mockResolvedValueOnce(1);

      const response = await request(app).delete('/api/match/queue');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.status).toBe('left');
      expect(response.body.data.userId).toBe('user-123');
      expect(response.body.data.enqueuedAt).toBe(enqueuedAt);

      expect(mockedRedis.zRem).toHaveBeenCalledWith('idle:matchmaking:queue', entryStr);
      expect(mockedRedis.del).toHaveBeenCalledWith('idle:matchmaking:lock:user-123');
    });

    it('LOSER 想取消：返 409 + error:"already_matched" + data.battleId', async () => {
      // 1. leaveMatchmaking: zRange 空
      mockedRedis.zRange.mockResolvedValueOnce([]);
      // 2. getUserPendingBattle: getPlayerIdByUserId
      mockGetPlayerIdByUserId.mockResolvedValueOnce('player-123');
      // 3. getPendingBattleByPlayerId 返 pending
      mockGetPendingBattleByPlayerId.mockResolvedValueOnce({
        id: 'battle-pending',
        player1_id: 'player-123',
        player2_id: 'player-other',
        status: 'pending',
        matched_at: new Date(),
        started_at: null,
      });

      const response = await request(app).delete('/api/match/queue');

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('already_matched');
      expect(response.body.data.battleId).toBe('battle-pending');
    });

    it('真不在：返 400 + error:"Not in matchmaking queue"', async () => {
      // 1. leaveMatchmaking: zRange 空
      mockedRedis.zRange.mockResolvedValueOnce([]);
      // 2. getUserPendingBattle: getPlayerIdByUserId
      mockGetPlayerIdByUserId.mockResolvedValueOnce('player-123');
      // 3. getPendingBattleByPlayerId 返 null
      mockGetPendingBattleByPlayerId.mockResolvedValueOnce(null);

      const response = await request(app).delete('/api/match/queue');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Not in matchmaking queue');
      expect(mockedRedis.zRem).not.toHaveBeenCalled();
      expect(mockedRedis.del).not.toHaveBeenCalled();
    });
  });
});
