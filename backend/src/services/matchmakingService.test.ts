import {
  enqueueMatchmaking,
  getMatchmakingStatus,
  leaveMatchmaking,
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
    zRem: jest.fn(),
    del: jest.fn(),
  },
}));

const mockedRedis = redisClient as unknown as {
  set: jest.Mock;
  zAdd: jest.Mock;
  zRange: jest.Mock;
  zCard: jest.Mock;
  zRem: jest.Mock;
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
});
