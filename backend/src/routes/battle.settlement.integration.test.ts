// Integration tests for T054 POST /api/battle/result
// 覆盖: 401 无 token / 400 缺 battleId / 403 非参与者 / 404 不存在 / 409 pending+ongoing /
//       200 happy path (p1 + p2 调用) / 200 幂等 二次调用

// Mocks must be declared BEFORE imports (jest hoists jest.mock to top of file)
// Mock the database module
const mockQuery = jest.fn();
const mockQueryOne = jest.fn();
const mockClientQuery = jest.fn();
const mockWithTransaction = jest.fn();

jest.mock('../config/database', () => ({
  query: mockQuery,
  queryOne: mockQueryOne,
  withTransaction: mockWithTransaction,
  execute: jest.fn(),
  testConnection: jest.fn(),
  pool: { on: jest.fn() },
}));

// Mock the redis module
jest.mock('../config/redis', () => ({
  redisClient: {
    keys: jest.fn(),
    del: jest.fn(),
    get: jest.fn(),
    hGetAll: jest.fn(),
    hGet: jest.fn(),
  },
  connectRedis: jest.fn(),
  disconnectRedis: jest.fn(),
}));

// 默认 mockClient：query 方法可被每个 case override
const mockClient = { query: mockClientQuery };

(mockWithTransaction as jest.Mock).mockImplementation(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async (fn: (client: any) => Promise<any>) => fn(mockClient)
);

// Imports must come AFTER all jest.mock calls
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import battleRoutes from './battle';
import { JWT_SECRET } from '../config/jwt';
import { redisClient } from '../config/redis';

// Create test app (uses REAL auth middleware so we can test 401 separately)
const app = express();
app.use(express.json());
app.use('/api/battle', battleRoutes);

const mockedRedis = redisClient as unknown as {
  keys: jest.Mock;
  del: jest.Mock;
};

interface MockBattleRow {
  id: string;
  status: string;
  matched_at: Date | null;
  finished_at: Date | null;
  settled_at: Date | null;
  p1_stars: number | null;
  p2_stars: number | null;
  winner_player_id: string | null;
  victory_type: string | null;
  player1_id: string;
  player2_id: string;
  p1_user_id: string;
  p2_user_id: string;
}

function buildBattleRow(overrides: Partial<MockBattleRow> = {}): MockBattleRow {
  return {
    id: 'b1',
    status: 'finished',
    matched_at: new Date('2026-06-20T10:00:00Z'),
    finished_at: new Date('2026-06-20T10:05:30Z'),
    settled_at: null,
    p1_stars: 6,
    p2_stars: 2,
    winner_player_id: 'player-1',
    victory_type: 'kill_threshold',
    player1_id: 'player-1',
    player2_id: 'player-2',
    p1_user_id: 'user-1',
    p2_user_id: 'user-2',
    ...overrides,
  };
}

/**
 * 签发 JWT
 */
function signToken(userId: string): string {
  return jwt.sign({ userId, username: `u-${userId}` }, JWT_SECRET, { expiresIn: '7d' });
}

describe('POST /api/battle/result - Integration Tests', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    // 重新装 withTransaction impl,因为 clearAllMocks 会清掉
    (mockWithTransaction as jest.Mock).mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (fn: (client: any) => Promise<any>) => fn(mockClient)
    );
    // 抑制 battleSettlementService 内部 console.error 噪声(只在 describe 内,afterEach 还原)
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  // ========================================
  // Auth 错误
  // ========================================

  it('401: 未带 token → 401', async () => {
    const response = await request(app).post('/api/battle/result').send({ battleId: 'b1' });
    expect(response.status).toBe(401);
  });

  it('400: 缺 battleId → 400', async () => {
    const response = await request(app)
      .post('/api/battle/result')
      .set('Authorization', `Bearer ${signToken('user-1')}`)
      .send({});
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/battleId/);
  });

  it('400: battleId 非字符串 → 400', async () => {
    const response = await request(app)
      .post('/api/battle/result')
      .set('Authorization', `Bearer ${signToken('user-1')}`)
      .send({ battleId: 123 });
    expect(response.status).toBe(400);
  });

  // ========================================
  // 业务错误
  // ========================================

  it('403: 调用者非参与者 → 403', async () => {
    mockQuery.mockResolvedValueOnce([buildBattleRow()]); // loadBattleForSettlement

    const response = await request(app)
      .post('/api/battle/result')
      .set('Authorization', `Bearer ${signToken('stranger')}`)
      .send({ battleId: 'b1' });

    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/participant/i);
    // 业务未通过 → 不进 transaction
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it('404: battle 不存在 → 404', async () => {
    mockQuery.mockResolvedValueOnce([]); // empty result

    const response = await request(app)
      .post('/api/battle/result')
      .set('Authorization', `Bearer ${signToken('user-1')}`)
      .send({ battleId: 'missing' });

    expect(response.status).toBe(404);
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it('409: status=pending → 409', async () => {
    mockQuery.mockResolvedValueOnce([buildBattleRow({ status: 'pending' })]);

    const response = await request(app)
      .post('/api/battle/result')
      .set('Authorization', `Bearer ${signToken('user-1')}`)
      .send({ battleId: 'b1' });

    expect(response.status).toBe(409);
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it('409: status=ongoing → 409', async () => {
    mockQuery.mockResolvedValueOnce([buildBattleRow({ status: 'ongoing' })]);

    const response = await request(app)
      .post('/api/battle/result')
      .set('Authorization', `Bearer ${signToken('user-1')}`)
      .send({ battleId: 'b1' });

    expect(response.status).toBe(409);
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  // ========================================
  // Happy path
  // ========================================

  it('200: p1 调用, p1 赢 → response 全字段断言', async () => {
    mockQuery.mockResolvedValueOnce([buildBattleRow()]);
    mockClientQuery.mockResolvedValue({ rowCount: 1 }); // transaction SQL 全成功
    mockQueryOne
      .mockResolvedValueOnce({ wins: 1, losses: 0, draws: 0 })
      .mockResolvedValueOnce({ wins: 0, losses: 1, draws: 0 });
    mockedRedis.keys.mockResolvedValueOnce(['battle:b1:positions', 'battle:b1:pieces']);
    mockedRedis.del.mockResolvedValueOnce(2);

    const response = await request(app)
      .post('/api/battle/result')
      .set('Authorization', `Bearer ${signToken('user-1')}`)
      .send({ battleId: 'b1' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({
      battleId: 'b1',
      status: 'finished',
      yourResult: 'win',
      winner: { userId: 'user-1', side: 'p1' },
      victoryType: 'kill_threshold',
      p1Stars: 6,
      p2Stars: 2,
      p1UserId: 'user-1',
      p2UserId: 'user-2',
      duration: 330,
      yourStats: { wins: 1, losses: 0, draws: 0 },
      opponentStats: { wins: 0, losses: 1, draws: 0 },
    });
    expect(typeof response.body.data.startedAt).toBe('string');
    expect(typeof response.body.data.finishedAt).toBe('string');

    // 进入 transaction 1 次
    expect(mockWithTransaction).toHaveBeenCalledTimes(1);
  });

  it('200: p2 调用, p1 赢 → yourResult=loss', async () => {
    mockQuery.mockResolvedValueOnce([buildBattleRow()]);
    mockClientQuery.mockResolvedValue({ rowCount: 1 });
    mockQueryOne
      .mockResolvedValueOnce({ wins: 0, losses: 1, draws: 0 }) // p2 stats
      .mockResolvedValueOnce({ wins: 1, losses: 0, draws: 0 }); // p1 stats
    mockedRedis.keys.mockResolvedValueOnce([]);
    mockedRedis.del.mockResolvedValueOnce(0);

    const response = await request(app)
      .post('/api/battle/result')
      .set('Authorization', `Bearer ${signToken('user-2')}`)
      .send({ battleId: 'b1' });

    expect(response.status).toBe(200);
    expect(response.body.data.yourResult).toBe('loss');
    expect(response.body.data.winner).toEqual({ userId: 'user-1', side: 'p1' });
    expect(response.body.data.yourStats).toEqual({ wins: 0, losses: 1, draws: 0 });
    expect(response.body.data.opponentStats).toEqual({ wins: 1, losses: 0, draws: 0 });
  });

  it('200: 平局 → yourResult=draw, winner=null', async () => {
    mockQuery.mockResolvedValueOnce([
      buildBattleRow({
        p1_stars: 6,
        p2_stars: 6,
        winner_player_id: null,
        victory_type: 'draw',
      }),
    ]);
    mockClientQuery.mockResolvedValue({ rowCount: 1 });
    mockQueryOne
      .mockResolvedValueOnce({ wins: 0, losses: 0, draws: 1 })
      .mockResolvedValueOnce({ wins: 0, losses: 0, draws: 1 });
    mockedRedis.keys.mockResolvedValueOnce([]);
    mockedRedis.del.mockResolvedValueOnce(0);

    const response = await request(app)
      .post('/api/battle/result')
      .set('Authorization', `Bearer ${signToken('user-1')}`)
      .send({ battleId: 'b1' });

    expect(response.status).toBe(200);
    expect(response.body.data.yourResult).toBe('draw');
    expect(response.body.data.winner).toBeNull();
    expect(response.body.data.victoryType).toBe('draw');
  });

  // ========================================
  // 幂等
  // ========================================

  it('200: 第二次调用 (settled_at 非空) → 跳过写入, response 一致', async () => {
    // 第二次: settled_at 已写入
    mockQuery.mockResolvedValueOnce([
      buildBattleRow({ settled_at: new Date('2026-06-20T10:06:00Z') }),
    ]);
    mockQueryOne
      .mockResolvedValueOnce({ wins: 1, losses: 0, draws: 0 })
      .mockResolvedValueOnce({ wins: 0, losses: 1, draws: 0 });
    mockedRedis.keys.mockResolvedValueOnce([]);
    mockedRedis.del.mockResolvedValueOnce(0);

    const response = await request(app)
      .post('/api/battle/result')
      .set('Authorization', `Bearer ${signToken('user-1')}`)
      .send({ battleId: 'b1' });

    expect(response.status).toBe(200);
    expect(response.body.data.yourResult).toBe('win');
    expect(response.body.data.yourStats).toEqual({ wins: 1, losses: 0, draws: 0 });

    // 关键断言: 第二次调用不进入 transaction,client.query 完全不被调用
    expect(mockWithTransaction).not.toHaveBeenCalled();
    expect(mockClientQuery).not.toHaveBeenCalled();
  });
});
