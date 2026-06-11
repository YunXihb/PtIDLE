// Integration tests for matchmaking API (T042)
import request from 'supertest';
import express from 'express';
import matchmakingRoutes from './matchmaking';

// Mock the redis module (singleton client never gets .connect() in test process)
jest.mock('../config/redis', () => ({
  redisClient: {
    zAdd: jest.fn(),
    zRange: jest.fn(),
    zCard: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  },
  connectRedis: jest.fn(),
  disconnectRedis: jest.fn(),
}));

// Mock auth middleware to inject a fake user
jest.mock('../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-123' };
    next();
  },
  AuthRequest: {} as any,
}));

// Import the mocked redis after jest.mock so the singleton is the mock
import { redisClient } from '../config/redis';

const mockedRedis = redisClient as unknown as {
  set: jest.Mock;
  zAdd: jest.Mock;
  zRange: jest.Mock;
  zCard: jest.Mock;
  del: jest.Mock;
};

// Create test app
const app = express();
app.use(express.json());
app.use('/api/match', matchmakingRoutes);

describe('Matchmaking API Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/match/queue', () => {
    it('首次入队返回 201 + entry', async () => {
      mockedRedis.set.mockResolvedValueOnce('OK');
      mockedRedis.zAdd.mockResolvedValueOnce(1);

      const response = await request(app).post('/api/match/queue').send({});

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.userId).toBe('user-123');
      expect(typeof response.body.data.enqueuedAt).toBe('number');

      expect(mockedRedis.set).toHaveBeenCalledWith(
        'idle:matchmaking:lock:user-123',
        '1',
        { NX: true, EX: 600 }
      );
      expect(mockedRedis.zAdd).toHaveBeenCalledTimes(1);
    });

    it('重复入队返回 400 且不调用 zAdd', async () => {
      mockedRedis.set.mockResolvedValueOnce(null);

      const response = await request(app).post('/api/match/queue').send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Already in matchmaking queue');
      expect(mockedRedis.zAdd).not.toHaveBeenCalled();
    });
  });
});
