// Unit tests for gatheringService
import * as gatheringService from '../services/gatheringService';
import { query, execute } from '../config/database';

// Mock the database module
jest.mock('../config/database', () => ({
  query: jest.fn(),
  execute: jest.fn()
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
}));

const mockedQuery = query as jest.MockedFunction<typeof query>;
const mockedExecute = execute as jest.MockedFunction<typeof execute>;

describe('gatheringService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

    it('should throw error if already has active task', async () => {
      mockedQuery.mockResolvedValueOnce([{
        id: 'player-1',
        resources: { iron_ore: 100 },
        warehouse_limits: { resource: 1000 },
        idle_queue: [{ id: 'task-1', skillType: 'mining', status: 'active' }]
      }]);

      await expect(gatheringService.startGathering(userId, 'woodcutting'))
        .rejects.toThrow('已有进行中的采集任务');
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

    it('should return null if no active task', async () => {
      mockedQuery.mockResolvedValueOnce([{
        idle_queue: []
      }]);

      const result = await gatheringService.getGatheringStatus(userId);

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

    it('should return false if no active task', async () => {
      mockedQuery.mockResolvedValueOnce([{
        idle_queue: []
      }]);

      const result = await gatheringService.cancelGathering(userId);

      expect(result).toBe(false);
    });
  });
});
