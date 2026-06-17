// T052 battleOutcomeService 单元测试
// 总计 18 cases across 4 describe blocks (Tasks 3-6 逐步填充)

// ============== Mocks ==============
// 注意：jest.mock + const mockXxx 必须先于 import（ts-jest TDZ pitfall）

const mockRedisHGetAll = jest.fn();
const mockRedisGet = jest.fn();
const mockRedisIncrBy = jest.fn();
const mockRedisSet = jest.fn();
const mockRedisDel = jest.fn();
const mockRedisHSet = jest.fn();
const mockRedisHGet = jest.fn();
const mockRedisDecr = jest.fn();

const mockQuery = jest.fn();
const mockExecute = jest.fn();
const mockListCharactersInBattle = jest.fn();

jest.mock('../config/redis', () => ({
  redisClient: {
    hGetAll: mockRedisHGetAll,
    get: mockRedisGet,
    incrBy: mockRedisIncrBy,
    decr: mockRedisDecr,
    set: mockRedisSet,
    del: mockRedisDel,
    hSet: mockRedisHSet,
    hGet: mockRedisHGet,
  },
}));

jest.mock('../config/database', () => ({
  query: mockQuery,
  execute: mockExecute,
}));

jest.mock('./battleService', () => ({
  listCharactersInBattle: mockListCharactersInBattle,
}));

import { applyKillStars } from './battleOutcomeService';
import { BASES, BASE_RADIUS, WIN_THRESHOLD } from './battleOutcomeService';

const mockList = mockListCharactersInBattle as jest.MockedFunction<typeof mockListCharactersInBattle>;
const mockHGetAll = mockRedisHGetAll as jest.MockedFunction<typeof mockRedisHGetAll>;
const mockGet = mockRedisGet as jest.MockedFunction<typeof mockRedisGet>;
const mockIncrBy = mockRedisIncrBy as jest.MockedFunction<typeof mockRedisIncrBy>;
const mockExecuteDb = mockExecute as jest.MockedFunction<typeof mockExecute>;
const mockSetRedis = mockRedisSet as jest.MockedFunction<typeof mockRedisSet>;
const mockDecr = mockRedisDecr as jest.MockedFunction<typeof mockRedisDecr>;

describe('battleOutcomeService - constants', () => {
  it('BASES 包含 (3,3) 和 (6,6) 两个据点', () => {
    expect(BASES).toHaveLength(2);
    expect(BASES[0]).toEqual({ x: 3, y: 3, key: '3,3' });
    expect(BASES[1]).toEqual({ x: 6, y: 6, key: '6,6' });
  });

  it('BASE_RADIUS = 2', () => {
    expect(BASE_RADIUS).toBe(2);
  });

  it('WIN_THRESHOLD = 6', () => {
    expect(WIN_THRESHOLD).toBe(6);
  });
});

describe('applyKillStars', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    // 默认：6 角色均 alive，pieces 全部 alive
    mockList.mockResolvedValue([
      { characterId: 'c1', playerId: 'p1', userId: 'u1', profession: 'warrior', name: 'A' },
      { characterId: 'c2', playerId: 'p1', userId: 'u1', profession: 'ranger', name: 'B' },
      { characterId: 'c3', playerId: 'p1', userId: 'u1', profession: 'mage', name: 'C' },
      { characterId: 'c4', playerId: 'p2', userId: 'u2', profession: 'warrior', name: 'D' },
      { characterId: 'c5', playerId: 'p2', userId: 'u2', profession: 'ranger', name: 'E' },
      { characterId: 'c6', playerId: 'p2', userId: 'u2', profession: 'mage', name: 'F' },
    ] as any);
    // 默认所有 alive
    mockHGetAll.mockResolvedValue({
      c1: JSON.stringify({ is_alive: true }),
      c2: JSON.stringify({ is_alive: true }),
      c3: JSON.stringify({ is_alive: true }),
      c4: JSON.stringify({ is_alive: true }),
      c5: JSON.stringify({ is_alive: true }),
      c6: JSON.stringify({ is_alive: true }),
    });
    // 默认 stars 0/0
    mockGet.mockImplementation(async (key: string) => {
      if (key === 'battle:b1:stars:p1') return '0';
      if (key === 'battle:b1:stars:p2') return '0';
      return null;
    });
    mockIncrBy.mockImplementation(async (_key: string, increment: number) => increment);
    mockExecuteDb.mockResolvedValue({ rowCount: 1 });
    mockDecr.mockResolvedValue(0);
  });

  it('1 kill: p1 杀 1 个 p2 棋子 → p1StarsAfter=1', async () => {
    mockHGetAll.mockResolvedValue({
      c1: JSON.stringify({ is_alive: true }),
      c2: JSON.stringify({ is_alive: true }),
      c3: JSON.stringify({ is_alive: true }),
      c4: JSON.stringify({ is_alive: false }),
      c5: JSON.stringify({ is_alive: true }),
      c6: JSON.stringify({ is_alive: true }),
    });
    const preMap = { c1: true, c2: true, c3: true, c4: true, c5: true, c6: true };

    const result = await applyKillStars('b1', preMap);

    expect(result.p1Delta).toBe(1);
    expect(result.p2Delta).toBe(0);
    expect(result.p1StarsAfter).toBe(1);
    expect(result.p2StarsAfter).toBe(0);
    expect(mockIncrBy).toHaveBeenCalledWith('battle:b1:stars:p1', 1);
  });

  it('0 kill: is_alive 不变 → 0 delta', async () => {
    const preMap = { c1: true, c2: true, c3: true, c4: true, c5: true, c6: true };

    const result = await applyKillStars('b1', preMap);

    expect(result.p1Delta).toBe(0);
    expect(result.p2Delta).toBe(0);
    expect(result.p1StarsAfter).toBe(0);
    expect(result.p2StarsAfter).toBe(0);
    expect(mockIncrBy).not.toHaveBeenCalled();
  });

  it('multi kill: p1 AOE 杀 2 个 p2 棋子 → p1StarsAfter=2', async () => {
    mockHGetAll.mockResolvedValue({
      c1: JSON.stringify({ is_alive: true }),
      c2: JSON.stringify({ is_alive: true }),
      c3: JSON.stringify({ is_alive: true }),
      c4: JSON.stringify({ is_alive: false }),
      c5: JSON.stringify({ is_alive: false }),
      c6: JSON.stringify({ is_alive: true }),
    });
    const preMap = { c1: true, c2: true, c3: true, c4: true, c5: true, c6: true };

    const result = await applyKillStars('b1', preMap);

    expect(result.p1Delta).toBe(2);
    expect(result.p2Delta).toBe(0);
    expect(result.p1StarsAfter).toBe(2);
    expect(mockIncrBy).toHaveBeenCalledWith('battle:b1:stars:p1', 2);
  });

  it('burn kill: p2 棋子 burn tick 死亡 → p1 杀 (计入击杀)', async () => {
    mockHGetAll.mockResolvedValue({
      c1: JSON.stringify({ is_alive: true }),
      c2: JSON.stringify({ is_alive: true }),
      c3: JSON.stringify({ is_alive: true }),
      c4: JSON.stringify({ is_alive: false }),
      c5: JSON.stringify({ is_alive: true }),
      c6: JSON.stringify({ is_alive: true }),
    });
    const preMap = { c1: true, c2: true, c3: true, c4: true, c5: true, c6: true };

    const result = await applyKillStars('b1', preMap);

    expect(result.p1Delta).toBe(1);
    expect(result.p1StarsAfter).toBe(1);
  });

  it('finished short-circuit: pieces 已清空 → return 0 delta (不 crash)', async () => {
    mockHGetAll.mockResolvedValue({});
    mockList.mockResolvedValue([]);

    const result = await applyKillStars('b1', {});

    expect(result.p1Delta).toBe(0);
    expect(result.p2Delta).toBe(0);
  });
});
