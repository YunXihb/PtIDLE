// Unit tests for gatheringService
import * as gatheringService from '../services/gatheringService';
import { query, execute } from '../config/database';
import {
  enqueueGatheringTask,
  removeGatheringTask,
  isGatheringTaskQueued,
} from '../services/idleQueueService';

// Mock the database module
const mockWithTransaction = jest.fn();
jest.mock('../config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  withTransaction: (...args: any[]) => mockWithTransaction(...args),
}));

// Mock skillService
jest.mock('../services/skillService', () => ({
  getGatheringConfig: jest.fn().mockResolvedValue({
    mining: {
      primaryResource: 'iron_ore',
      baseRate: 1,
      byproduct: 'coal',
      byproductChance: 0.3,
    },
    woodcutting: {
      primaryResource: 'wood',
      baseRate: 1,
      byproduct: 'sap',
      byproductChance: 0.2,
    },
    herbalism: {
      primaryResource: 'herb',
      baseRate: 1,
      byproduct: 'mushroom',
      byproductChance: 0.3,
    },
  }),
  clearSkillsCache: jest.fn(),
}));

// Mock idleQueueService
jest.mock('../services/idleQueueService', () => ({
  enqueueGatheringTask: jest.fn().mockResolvedValue(undefined),
  removeGatheringTask: jest.fn().mockResolvedValue(undefined),
  getDueGatheringTasks: jest.fn().mockResolvedValue([]),
  acquireGatheringLock: jest.fn().mockResolvedValue(true),
  releaseGatheringLock: jest.fn().mockResolvedValue(undefined),
  isGatheringTaskQueued: jest.fn().mockResolvedValue(true),
}));

const mockedQuery = query as jest.MockedFunction<typeof query>;
const mockedExecute = execute as jest.MockedFunction<typeof execute>;
const mockedEnqueue = enqueueGatheringTask as jest.MockedFunction<typeof enqueueGatheringTask>;
const mockedRemove = removeGatheringTask as jest.MockedFunction<typeof removeGatheringTask>;
const mockedIsQueued = isGatheringTaskQueued as jest.MockedFunction<typeof isGatheringTaskQueued>;

// withTransaction 透传：fn 收到 fakeClient，client.query 走 mockedQuery
function defaultWithTransaction() {
  mockWithTransaction.mockImplementation(async (fn: any) => {
    const fakeClient = {
      query: async (text: string, params?: any[]) => {
        const res: any = await mockedQuery(text, params);
        if (res && res.rowCount !== undefined) return res;
        return { rows: (res as any[]) ?? [], rowCount: ((res as any[]) ?? []).length };
      },
      release: jest.fn(),
    };
    return await fn(fakeClient);
  });
}

/** 取 completeGathering 写回 players 的 idle_queue */
function writtenIdleQueue(): any[] {
  const call = mockedQuery.mock.calls.find(c => String(c[0]).includes('UPDATE players SET resources'));
  return call ? JSON.parse(String(call[1]![1])) : [];
}

describe('gatheringService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    defaultWithTransaction();
    mockedIsQueued.mockResolvedValue(true);
  });

  describe('startGathering', () => {
    const userId = 'user-123';

    it('should create a new gathering task', async () => {
      mockedQuery.mockResolvedValueOnce([{
        id: 'player-1',
        resources: { iron_ore: 100 },
        warehouse_limits: { resource: 1000 },
        idle_queue: []
      }]);
      mockedExecute.mockResolvedValue(1);

      const result = await gatheringService.startGathering(userId, 'mining');

      expect(result).not.toBeNull();
      expect(result?.skillType).toBe('mining');
      expect(result?.status).toBe('active');
      expect(mockedExecute).toHaveBeenCalled();
    });

    it('should start at round 1 and record the enqueue key', async () => {
      mockedQuery.mockResolvedValueOnce([{
        id: 'player-1',
        resources: { iron_ore: 100 },
        warehouse_limits: { resource: 1000 },
        idle_queue: []
      }]);
      mockedExecute.mockResolvedValue(1);

      const result = await gatheringService.startGathering(userId, 'mining');

      expect(result?.round).toBe(1);
      expect(typeof result?.enqueuedAt).toBe('number');
      // 入队用的 enqueuedAt 必须和任务里记录的一致，否则后续 zRem 匹配不上
      expect(mockedEnqueue).toHaveBeenCalledWith(
        userId,
        'mining',
        expect.any(Number),
        result!.enqueuedAt
      );
    });

    it('should throw error if already has active task', async () => {
      mockedQuery.mockResolvedValueOnce([{
        id: 'player-1',
        resources: { iron_ore: 100 },
        warehouse_limits: { resource: 1000 },
        idle_queue: [{ id: 'task-1', skillType: 'mining', status: 'active' }]
      }]);

      await expect(gatheringService.startGathering(userId, 'woodcutting'))
        .rejects.toMatchObject({
          name: 'ApiError',
          status: 400,
          message: 'Already has active gathering task',
        });
    });

    it('should return null if player not found', async () => {
      mockedQuery.mockResolvedValueOnce([]);

      const result = await gatheringService.startGathering(userId, 'mining');

      expect(result).toBeNull();
    });
  });

  describe('getGatheringStatus', () => {
    const userId = 'user-123';

    it('should return active task with progress', async () => {
      const startTime = new Date(Date.now() - 30000).toISOString(); // 30 seconds ago

      mockedQuery.mockResolvedValueOnce([{
        idle_queue: [{
          id: 'task-1',
          skillType: 'mining',
          startedAt: startTime,
          duration: 60,
          status: 'active'
        }]
      }]);

      const result = await gatheringService.getGatheringStatus(userId);

      expect(result).not.toBeNull();
      expect(result?.status).toBe('active');
      expect(result?.progress).toBeGreaterThan(0);
      expect(result?.progress).toBeLessThanOrEqual(1);
    });

    it('should return the round number of the active task', async () => {
      const startTime = new Date(Date.now() - 5000).toISOString();

      mockedQuery.mockResolvedValueOnce([{
        idle_queue: [{
          id: 'task-1',
          skillType: 'mining',
          startedAt: startTime,
          duration: 60,
          status: 'active',
          round: 7
        }]
      }]);

      const result = await gatheringService.getGatheringStatus(userId);

      expect(result?.round).toBe(7);
    });

    it('should re-enqueue the task when the Redis queue entry is missing', async () => {
      const startTime = new Date(Date.now() - 5000).toISOString();
      const enqueuedAt = 1700000000000;

      mockedQuery.mockResolvedValueOnce([{
        idle_queue: [{
          id: 'task-1',
          skillType: 'mining',
          startedAt: startTime,
          duration: 60,
          status: 'active',
          round: 2,
          enqueuedAt
        }]
      }]);
      mockedIsQueued.mockResolvedValue(false);

      const result = await gatheringService.getGatheringStatus(userId);

      expect(result?.round).toBe(2);
      expect(mockedEnqueue).toHaveBeenCalledWith(
        userId,
        'mining',
        expect.any(Number),
        enqueuedAt
      );
    });

    it('should not touch Redis when the task is already queued', async () => {
      const startTime = new Date(Date.now() - 5000).toISOString();

      mockedQuery.mockResolvedValueOnce([{
        idle_queue: [{
          id: 'task-1',
          skillType: 'mining',
          startedAt: startTime,
          duration: 60,
          status: 'active',
          round: 2,
          enqueuedAt: 1700000000000
        }]
      }]);
      mockedIsQueued.mockResolvedValue(true);

      await gatheringService.getGatheringStatus(userId);

      expect(mockedEnqueue).not.toHaveBeenCalled();
    });

    it('should return null if no active task', async () => {
      mockedQuery.mockResolvedValueOnce([{
        idle_queue: []
      }]);

      const result = await gatheringService.getGatheringStatus(userId);

      expect(result).toBeNull();
    });
  });

  describe('completeGathering', () => {
    const userId = 'user-123';

    /** 一个已经到期的活跃任务（第 3 轮） */
    function expiredTask(extra: Record<string, any> = {}) {
      return {
        id: 'task-1',
        skillType: 'mining',
        characterId: 'char-1',
        startedAt: new Date(Date.now() - 120000).toISOString(),
        duration: 60,
        status: 'active',
        round: 3,
        enqueuedAt: 1700000000000,
        ...extra,
      };
    }

    it('should complete the task and open the next round in the same transaction', async () => {
      mockedQuery.mockResolvedValueOnce([{
        id: 'player-1',
        resources: { iron_ore: 100 },
        warehouse_limits: { resource: 1000 },
        idle_queue: [expiredTask()],
        production_gear: {}
      }]);

      const result = await gatheringService.completeGathering(userId);

      expect(result).not.toBeNull();
      expect(result?.status).toBe('completed');
      expect(result?.result).toBeDefined();

      const queue = writtenIdleQueue();
      expect(queue).toHaveLength(2);
      // 本轮已结算
      expect(queue[0].status).toBe('completed');
      expect(queue[0].round).toBe(3);
      // 下一轮自动开启
      expect(queue[1].status).toBe('active');
      expect(queue[1].round).toBe(4);
      expect(queue[1].skillType).toBe('mining');
      expect(queue[1].characterId).toBe('char-1');
      expect(typeof queue[1].enqueuedAt).toBe('number');
    });

    it('should enqueue the next round with a matching queue key', async () => {
      mockedQuery.mockResolvedValueOnce([{
        id: 'player-1',
        resources: { iron_ore: 100 },
        warehouse_limits: { resource: 1000 },
        idle_queue: [expiredTask()],
        production_gear: {}
      }]);

      await gatheringService.completeGathering(userId);

      const queue = writtenIdleQueue();
      const nextTask = queue[1];
      // 入队键必须和任务里的 enqueuedAt 一致
      expect(mockedEnqueue).toHaveBeenCalledWith(
        userId,
        'mining',
        expect.any(Number),
        nextTask.enqueuedAt
      );
      // 本轮条目要出队
      expect(mockedRemove).toHaveBeenCalledWith(userId, 'mining', 1700000000000);
    });

    it('should keep idle_queue at two entries so it does not grow forever', async () => {
      mockedQuery.mockResolvedValueOnce([{
        id: 'player-1',
        resources: { iron_ore: 100 },
        warehouse_limits: { resource: 1000 },
        idle_queue: [
          { id: 'old-1', skillType: 'mining', startedAt: new Date().toISOString(), duration: 60, status: 'completed', round: 1 },
          { id: 'old-2', skillType: 'mining', startedAt: new Date().toISOString(), duration: 60, status: 'completed', round: 2 },
          expiredTask(),
        ],
        production_gear: {}
      }]);

      await gatheringService.completeGathering(userId);

      const queue = writtenIdleQueue();
      expect(queue).toHaveLength(2);
      expect(queue[0].round).toBe(3);
      expect(queue[1].round).toBe(4);
    });

    it('should return null when the task is not yet due', async () => {
      mockedQuery.mockResolvedValueOnce([{
        id: 'player-1',
        resources: { iron_ore: 100 },
        warehouse_limits: { resource: 1000 },
        idle_queue: [{
          id: 'task-1',
          skillType: 'mining',
          startedAt: new Date().toISOString(),
          duration: 60,
          status: 'active',
          round: 1,
        }],
        production_gear: {}
      }]);

      const result = await gatheringService.completeGathering(userId);

      expect(result).toBeNull();
      expect(mockedEnqueue).not.toHaveBeenCalled();
    });

    it('should return null when there is no active task', async () => {
      mockedQuery.mockResolvedValueOnce([{
        id: 'player-1',
        resources: { iron_ore: 100 },
        warehouse_limits: { resource: 1000 },
        idle_queue: [],
        production_gear: {}
      }]);

      const result = await gatheringService.completeGathering(userId);

      expect(result).toBeNull();
    });
  });

  describe('cancelGathering', () => {
    const userId = 'user-123';

    it('should cancel active gathering task', async () => {
      mockedQuery.mockResolvedValueOnce([{
        idle_queue: [{
          id: 'task-1',
          skillType: 'mining',
          startedAt: new Date().toISOString(),
          duration: 60,
          status: 'active'
        }]
      }]);
      mockedExecute.mockResolvedValue(1);

      const result = await gatheringService.cancelGathering(userId);

      expect(result).toBe(true);
    });

    it('should remove the Redis entry using the enqueue key', async () => {
      mockedQuery.mockResolvedValueOnce([{
        idle_queue: [{
          id: 'task-1',
          skillType: 'mining',
          startedAt: new Date('2026-10-21T00:00:00.000Z').toISOString(),
          duration: 60,
          status: 'active',
          round: 2,
          enqueuedAt: 1700000000000,
        }]
      }]);
      mockedExecute.mockResolvedValue(1);

      await gatheringService.cancelGathering(userId);

      // 旧实现用 startedAt 去 zRem，member 匹配不上 -> 队列残留僵尸条目
      expect(mockedRemove).toHaveBeenCalledWith(userId, 'mining', 1700000000000);
    });

    it('should fall back to startedAt for legacy tasks without an enqueue key', async () => {
      const startedAt = new Date('2026-10-21T00:00:00.000Z').toISOString();
      mockedQuery.mockResolvedValueOnce([{
        idle_queue: [{
          id: 'task-1',
          skillType: 'mining',
          startedAt,
          duration: 60,
          status: 'active',
        }]
      }]);
      mockedExecute.mockResolvedValue(1);

      await gatheringService.cancelGathering(userId);

      expect(mockedRemove).toHaveBeenCalledWith(
        userId,
        'mining',
        new Date(startedAt).getTime()
      );
    });

    it('should return false if no active task', async () => {
      mockedQuery.mockResolvedValueOnce([{
        idle_queue: []
      }]);

      const result = await gatheringService.cancelGathering(userId);

      expect(result).toBe(false);
    });
  });
});
