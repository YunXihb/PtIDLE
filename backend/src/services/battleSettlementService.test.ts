// T054 battleSettlementService 单元测试
// 总计 10 cases across 5 describe blocks
// 覆盖 happy path (win/loss/draw) + 幂等 + 4 error branches + redis 失败 + transaction 回滚

// ============== Mocks ==============
// 注意：jest.mock + const mockXxx 必须先于 import（ts-jest TDZ pitfall）

const mockRedisKeys = jest.fn();
const mockRedisDel = jest.fn();
const mockRedisGet = jest.fn();
const mockRedisHGetAll = jest.fn();
const mockRedisHGet = jest.fn();

const mockQuery = jest.fn();
const mockQueryOne = jest.fn();
const mockClientQuery = jest.fn();
const mockWithTransaction = jest.fn();

jest.mock('../config/redis', () => ({
  redisClient: {
    keys: mockRedisKeys,
    del: mockRedisDel,
    get: mockRedisGet,
    hGetAll: mockRedisHGetAll,
    hGet: mockRedisHGet,
  },
}));

jest.mock('../config/database', () => ({
  query: mockQuery,
  queryOne: mockQueryOne,
  withTransaction: mockWithTransaction,
}));

// 默认 mockClient：query 方法可被每个 case override
const mockClient = { query: mockClientQuery };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(mockWithTransaction as jest.Mock).mockImplementation(
  async (fn: (client: any) => Promise<any>) => fn(mockClient)
);

import { settleBattle } from './battleSettlementService';

// ============== Helpers ==============

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

/**
 * 默认 happy path battle row：p1 赢了，stars=6 vs 2
 */
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
 * 装一个标准 happy path：
 *   - battle settled_at = null（首次结算）
 *   - 双方 wins=0/losses=0/draws=0 → 结算后 p1.wins=1, p2.losses=1
 */
function setupHappyPathMocks(rowOverrides: Partial<MockBattleRow> = {}): void {
  const row = buildBattleRow(rowOverrides);

  // 1st query: loadBattleForSettlement
  mockQuery.mockResolvedValueOnce([row]);
  // 2nd & 3rd: loadPlayerStats × 2 (yourStats, opponentStats)
  mockQueryOne
    .mockResolvedValueOnce({ wins: 1, losses: 0, draws: 0 }) // yourStats after UPDATE
    .mockResolvedValueOnce({ wins: 0, losses: 1, draws: 0 }); // opponentStats after UPDATE
  // Redis cleanup: 2 keys
  mockRedisKeys.mockResolvedValueOnce(['battle:b1:positions', 'battle:b1:pieces']);
  mockRedisDel.mockResolvedValueOnce(2);
}

/**
 * 装 loadBattleForSettlement 返回的 query 结果（不下发其他 mock,各 case 自行补）
 */
function setupLoadBattleOnly(row: MockBattleRow | null): void {
  if (row === null) {
    mockQuery.mockResolvedValueOnce([]);
  } else {
    mockQuery.mockResolvedValueOnce([row]);
  }
}

// ========================================
// 1-3: Happy path (win / loss / draw)
// ========================================

describe('settleBattle - happy path', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // 重新装 withTransaction impl,因为 clearAllMocks 会清掉
    (mockWithTransaction as jest.Mock).mockImplementation(
      async (fn: (client: any) => Promise<any>) => fn(mockClient)
    );
  });

  it('1. p1 调用, p1 赢 → p1.wins+=1, p2.losses+=1, 双 pbh 写入, settled_at 写入', async () => {
    setupHappyPathMocks();

    const result = await settleBattle('b1', 'user-1');

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 响应字段断言
    expect(result.data.battleId).toBe('b1');
    expect(result.data.status).toBe('finished');
    expect(result.data.yourResult).toBe('win');
    expect(result.data.winner).toEqual({ userId: 'user-1', side: 'p1' });
    expect(result.data.victoryType).toBe('kill_threshold');
    expect(result.data.p1Stars).toBe(6);
    expect(result.data.p2Stars).toBe(2);
    expect(result.data.p1UserId).toBe('user-1');
    expect(result.data.p2UserId).toBe('user-2');
    expect(result.data.duration).toBe(330); // 5分30秒
    expect(result.data.yourStats).toEqual({ wins: 1, losses: 0, draws: 0 });
    expect(result.data.opponentStats).toEqual({ wins: 0, losses: 1, draws: 0 });

    // 4a: 双方 players UPDATE wins/losses
    const calls = mockClientQuery.mock.calls.map((c) => c[0]);
    const playersWinsUpdate = calls.find(
      (sql) => typeof sql === 'string' && sql.includes('UPDATE players') && sql.includes('wins')
    );
    const playersLossesUpdate = calls.find(
      (sql) => typeof sql === 'string' && sql.includes('UPDATE players') && sql.includes('losses')
    );
    expect(playersWinsUpdate).toBeDefined();
    expect(playersLossesUpdate).toBeDefined();

    // 4b: 双 player_battle_history INSERT
    const pbhInserts = calls.filter(
      (sql) => typeof sql === 'string' && sql.includes('INSERT INTO player_battle_history')
    );
    expect(pbhInserts.length).toBe(2);

    // 4c: UPDATE battles SET settled_at
    const settledUpdate = calls.find(
      (sql) => typeof sql === 'string' && sql.includes('UPDATE battles') && sql.includes('settled_at')
    );
    expect(settledUpdate).toBeDefined();

    // Redis 清理：keys + del
    expect(mockRedisKeys).toHaveBeenCalledWith('battle:b1:*');
    expect(mockRedisDel).toHaveBeenCalledWith(['battle:b1:positions', 'battle:b1:pieces']);
  });

  it('2. p2 调用, p2 赢 → p2.wins+=1, p1.losses+=1', async () => {
    // p2 是赢家
    setupHappyPathMocks({
      p1_stars: 2,
      p2_stars: 6,
      winner_player_id: 'player-2',
      victory_type: 'base_threshold',
    });

    const result = await settleBattle('b1', 'user-2');

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.yourResult).toBe('win');
    expect(result.data.winner).toEqual({ userId: 'user-2', side: 'p2' });
    expect(result.data.victoryType).toBe('base_threshold');
    expect(result.data.yourStats).toEqual({ wins: 1, losses: 0, draws: 0 });
    expect(result.data.opponentStats).toEqual({ wins: 0, losses: 1, draws: 0 });

    // 验证 p2 UPDATE wins（你这边）+ p1 UPDATE losses（对手）
    const calls = mockClientQuery.mock.calls.map((c) => c[0]);
    const winsUpdate = calls.find(
      (sql: string) => sql.includes('UPDATE players') && sql.includes('wins')
    );
    const lossesUpdate = calls.find(
      (sql: string) => sql.includes('UPDATE players') && sql.includes('losses')
    );
    expect(winsUpdate).toBeDefined();
    expect(lossesUpdate).toBeDefined();
  });

  it('3. 平局 → p1.draws+=1, p2.draws+=1', async () => {
    setupHappyPathMocks({
      p1_stars: 6,
      p2_stars: 6,
      winner_player_id: null,
      victory_type: 'draw',
    });

    const result = await settleBattle('b1', 'user-1');

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.yourResult).toBe('draw');
    expect(result.data.winner).toBeNull();
    expect(result.data.victoryType).toBe('draw');

    // UPDATE players SET draws
    const calls = mockClientQuery.mock.calls.map((c) => c[0]);
    const drawsUpdates = calls.filter(
      (sql: string) => sql.includes('UPDATE players') && sql.includes('draws')
    );
    expect(drawsUpdates.length).toBeGreaterThanOrEqual(1);
  });
});

// ========================================
// 4: 幂等检测
// ========================================

describe('settleBattle - idempotency', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (mockWithTransaction as jest.Mock).mockImplementation(
      async (fn: (client: any) => Promise<any>) => fn(mockClient)
    );
  });

  it('4. 第二次调用 (settled_at 非空) → 跳过写入, response 数据相同', async () => {
    // 第二次调用: settled_at 已存在
    setupLoadBattleOnly(buildBattleRow({ settled_at: new Date('2026-06-20T10:06:00Z') }));
    mockQueryOne
      .mockResolvedValueOnce({ wins: 1, losses: 0, draws: 0 })
      .mockResolvedValueOnce({ wins: 0, losses: 1, draws: 0 });
    mockRedisKeys.mockResolvedValueOnce([]);
    mockRedisDel.mockResolvedValueOnce(0);

    const result = await settleBattle('b1', 'user-1');

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.yourResult).toBe('win');
    expect(result.data.yourStats).toEqual({ wins: 1, losses: 0, draws: 0 });

    // withTransaction 完全没被调用
    expect(mockWithTransaction).not.toHaveBeenCalled();
    // client.query 完全没被调用
    expect(mockClientQuery).not.toHaveBeenCalled();
  });
});

// ========================================
// 5-8: 错误分支
// ========================================

describe('settleBattle - error branches', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (mockWithTransaction as jest.Mock).mockImplementation(
      async (fn: (client: any) => Promise<any>) => fn(mockClient)
    );
  });

  it('5. battle 不存在 → battle_not_found', async () => {
    setupLoadBattleOnly(null);

    const result = await settleBattle('missing', 'user-1');

    expect(result).toEqual({ ok: false, error: 'battle_not_found' });
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it('6. 调用者非参与者 → not_participant', async () => {
    setupLoadBattleOnly(buildBattleRow()); // p1=p1-user, p2=p2-user

    const result = await settleBattle('b1', 'user-stranger');

    expect(result).toEqual({ ok: false, error: 'not_participant' });
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it('7. status=pending → battle_not_finished', async () => {
    setupLoadBattleOnly(buildBattleRow({ status: 'pending' }));

    const result = await settleBattle('b1', 'user-1');

    expect(result).toEqual({ ok: false, error: 'battle_not_finished' });
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it('8. status=ongoing → battle_not_finished', async () => {
    setupLoadBattleOnly(buildBattleRow({ status: 'ongoing' }));

    const result = await settleBattle('b1', 'user-1');

    expect(result).toEqual({ ok: false, error: 'battle_not_finished' });
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });
});

// ========================================
// 9: Redis 清理失败
// ========================================

describe('settleBattle - redis cleanup failure', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    (mockWithTransaction as jest.Mock).mockImplementation(
      async (fn: (client: any) => Promise<any>) => fn(mockClient)
    );
    // 抑制 console.error 噪声(afterEach 还原)
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('9. redis.keys 抛错 → 仍返 ok=true + 玩家数据, console.error 出现', async () => {
    setupLoadBattleOnly(buildBattleRow()); // settled_at = null → 进入 transaction
    mockClientQuery.mockResolvedValue({ rowCount: 1 }); // transaction SQL 全部成功
    mockQueryOne
      .mockResolvedValueOnce({ wins: 1, losses: 0, draws: 0 })
      .mockResolvedValueOnce({ wins: 0, losses: 1, draws: 0 });
    mockRedisKeys.mockRejectedValueOnce(new Error('Redis connection lost'));

    const result = await settleBattle('b1', 'user-1');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.yourStats).toEqual({ wins: 1, losses: 0, draws: 0 });
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('[T054] cleanupAllBattleRedisKeys failed'),
      expect.any(Error)
    );
  });
});

// ========================================
// 10: withTransaction 回滚
// ========================================

describe('settleBattle - transaction rollback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('10. 首个 client.query 抛错 → 后续 pbh INSERT / battles UPDATE 都不执行', async () => {
    setupLoadBattleOnly(buildBattleRow()); // settled_at = null → 进入 transaction

    // 让 withTransaction 真实模拟 throw 行为（不 catch,让 fn 抛出的错透传）
    (mockWithTransaction as jest.Mock).mockImplementation(
      async (fn: (client: any) => Promise<any>) => fn(mockClient)
    );

    // 首个 client.query 抛错（模拟 players UPDATE 失败）
    mockClientQuery.mockRejectedValueOnce(new Error('boom'));

    await expect(settleBattle('b1', 'user-1')).rejects.toThrow('boom');

    // 只有第一次 client.query 被调用（导致抛错的那次）
    expect(mockClientQuery).toHaveBeenCalledTimes(1);

    // 验证后续 pbh INSERT 和 battles UPDATE 没有执行
    const allSql = mockClientQuery.mock.calls.map((c) => c[0]);
    const pbhInserts = allSql.filter(
      (sql) => typeof sql === 'string' && sql.includes('INSERT INTO player_battle_history')
    );
    const battlesUpdates = allSql.filter(
      (sql) => typeof sql === 'string' && sql.includes('UPDATE battles')
    );
    expect(pbhInserts.length).toBe(0);
    expect(battlesUpdates.length).toBe(0);
  });
});
