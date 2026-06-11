// Mocks must be declared BEFORE imports (jest hoists jest.mock to top of file)

// Mock the redis singleton
jest.mock('../config/redis', () => ({
  redisClient: {
    set: jest.fn(),
    zAdd: jest.fn(),
    zRange: jest.fn(),
    zCard: jest.fn(),
    zRem: jest.fn(),
    del: jest.fn(),
    eval: jest.fn(),
  },
}));

// Mock the database module
const mockQueryOne = jest.fn();
jest.mock('../config/database', () => ({
  query: jest.fn(),
  queryOne: mockQueryOne,
}));

// Mock the playerService
const mockGetPlayerIdByUserId = jest.fn();
jest.mock('./playerService', () => ({
  getPlayerIdByUserId: mockGetPlayerIdByUserId,
}));

// Mock the characterService
const mockCountAliveCharacters = jest.fn();
jest.mock('./characterService', () => ({
  countAliveCharacters: mockCountAliveCharacters,
}));

// Mock the battleService
const mockCreatePendingBattle = jest.fn();
const mockGetPendingBattleByPlayerId = jest.fn();
jest.mock('./battleService', () => ({
  createPendingBattle: mockCreatePendingBattle,
  getPendingBattleByPlayerId: mockGetPendingBattleByPlayerId,
}));

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _refs = { mockQueryOne, mockGetPlayerIdByUserId, mockCountAliveCharacters, mockCreatePendingBattle, mockGetPendingBattleByPlayerId };

// Imports must come AFTER all jest.mock calls
import {
  enqueueMatchmaking,
  getMatchmakingStatus,
  leaveMatchmaking,
  getMatchmakingQueueStats,
  clearMatchmakingQueue,
  tryMatch,
} from './matchmakingService';
import { redisClient } from '../config/redis';

const mockedRedis = redisClient as unknown as {
  set: jest.Mock;
  zAdd: jest.Mock;
  zRange: jest.Mock;
  zCard: jest.Mock;
  zRem: jest.Mock;
  del: jest.Mock;
  eval: jest.Mock;
};

describe('matchmakingService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('enqueueMatchmaking', () => {
    it('首次入队：抢锁成功后调用 zAdd 并返回 entry', async () => {
      mockedRedis.set.mockResolvedValueOnce('OK');
      mockedRedis.zAdd.mockResolvedValueOnce(1);

      const before = Date.now();
      const entry = await enqueueMatchmaking('user-123');
      const after = Date.now();

      // 锁先抢
      expect(mockedRedis.set).toHaveBeenCalledTimes(1);
      expect(mockedRedis.set).toHaveBeenCalledWith(
        'idle:matchmaking:lock:user-123',
        '1',
        { NX: true, EX: 600 }
      );

      // zAdd 在锁后调用
      expect(mockedRedis.zAdd).toHaveBeenCalledTimes(1);
      expect(mockedRedis.zAdd).toHaveBeenCalledWith(
        'idle:matchmaking:queue',
        expect.objectContaining({
          score: expect.any(Number),
          value: expect.any(String),
        })
      );

      // 返回值字段正确
      expect(entry.userId).toBe('user-123');
      expect(entry.enqueuedAt).toBeGreaterThanOrEqual(before);
      expect(entry.enqueuedAt).toBeLessThanOrEqual(after);

      // zAdd 的 value 是合法 JSON 且 score 与 enqueuedAt 一致
      const zAddArg = mockedRedis.zAdd.mock.calls[0][1] as { score: number; value: string };
      expect(zAddArg.score).toBe(entry.enqueuedAt);
      expect(JSON.parse(zAddArg.value)).toEqual(entry);
    });

    it('重复入队：抢锁失败抛错且不调用 zAdd', async () => {
      mockedRedis.set.mockResolvedValueOnce(null);

      await expect(enqueueMatchmaking('user-123')).rejects.toThrow('已在匹配队列中');

      expect(mockedRedis.set).toHaveBeenCalledTimes(1);
      expect(mockedRedis.zAdd).not.toHaveBeenCalled();
    });
  });

  describe('getMatchmakingQueueStats', () => {
    it('空队列：返回 0 和 null', async () => {
      mockedRedis.zCard.mockResolvedValueOnce(0);

      const stats = await getMatchmakingQueueStats();

      expect(stats).toEqual({
        pendingPlayers: 0,
        oldestEnqueuedAt: null,
        newestEnqueuedAt: null,
      });
      expect(mockedRedis.zRange).not.toHaveBeenCalled();
    });

    it('非空队列：返回正确统计（oldest + newest）', async () => {
      mockedRedis.zCard.mockResolvedValueOnce(2);
      mockedRedis.zRange
        .mockResolvedValueOnce([JSON.stringify({ userId: 'u-old', enqueuedAt: 1000 })])
        .mockResolvedValueOnce([JSON.stringify({ userId: 'u-new', enqueuedAt: 2000 })]);

      const stats = await getMatchmakingQueueStats();

      expect(stats).toEqual({
        pendingPlayers: 2,
        oldestEnqueuedAt: 1000,
        newestEnqueuedAt: 2000,
      });
      expect(mockedRedis.zRange).toHaveBeenCalledTimes(2);
      expect(mockedRedis.zRange).toHaveBeenNthCalledWith(1, 'idle:matchmaking:queue', 0, 0);
      expect(mockedRedis.zRange).toHaveBeenNthCalledWith(2, 'idle:matchmaking:queue', -1, -1);
    });
  });

  describe('clearMatchmakingQueue', () => {
    it('调用 del 删除队列 key', async () => {
      mockedRedis.del.mockResolvedValueOnce(1);

      await clearMatchmakingQueue();

      expect(mockedRedis.del).toHaveBeenCalledTimes(1);
      expect(mockedRedis.del).toHaveBeenCalledWith('idle:matchmaking:queue');
    });
  });

  describe('getMatchmakingStatus', () => {
    it('在队列：返回含 waitingSeconds 的 status', async () => {
      const enqueuedAt = Date.now() - 4200; // 4.2 秒前入队
      mockedRedis.zRange.mockResolvedValueOnce([
        JSON.stringify({ userId: 'user-123', enqueuedAt }),
        JSON.stringify({ userId: 'other-user', enqueuedAt: Date.now() - 1000 }),
      ]);

      const status = await getMatchmakingStatus('user-123');

      expect(status).not.toBeNull();
      expect(status?.userId).toBe('user-123');
      expect(status?.enqueuedAt).toBe(enqueuedAt);
      // 4.2 秒 → floor 到 4
      expect(status?.waitingSeconds).toBe(4);
      expect(typeof status?.waitingSeconds).toBe('number');
      expect(status!.waitingSeconds).toBeGreaterThanOrEqual(0);
      expect(mockedRedis.zRange).toHaveBeenCalledWith('idle:matchmaking:queue', 0, -1);
    });

    it('不在队列：返回 null', async () => {
      mockedRedis.zRange.mockResolvedValueOnce([
        JSON.stringify({ userId: 'other-user', enqueuedAt: Date.now() }),
      ]);

      const status = await getMatchmakingStatus('user-123');

      expect(status).toBeNull();
    });

    it('空队列：返回 null', async () => {
      mockedRedis.zRange.mockResolvedValueOnce([]);

      const status = await getMatchmakingStatus('user-123');

      expect(status).toBeNull();
    });

    it('时钟回拨：waitingSeconds clamp 至 0', async () => {
      const enqueuedAt = Date.now() + 5000; // 入队时间在未来（时钟回拨）
      mockedRedis.zRange.mockResolvedValueOnce([
        JSON.stringify({ userId: 'user-123', enqueuedAt }),
      ]);

      const status = await getMatchmakingStatus('user-123');

      expect(status?.waitingSeconds).toBe(0);
    });
  });

  describe('leaveMatchmaking', () => {
    it('成功：zRem 在 del 之前调用，返回被移除的 entry', async () => {
      const enqueuedAt = Date.now() - 5000;
      const entryStr = JSON.stringify({ userId: 'user-123', enqueuedAt });
      mockedRedis.zRange.mockResolvedValueOnce([entryStr]);
      mockedRedis.zRem.mockResolvedValueOnce(1);
      mockedRedis.del.mockResolvedValueOnce(1);

      const entry = await leaveMatchmaking('user-123');

      expect(entry).toEqual({ userId: 'user-123', enqueuedAt });

      // zRem 调用：完整 JSON 串作为 value
      expect(mockedRedis.zRem).toHaveBeenCalledTimes(1);
      expect(mockedRedis.zRem).toHaveBeenCalledWith('idle:matchmaking:queue', entryStr);

      // del 调用：释放锁
      expect(mockedRedis.del).toHaveBeenCalledTimes(1);
      expect(mockedRedis.del).toHaveBeenCalledWith('idle:matchmaking:lock:user-123');

      // 关键顺序：zRem 先、del 后（zRem 的 invocationCallOrder 数字 < del 的）
      const zRemCallOrder = mockedRedis.zRem.mock.invocationCallOrder[0];
      const delCallOrder = mockedRedis.del.mock.invocationCallOrder[0];
      expect(zRemCallOrder).toBeLessThan(delCallOrder);
    });

    it('不在队列：抛「不在匹配队列中」，zRem 与 del 均未调用', async () => {
      mockedRedis.zRange.mockResolvedValueOnce([]);

      await expect(leaveMatchmaking('user-123')).rejects.toThrow('不在匹配队列中');

      expect(mockedRedis.zRem).not.toHaveBeenCalled();
      expect(mockedRedis.del).not.toHaveBeenCalled();
    });

    it('队列中只有其他玩家：抛「不在匹配队列中」', async () => {
      mockedRedis.zRange.mockResolvedValueOnce([
        JSON.stringify({ userId: 'other-user', enqueuedAt: Date.now() }),
      ]);

      await expect(leaveMatchmaking('user-123')).rejects.toThrow('不在匹配队列中');

      expect(mockedRedis.zRem).not.toHaveBeenCalled();
      expect(mockedRedis.del).not.toHaveBeenCalled();
    });
  });

  // ========================================
  // T044 tryMatch 单元测试
  // ========================================

  describe('tryMatch', () => {
    it('单人队列：抢锁 → Lua 返 NO_CANDIDATE → 释放锁 → matched:false', async () => {
      // 1. SETNX global lock 成功
      mockedRedis.set.mockResolvedValueOnce('OK');
      // 2. LUA_PICK_CANDIDATE 返 NO_CANDIDATE
      mockedRedis.eval.mockResolvedValueOnce([0, 'NO_CANDIDATE']);
      // 3. safeReleaseGlobalLock 的 LUA 也调一次 eval
      mockedRedis.eval.mockResolvedValueOnce([1]);

      const result = await tryMatch('user-trigger');

      expect(result.matched).toBe(false);
      if (!result.matched) {
        expect(result.rejectionReason).toBe('no_candidate');
      }

      // SETNX global lock
      expect(mockedRedis.set).toHaveBeenCalledWith(
        'idle:matchmaking:lock:global',
        expect.any(String),
        { NX: true, EX: 5 }
      );

      // LUA_PICK_CANDIDATE 调用
      expect(mockedRedis.eval).toHaveBeenCalled();
    });

    it('两人队列、双方都 alive=3：Lua 返 picked → alive 通过 → INSERT → cleanup → matched:true', async () => {
      // 1. SETNX global lock 成功
      mockedRedis.set.mockResolvedValueOnce('OK');
      // 2. LUA_PICK_CANDIDATE 返 picked
      const pickedEntryStr = JSON.stringify({ userId: 'user-picked', enqueuedAt: 1000 });
      mockedRedis.eval.mockResolvedValueOnce([1, 'user-picked', pickedEntryStr]);
      // 3. findAndGetSelfEntryStr: zRange 返回 self entry
      const selfEntryStr = JSON.stringify({ userId: 'user-trigger', enqueuedAt: 2000 });
      mockedRedis.zRange.mockResolvedValueOnce([selfEntryStr]);
      // 4. getPlayerIdByUserId(trigger) + getPlayerIdByUserId(picked)
      mockGetPlayerIdByUserId.mockResolvedValueOnce('player-trigger');
      mockGetPlayerIdByUserId.mockResolvedValueOnce('player-picked');
      // 5. countAliveCharacters ×2
      mockCountAliveCharacters.mockResolvedValueOnce(3); // self
      mockCountAliveCharacters.mockResolvedValueOnce(3); // picked
      // 6. 防 dup 预查询：queryOne 返 null
      mockQueryOne.mockResolvedValueOnce(null);
      // 7. createPendingBattle 返新 battleId
      mockCreatePendingBattle.mockResolvedValueOnce('battle-abc');
      // 8. LUA_RELEASE_CLEANUP 返 {1}
      mockedRedis.eval.mockResolvedValueOnce([1]);

      const result = await tryMatch('user-trigger');

      expect(result.matched).toBe(true);
      if (result.matched) {
        expect(result.battleId).toBe('battle-abc');
        expect(result.opponentUserId).toBe('user-picked');
      }

      // createPendingBattle: p1=picked, p2=trigger
      expect(mockCreatePendingBattle).toHaveBeenCalledWith('player-picked', 'player-trigger');
    });

    it('self alive<3：zRem self + del self lock + 释放 global → matched:false + reason=self_not_eligible', async () => {
      // 1. SETNX global lock 成功
      mockedRedis.set.mockResolvedValueOnce('OK');
      // 2. LUA_PICK_CANDIDATE 返 picked
      const pickedEntryStr = JSON.stringify({ userId: 'user-picked', enqueuedAt: 1000 });
      mockedRedis.eval.mockResolvedValueOnce([1, 'user-picked', pickedEntryStr]);
      // 3. findAndGetSelfEntryStr: zRange 返回 self entry
      const selfEntryStr = JSON.stringify({ userId: 'user-trigger', enqueuedAt: 2000 });
      mockedRedis.zRange.mockResolvedValueOnce([selfEntryStr]);
      // 4. getPlayerIdByUserId ×2
      mockGetPlayerIdByUserId.mockResolvedValueOnce('player-trigger');
      mockGetPlayerIdByUserId.mockResolvedValueOnce('player-picked');
      // 5. countAliveCharacters(self) 返 2（<3）
      mockCountAliveCharacters.mockResolvedValueOnce(2);
      // 6. cleanupFailedCandidate 调 zRem + del ×2 + eval (safeRelease)
      mockedRedis.zRem.mockResolvedValueOnce(1); // zRem self
      mockedRedis.del.mockResolvedValueOnce(1); // del self lock
      mockedRedis.del.mockResolvedValueOnce(1); // del picked lock
      mockedRedis.eval.mockResolvedValueOnce([1]); // safeRelease global

      const result = await tryMatch('user-trigger');

      expect(result.matched).toBe(false);
      if (!result.matched) {
        expect(result.rejectionReason).toBe('self_not_eligible');
      }

      // zRem self entry
      expect(mockedRedis.zRem).toHaveBeenCalledWith('idle:matchmaking:queue', selfEntryStr);
      // del self lock
      expect(mockedRedis.del).toHaveBeenCalledWith('idle:matchmaking:lock:user-trigger');
      // del picked lock
      expect(mockedRedis.del).toHaveBeenCalledWith('idle:matchmaking:lock:user-picked');
    });

    it('picked alive<3：del picked lock + 释放 global → matched:false + reason=opponent_not_eligible', async () => {
      // 1. SETNX global lock 成功
      mockedRedis.set.mockResolvedValueOnce('OK');
      // 2. LUA_PICK_CANDIDATE 返 picked
      const pickedEntryStr = JSON.stringify({ userId: 'user-picked', enqueuedAt: 1000 });
      mockedRedis.eval.mockResolvedValueOnce([1, 'user-picked', pickedEntryStr]);
      // 3. findAndGetSelfEntryStr: zRange 返回 self entry
      const selfEntryStr = JSON.stringify({ userId: 'user-trigger', enqueuedAt: 2000 });
      mockedRedis.zRange.mockResolvedValueOnce([selfEntryStr]);
      // 4. getPlayerIdByUserId ×2
      mockGetPlayerIdByUserId.mockResolvedValueOnce('player-trigger');
      mockGetPlayerIdByUserId.mockResolvedValueOnce('player-picked');
      // 5. countAliveCharacters(self) 返 3
      mockCountAliveCharacters.mockResolvedValueOnce(3);
      // 6. countAliveCharacters(picked) 返 2（<3）
      mockCountAliveCharacters.mockResolvedValueOnce(2);
      // 7. cleanupFailedCandidate: zRem self + del ×2 + eval
      mockedRedis.zRem.mockResolvedValueOnce(1);
      mockedRedis.del.mockResolvedValueOnce(1);
      mockedRedis.del.mockResolvedValueOnce(1);
      mockedRedis.eval.mockResolvedValueOnce([1]);

      const result = await tryMatch('user-trigger');

      expect(result.matched).toBe(false);
      if (!result.matched) {
        expect(result.rejectionReason).toBe('opponent_not_eligible');
      }
    });

    it('全局锁被占：SETNX 返 null → matched:false + reason=lock_failed', async () => {
      // SETNX 返 null（被占）
      mockedRedis.set.mockResolvedValueOnce(null);

      const result = await tryMatch('user-trigger');

      expect(result.matched).toBe(false);
      if (!result.matched) {
        expect(result.rejectionReason).toBe('lock_failed');
      }

      // 不调用 Lua
      expect(mockedRedis.eval).not.toHaveBeenCalled();
    });

    it('已存在 dup battle：防 dup 查询命中 → 返已有 battleId', async () => {
      // 1. SETNX global lock 成功
      mockedRedis.set.mockResolvedValueOnce('OK');
      // 2. LUA_PICK_CANDIDATE 返 picked
      const pickedEntryStr = JSON.stringify({ userId: 'user-picked', enqueuedAt: 1000 });
      mockedRedis.eval.mockResolvedValueOnce([1, 'user-picked', pickedEntryStr]);
      // 3. findAndGetSelfEntryStr
      const selfEntryStr = JSON.stringify({ userId: 'user-trigger', enqueuedAt: 2000 });
      mockedRedis.zRange.mockResolvedValueOnce([selfEntryStr]);
      // 4. getPlayerIdByUserId ×2
      mockGetPlayerIdByUserId.mockResolvedValueOnce('player-trigger');
      mockGetPlayerIdByUserId.mockResolvedValueOnce('player-picked');
      // 5. countAliveCharacters ×2
      mockCountAliveCharacters.mockResolvedValueOnce(3);
      mockCountAliveCharacters.mockResolvedValueOnce(3);
      // 6. 防 dup 预查询：queryOne 返已有 battle
      mockQueryOne.mockResolvedValueOnce({ id: 'battle-existing' });
      // 7. LUA_RELEASE_CLEANUP
      mockedRedis.eval.mockResolvedValueOnce([1]);

      const result = await tryMatch('user-trigger');

      expect(result.matched).toBe(true);
      if (result.matched) {
        expect(result.battleId).toBe('battle-existing');
        expect(result.opponentUserId).toBe('user-picked');
      }

      // 不调用 createPendingBattle
      expect(mockCreatePendingBattle).not.toHaveBeenCalled();
    });

    it('unique index 触发：INSERT ON CONFLICT → 返 dup 行的 id', async () => {
      // 1. SETNX global lock 成功
      mockedRedis.set.mockResolvedValueOnce('OK');
      // 2. LUA_PICK_CANDIDATE 返 picked
      const pickedEntryStr = JSON.stringify({ userId: 'user-picked', enqueuedAt: 1000 });
      mockedRedis.eval.mockResolvedValueOnce([1, 'user-picked', pickedEntryStr]);
      // 3. findAndGetSelfEntryStr
      const selfEntryStr = JSON.stringify({ userId: 'user-trigger', enqueuedAt: 2000 });
      mockedRedis.zRange.mockResolvedValueOnce([selfEntryStr]);
      // 4. getPlayerIdByUserId ×2
      mockGetPlayerIdByUserId.mockResolvedValueOnce('player-trigger');
      mockGetPlayerIdByUserId.mockResolvedValueOnce('player-picked');
      // 5. countAliveCharacters ×2
      mockCountAliveCharacters.mockResolvedValueOnce(3);
      mockCountAliveCharacters.mockResolvedValueOnce(3);
      // 6. 防 dup 预查询：queryOne 返 null
      mockQueryOne.mockResolvedValueOnce(null);
      // 7. createPendingBattle 返 null（被 unique index 拦截）
      mockCreatePendingBattle.mockResolvedValueOnce(null);
      // 8. dup 兜底查询
      mockQueryOne.mockResolvedValueOnce({ id: 'battle-dup' });
      // 9. LUA_RELEASE_CLEANUP
      mockedRedis.eval.mockResolvedValueOnce([1]);

      const result = await tryMatch('user-trigger');

      expect(result.matched).toBe(true);
      if (result.matched) {
        expect(result.battleId).toBe('battle-dup');
      }
    });

    it('Lua 脚本 token 验证失败（NOT_HOLDER）：抛错', async () => {
      // 1. SETNX global lock 成功
      mockedRedis.set.mockResolvedValueOnce('OK');
      // 2. LUA_PICK_CANDIDATE 返 NOT_HOLDER（异常路径）
      mockedRedis.eval.mockResolvedValueOnce([0, 'NOT_HOLDER']);
      // 3. catch 路径调 safeReleaseGlobalLock
      mockedRedis.eval.mockResolvedValueOnce([0]);

      await expect(tryMatch('user-trigger')).rejects.toThrow('LUA_PICK_CANDIDATE: token mismatch');
    });
  });
});
