import {
  enqueueMatchmaking,
  getMatchmakingQueueStats,
  clearMatchmakingQueue,
} from './matchmakingService';
import { redisClient } from '../config/redis';

// Mock the redis singleton
jest.mock('../config/redis', () => ({
  redisClient: {
    set: jest.fn(),
    zAdd: jest.fn(),
    zRange: jest.fn(),
    zCard: jest.fn(),
    del: jest.fn(),
  },
}));

const mockedRedis = redisClient as unknown as {
  set: jest.Mock;
  zAdd: jest.Mock;
  zRange: jest.Mock;
  zCard: jest.Mock;
  del: jest.Mock;
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
});
