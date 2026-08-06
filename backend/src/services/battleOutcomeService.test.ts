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
const mockFinishSession = jest.fn();
const mockBroadcastBattleEnd = jest.fn();
const mockBroadcastBasesState = jest.fn();

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
  queryOne: jest.fn().mockResolvedValue(null),
  execute: mockExecute,
}));

jest.mock('./battleService', () => ({
  listCharactersInBattle: mockListCharactersInBattle,
}));

jest.mock('./battleSessionService', () => ({
  finishSession: mockFinishSession,
}));

jest.mock('../socket/battleStateBroadcaster', () => ({
  broadcastBattleEnd: mockBroadcastBattleEnd,
  broadcastBasesState: mockBroadcastBasesState,
}));

import { applyKillStars, applyBaseStars, checkWinCondition, recordVictory } from './battleOutcomeService';
import { BASES, BASE_RADIUS, WIN_THRESHOLD } from './battleOutcomeService';
import type { Server as IOServer } from 'socket.io';

function createMockIO(): IOServer {
  return {
    to: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    emit: jest.fn(),
  } as unknown as IOServer;
}

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

describe('applyBaseStars', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    // 默认 pieces 全 alive，positions 各异
    mockList.mockResolvedValue([
      { characterId: 'c1', playerId: 'p1', userId: 'u1', profession: 'warrior', name: 'A' },
      { characterId: 'c2', playerId: 'p1', userId: 'u1', profession: 'ranger', name: 'B' },
      { characterId: 'c3', playerId: 'p1', userId: 'u1', profession: 'mage', name: 'C' },
      { characterId: 'c4', playerId: 'p2', userId: 'u2', profession: 'warrior', name: 'D' },
      { characterId: 'c5', playerId: 'p2', userId: 'u2', profession: 'ranger', name: 'E' },
      { characterId: 'c6', playerId: 'p2', userId: 'u2', profession: 'mage', name: 'F' },
    ] as any);
    mockHGetAll.mockImplementation(async (key: string) => {
      if (key === 'battle:b1:pieces') {
        return {
          c1: JSON.stringify({ is_alive: true }),
          c2: JSON.stringify({ is_alive: true }),
          c3: JSON.stringify({ is_alive: true }),
          c4: JSON.stringify({ is_alive: true }),
          c5: JSON.stringify({ is_alive: true }),
          c6: JSON.stringify({ is_alive: true }),
        };
      }
      if (key === 'battle:b1:positions') {
        // 真实格式: key="x,y" → value=charId（默认 c1-c6 都在远离据点的角落，0 delta）
        return {
          '0,0': 'c1',
          '0,1': 'c2',
          '1,0': 'c3',
          '0,8': 'c4',
          '0,7': 'c5',
          '1,8': 'c6',
        };
      }
      return {};
    });
    mockGet.mockImplementation(async (key: string) => {
      if (key === 'battle:b1:stars:p1') return '0';
      if (key === 'battle:b1:stars:p2') return '0';
      return null;
    });
    mockIncrBy.mockImplementation(async (_key: string, increment: number) => increment);
    mockExecuteDb.mockResolvedValue({ rowCount: 1 });
  });

  it('p1 占 1: (3,3) 范围 p1=2 alive, p2=1 alive → p1 +1 star', async () => {
    mockHGetAll.mockImplementation(async (key: string) => {
      if (key === 'battle:b1:pieces') {
        return {
          c1: JSON.stringify({ is_alive: true }),
          c2: JSON.stringify({ is_alive: true }),
          c3: JSON.stringify({ is_alive: true }),
          c4: JSON.stringify({ is_alive: true }),
          c5: JSON.stringify({ is_alive: false }),
          c6: JSON.stringify({ is_alive: true }),
        };
      }
      if (key === 'battle:b1:positions') {
        // 真实格式: key="x,y" → value=charId
        // c1(3,3) 在 (3,3) 范围; c2(1,3) 在 (3,3) 范围但不在 (6,6) 范围;
        // c3(0,0) 不在任何据点范围; c4(4,3) 在 (3,3) 范围但不在 (6,6) 范围;
        // c6(8,0) 不在任何据点范围
        return {
          '3,3': 'c1',
          '1,3': 'c2',
          '0,0': 'c3',
          '4,3': 'c4',
          '8,8': 'c5',
          '8,0': 'c6',
        };
      }
      return {};
    });

    const result = await applyBaseStars('b1');

    expect(result.p1Delta).toBe(1);
    expect(result.p2Delta).toBe(0);
    expect(result.p1StarsAfter).toBe(1);
    expect(result.bases['3,3']).toBe('p1');
    expect(result.bases['6,6']).toBe('neutral');
  });

  it('p2 占 2: (3,3) p1=0 p2=3; (6,6) p1=0 p2=1 → p2 +2 stars', async () => {
    mockHGetAll.mockImplementation(async (key: string) => {
      if (key === 'battle:b1:pieces') {
        return {
          c1: JSON.stringify({ is_alive: true }),
          c2: JSON.stringify({ is_alive: true }),
          c3: JSON.stringify({ is_alive: true }),
          c4: JSON.stringify({ is_alive: true }),
          c5: JSON.stringify({ is_alive: true }),
          c6: JSON.stringify({ is_alive: true }),
        };
      }
      if (key === 'battle:b1:positions') {
        // 真实格式: key="x,y" → value=charId
        // p1 三子在 (0,*) 角落，远离两个据点; p2 占据 (3,3)/(4,3) (在 (3,3) 范围)
        // 和 (5,5) (同时在 (3,3) 与 (6,6) 范围)
        return {
          '0,0': 'c1',
          '0,1': 'c2',
          '0,2': 'c3',
          '3,3': 'c4',
          '4,3': 'c5',
          '5,5': 'c6',
        };
      }
      return {};
    });

    const result = await applyBaseStars('b1');

    expect(result.p1Delta).toBe(0);
    expect(result.p2Delta).toBe(2);
    expect(result.p2StarsAfter).toBe(2);
    expect(result.bases['3,3']).toBe('p2');
    expect(result.bases['6,6']).toBe('p2');
  });

  it('neutral: (3,3) p1=2 p2=2; (6,6) p1=3 p2=0 → p1 +1 (仅 6,6)', async () => {
    mockHGetAll.mockImplementation(async (key: string) => {
      if (key === 'battle:b1:pieces') {
        return {
          c1: JSON.stringify({ is_alive: true }),
          c2: JSON.stringify({ is_alive: true }),
          c3: JSON.stringify({ is_alive: true }),
          c4: JSON.stringify({ is_alive: true }),
          c5: JSON.stringify({ is_alive: true }),
          c6: JSON.stringify({ is_alive: true }),
        };
      }
      if (key === 'battle:b1:positions') {
        // 真实格式: key="x,y" → value=charId
        // c1(4,4) c2(5,5): p1 在 (3,3)∩(6,6) overlap
        // c3(6,6): p1 在 (6,6) 范围 only
        // c4(1,1) c5(2,2): p2 在 (3,3) 范围 only
        // c6(0,0): p2 远离两据点
        return {
          '4,4': 'c1',
          '5,5': 'c2',
          '6,6': 'c3',
          '1,1': 'c4',
          '2,2': 'c5',
          '0,0': 'c6',
        };
      }
      return {};
    });

    const result = await applyBaseStars('b1');

    expect(result.p1Delta).toBe(1);
    expect(result.bases['3,3']).toBe('neutral');
    expect(result.bases['6,6']).toBe('p1');
  });

  it('both neutral: (3,3) p1=1 p2=1; (6,6) p1=1 p2=1 → 0 delta', async () => {
    mockHGetAll.mockImplementation(async (key: string) => {
      if (key === 'battle:b1:pieces') {
        return {
          c1: JSON.stringify({ is_alive: true }),
          c2: JSON.stringify({ is_alive: true }),
          c3: JSON.stringify({ is_alive: true }),
          c4: JSON.stringify({ is_alive: true }),
          c5: JSON.stringify({ is_alive: true }),
          c6: JSON.stringify({ is_alive: true }),
        };
      }
      if (key === 'battle:b1:positions') {
        // 真实格式: key="x,y" → value=charId
        // c1(3,3) 在 (3,3) 范围 only; c2(8,8) 在 (6,6) 范围 only;
        // c3(0,0) 远离两据点; c4(5,2) 在 (3,3) 范围 only;
        // c5(8,6) 在 (6,6) 范围 only; c6(0,8) 远离两据点
        return {
          '3,3': 'c1',
          '8,8': 'c2',
          '0,0': 'c3',
          '5,2': 'c4',
          '8,6': 'c5',
          '0,8': 'c6',
        };
      }
      return {};
    });

    const result = await applyBaseStars('b1');

    expect(result.p1Delta).toBe(0);
    expect(result.p2Delta).toBe(0);
    expect(result.bases['3,3']).toBe('neutral');
    expect(result.bases['6,6']).toBe('neutral');
  });

  it('empty ranges: 所有棋子都出 (3,3) 范围 (在 8,8) → 0 delta', async () => {
    // 默认 mockHGetAll 已经把 c1-c6 放在 (8,8)
    const result = await applyBaseStars('b1');

    expect(result.p1Delta).toBe(0);
    expect(result.p2Delta).toBe(0);
    expect(result.bases['3,3']).toBe('neutral');
    expect(result.bases['6,6']).toBe('neutral');
  });
});

describe('checkWinCondition', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    // 默认 stars 0/0
    mockGet.mockImplementation(async (key: string) => {
      if (key === 'battle:b1:stars:p1') return '0';
      if (key === 'battle:b1:stars:p2') return '0';
      return null;
    });
  });

  it('win p1: p1=6, p2=2 → win p1', async () => {
    mockGet.mockImplementation(async (key: string) => {
      if (key === 'battle:b1:stars:p1') return '6';
      if (key === 'battle:b1:stars:p2') return '2';
      return null;
    });
    const result = await checkWinCondition('b1');
    expect(result).toEqual({ status: 'win', winnerSide: 'p1', p1Stars: 6, p2Stars: 2 });
  });

  it('win p2: p1=4, p2=6 → win p2', async () => {
    mockGet.mockImplementation(async (key: string) => {
      if (key === 'battle:b1:stars:p1') return '4';
      if (key === 'battle:b1:stars:p2') return '6';
      return null;
    });
    const result = await checkWinCondition('b1');
    expect(result).toEqual({ status: 'win', winnerSide: 'p2', p1Stars: 4, p2Stars: 6 });
  });

  it('draw: p1=6, p2=6 → draw', async () => {
    mockGet.mockImplementation(async (key: string) => {
      if (key === 'battle:b1:stars:p1') return '6';
      if (key === 'battle:b1:stars:p2') return '6';
      return null;
    });
    const result = await checkWinCondition('b1');
    expect(result).toEqual({ status: 'draw', p1Stars: 6, p2Stars: 6 });
  });

  it('not_over: p1=5, p2=3 → not_over', async () => {
    mockGet.mockImplementation(async (key: string) => {
      if (key === 'battle:b1:stars:p1') return '5';
      if (key === 'battle:b1:stars:p2') return '3';
      return null;
    });
    const result = await checkWinCondition('b1');
    expect(result).toEqual({ status: 'not_over', p1Stars: 5, p2Stars: 3 });
  });
});

describe('recordVictory', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockFinishSession.mockResolvedValue({ success: true, state: undefined as any });
    mockBroadcastBattleEnd.mockResolvedValue(undefined);
  });

  // Helper: mockQuery 根据 SQL 字符串返回不同结果
  // 1. SELECT b.player1_id, b.player2_id, p1.user_id, p2.user_id ... LEFT JOIN players ... → JOIN row
  function setupRecordVictoryMocks() {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('LEFT JOIN players')) {
        return [
          {
            player1_id: 'player-1',
            player2_id: 'player-2',
            p1_user_id: 'u1',
            p2_user_id: 'u2',
          },
        ];
      }
      return [];
    });
  }

  it('win: DB UPDATE winner + status=finished + finishSession + broadcast', async () => {
    mockExecuteDb.mockResolvedValue({ rowCount: 1 });
    setupRecordVictoryMocks();

    const io = createMockIO();
    await recordVictory(io, 'b1', {
      status: 'win',
      winnerSide: 'p1',
      p1Stars: 6,
      p2Stars: 2,
    });

    expect(mockExecuteDb).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE battles'),
      expect.arrayContaining(['player-1', 'kill_threshold', 'b1'])
    );
    expect(mockFinishSession).toHaveBeenCalledWith('b1');
    expect(mockBroadcastBattleEnd).toHaveBeenCalledWith(
      io,
      'b1',
      expect.objectContaining({
        winnerUserId: 'u1',
        winnerSide: 'p1',
        victoryType: 'kill_threshold',
        p1Stars: 6,
        p2Stars: 2,
      })
    );
  });

  it('win via base: victoryType=base_threshold', async () => {
    mockExecuteDb.mockResolvedValue({ rowCount: 1 });
    setupRecordVictoryMocks();

    const io = createMockIO();
    await recordVictory(
      io,
      'b1',
      {
        status: 'win',
        winnerSide: 'p2',
        p1Stars: 4,
        p2Stars: 6,
      },
      'base'
    );

    expect(mockBroadcastBattleEnd).toHaveBeenCalledWith(
      io,
      'b1',
      expect.objectContaining({
        winnerUserId: 'u2',
        winnerSide: 'p2',
        victoryType: 'base_threshold',
      })
    );
  });

  it('draw: winnerUserId=null, winnerSide=null, victoryType=draw', async () => {
    mockExecuteDb.mockResolvedValue({ rowCount: 1 });
    setupRecordVictoryMocks();

    const io = createMockIO();
    await recordVictory(io, 'b1', {
      status: 'draw',
      p1Stars: 6,
      p2Stars: 6,
    });

    expect(mockExecuteDb).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE battles'),
      expect.arrayContaining([null, 'draw', 'b1'])
    );
    expect(mockBroadcastBattleEnd).toHaveBeenCalledWith(
      io,
      'b1',
      expect.objectContaining({
        winnerUserId: null,
        winnerSide: null,
        victoryType: 'draw',
      })
    );
  });

  it('finishSession 失败: 仍 broadcast (best-effort, 不 throw)', async () => {
    mockExecuteDb.mockResolvedValue({ rowCount: 1 });
    setupRecordVictoryMocks();
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockFinishSession.mockRejectedValue(new Error('finishSession down'));

    const io = createMockIO();
    await expect(
      recordVictory(io, 'b1', {
        status: 'win',
        winnerSide: 'p1',
        p1Stars: 6,
        p2Stars: 2,
      })
    ).resolves.not.toThrow();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[T052] recordVictory: finishSession failed'),
      expect.any(Error)
    );
    expect(mockBroadcastBattleEnd).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
