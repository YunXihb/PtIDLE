// T055 wsValidation 单元测试
// 总计 13 cases
// 覆盖 happy path + 3 类跨切校验失败 + 降级策略 + join 入口

// ============== Mocks ==============
// 注意：jest.mock + const mockXxx 必须先于 import（ts-jest TDZ pitfall）

const mockEval = jest.fn();
const mockQueryOne = jest.fn();

jest.mock('../config/redis', () => ({
  redisClient: {
    eval: mockEval,
  },
}));

jest.mock('../config/database', () => ({
  queryOne: mockQueryOne,
}));

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _refs = { mockEval, mockQueryOne };

// Imports must come AFTER all jest.mock calls
import {
  validateOperationContext,
  validateJoinContext,
  checkRoomMembership,
  checkRateLimit,
  RATE_LIMIT_MAX_PER_WINDOW,
  RATE_LIMIT_WINDOW_SEC,
} from './wsValidation';
import type { BattleSocket } from './wsValidation';

// ============== Helpers ==============

/**
 * 构造一个 mock socket.io socket
 * - rooms: 默认包含目标 battle room（可被测试覆盖）
 * - data.userId: 默认 'user-1'
 */
function createMockSocket(opts: {
  battleRoom?: string;
  userId?: string;
} = {}): BattleSocket {
  const rooms = new Set<string>();
  rooms.add('socket-id-mock'); // socket.io 默认自身房间
  if (opts.battleRoom) rooms.add(opts.battleRoom);

  return {
    rooms,
    data: { userId: opts.userId ?? 'user-1' },
  } as unknown as BattleSocket;
}

/**
 * 默认 happy path 配置：
 *   - socket 在 battle:battle-1 房间
 *   - DB 返回 status='ongoing'
 *   - Redis eval 返回 count=1
 */
function setupHappyPath() {
  mockQueryOne.mockResolvedValue({ status: 'ongoing' });
  mockEval.mockResolvedValue(1);
}

beforeEach(() => {
  jest.clearAllMocks();
  // 静默降级日志（测试 fail-open 路径会触发 console.error）
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ========================================
// 1. checkRoomMembership（同步 helper）
// ========================================

describe('checkRoomMembership', () => {
  it('socket 在目标 battle room → ok', () => {
    const socket = createMockSocket({ battleRoom: 'battle:battle-1' });
    expect(checkRoomMembership(socket, 'battle-1')).toEqual({ ok: true });
  });

  it('socket 不在目标 battle room → not_in_room', () => {
    const socket = createMockSocket({ battleRoom: 'battle:battle-OTHER' });
    const result = checkRoomMembership(socket, 'battle-1');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('not_in_room');
      expect(result.message).toContain('battle-1');
    }
  });

  it('socket 只在自身 room → not_in_room（从未 join 过 battle）', () => {
    const socket = createMockSocket(); // 默认无 battleRoom
    const result = checkRoomMembership(socket, 'battle-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not_in_room');
  });
});

// ========================================
// 2. validateOperationContext — happy path & 跨切校验
// ========================================

describe('validateOperationContext', () => {
  it('case 1: happy path — 全通过', async () => {
    setupHappyPath();
    const socket = createMockSocket({ battleRoom: 'battle:battle-1' });
    const result = await validateOperationContext(socket, {
      battleId: 'battle-1',
      userId: 'user-1',
      eventName: 'battle:move',
    });
    expect(result).toEqual({ ok: true });
    expect(mockQueryOne).toHaveBeenCalledWith(
      `SELECT status FROM battles WHERE id = $1`,
      ['battle-1']
    );
    expect(mockEval).toHaveBeenCalledTimes(1);
  });

  it('case 2: socket 不在 room → not_in_room（fail-fast，不调 DB/Redis）', async () => {
    const socket = createMockSocket({ battleRoom: 'battle:battle-OTHER' });
    const result = await validateOperationContext(socket, {
      battleId: 'battle-1',
      userId: 'user-1',
      eventName: 'battle:move',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not_in_room');
    // fail-fast: 后续步骤不应执行
    expect(mockQueryOne).not.toHaveBeenCalled();
    expect(mockEval).not.toHaveBeenCalled();
  });

  it('case 3: battle 不存在（DB 返回 null） → battle_not_found', async () => {
    mockQueryOne.mockResolvedValue(null);
    const socket = createMockSocket({ battleRoom: 'battle:battle-1' });
    const result = await validateOperationContext(socket, {
      battleId: 'battle-1',
      userId: 'user-1',
      eventName: 'battle:move',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('battle_not_found');
      expect(result.message).toContain('not found');
    }
    // status 检查失败 → rate limit 不应执行
    expect(mockEval).not.toHaveBeenCalled();
  });

  it("case 4: status='pending' → battle_not_ongoing", async () => {
    mockQueryOne.mockResolvedValue({ status: 'pending' });
    const socket = createMockSocket({ battleRoom: 'battle:battle-1' });
    const result = await validateOperationContext(socket, {
      battleId: 'battle-1',
      userId: 'user-1',
      eventName: 'battle:move',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('battle_not_ongoing');
      expect(result.message).toContain('pending');
    }
    expect(mockEval).not.toHaveBeenCalled();
  });

  it("case 5: status='finished' → battle_not_ongoing", async () => {
    mockQueryOne.mockResolvedValue({ status: 'finished' });
    const socket = createMockSocket({ battleRoom: 'battle:battle-1' });
    const result = await validateOperationContext(socket, {
      battleId: 'battle-1',
      userId: 'user-1',
      eventName: 'battle:move',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('battle_not_ongoing');
  });
});

// ========================================
// 3. Rate limit（核心：固定窗口计数器）
// ========================================

describe('validateOperationContext — rate limit', () => {
  beforeEach(() => {
    // 默认 status check 通过
    mockQueryOne.mockResolvedValue({ status: 'ongoing' });
  });

  it('case 6: rate-limit 第 1 次 → ok (count=1, EXPIRE 被调)', async () => {
    mockEval.mockResolvedValue(1);
    const socket = createMockSocket({ battleRoom: 'battle:battle-1' });
    const result = await validateOperationContext(socket, {
      battleId: 'battle-1',
      userId: 'user-1',
      eventName: 'battle:move',
    });
    expect(result).toEqual({ ok: true });
    // Lua 传入 key + window_seconds
    expect(mockEval).toHaveBeenCalledWith(
      expect.stringContaining('INCR'),
      expect.objectContaining({
        keys: ['rl:ws:user:user-1:battle:move'],
        arguments: [String(RATE_LIMIT_WINDOW_SEC)],
      })
    );
  });

  it(`case 7: rate-limit 第 ${RATE_LIMIT_MAX_PER_WINDOW} 次 → ok (count=${RATE_LIMIT_MAX_PER_WINDOW})`, async () => {
    mockEval.mockResolvedValue(RATE_LIMIT_MAX_PER_WINDOW);
    const socket = createMockSocket({ battleRoom: 'battle:battle-1' });
    const result = await validateOperationContext(socket, {
      battleId: 'battle-1',
      userId: 'user-1',
      eventName: 'battle:move',
    });
    expect(result).toEqual({ ok: true });
  });

  it(`case 8: rate-limit 第 ${RATE_LIMIT_MAX_PER_WINDOW + 1} 次 → rate_limited`, async () => {
    mockEval.mockResolvedValue(RATE_LIMIT_MAX_PER_WINDOW + 1);
    const socket = createMockSocket({ battleRoom: 'battle:battle-1' });
    const result = await validateOperationContext(socket, {
      battleId: 'battle-1',
      userId: 'user-1',
      eventName: 'battle:move',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('rate_limited');
      expect(result.message).toContain(`max=${RATE_LIMIT_MAX_PER_WINDOW}`);
    }
  });

  it('case 9: rate-limit 不同事件独立计数 — event A 满不影响 event B', async () => {
    // 第一次调用 battle:move 返回 61（超限）
    // 第二次调用 battle:play_card 返回 1（正常）
    mockEval
      .mockResolvedValueOnce(RATE_LIMIT_MAX_PER_WINDOW + 1)
      .mockResolvedValueOnce(1);

    const socket = createMockSocket({ battleRoom: 'battle:battle-1' });

    const moveResult = await validateOperationContext(socket, {
      battleId: 'battle-1',
      userId: 'user-1',
      eventName: 'battle:move',
    });
    expect(moveResult.ok).toBe(false);
    if (!moveResult.ok) expect(moveResult.reason).toBe('rate_limited');

    const cardResult = await validateOperationContext(socket, {
      battleId: 'battle-1',
      userId: 'user-1',
      eventName: 'battle:play_card',
    });
    expect(cardResult.ok).toBe(true);

    // 两次调用 key 不同
    expect(mockEval).toHaveBeenCalledTimes(2);
    const moveCall = mockEval.mock.calls[0][1] as { keys: string[] };
    const cardCall = mockEval.mock.calls[1][1] as { keys: string[] };
    expect(moveCall.keys[0]).toBe('rl:ws:user:user-1:battle:move');
    expect(cardCall.keys[0]).toBe('rl:ws:user:user-1:battle:play_card');
  });

  it('case 10: rate-limit key 构造正确（含 userId + eventName）', async () => {
    mockEval.mockResolvedValue(1);
    const socket = createMockSocket({ battleRoom: 'battle:battle-1', userId: 'user-XYZ' });
    await validateOperationContext(socket, {
      battleId: 'battle-1',
      userId: 'user-XYZ',
      eventName: 'battle:skip_play',
    });
    const call = mockEval.mock.calls[0][1] as { keys: string[] };
    expect(call.keys[0]).toBe('rl:ws:user:user-XYZ:battle:skip_play');
  });

  it('case 11: Redis 抛错 → 降级 allow + console.error', async () => {
    mockEval.mockRejectedValue(new Error('Redis connection lost'));
    const socket = createMockSocket({ battleRoom: 'battle:battle-1' });
    const consoleSpy = console.error as jest.Mock;

    const result = await validateOperationContext(socket, {
      battleId: 'battle-1',
      userId: 'user-1',
      eventName: 'battle:move',
    });

    expect(result).toEqual({ ok: true }); // fail-open
    expect(consoleSpy).toHaveBeenCalled();
    const errCall = consoleSpy.mock.calls[0];
    expect(String(errCall[0])).toContain('Redis error');
  });

  it('case 12: DB 抛错 → 降级 allow + console.error', async () => {
    mockQueryOne.mockRejectedValue(new Error('PG connection lost'));
    const socket = createMockSocket({ battleRoom: 'battle:battle-1' });
    const consoleSpy = console.error as jest.Mock;

    const result = await validateOperationContext(socket, {
      battleId: 'battle-1',
      userId: 'user-1',
      eventName: 'battle:move',
    });

    expect(result).toEqual({ ok: true }); // fail-open
    expect(consoleSpy).toHaveBeenCalled();
    expect(String(consoleSpy.mock.calls[0][0])).toContain('DB error');
    // DB fail-open 后续步骤仍执行：rate-limit 会被调用（自身 try/catch）
    // 此处不验证 mockEval，因为 status fail-open 后会继续往下走
  });
});

// ========================================
// 4. validateJoinContext（仅 rate limit）
// ========================================

describe('validateJoinContext', () => {
  it('rate-limit 正常 → ok', async () => {
    mockEval.mockResolvedValue(1);
    const result = await validateJoinContext('user-1', 'battle:join');
    expect(result).toEqual({ ok: true });
    expect(mockEval).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        keys: ['rl:ws:user:user-1:battle:join'],
      })
    );
  });

  it('rate-limit 超限 → rate_limited', async () => {
    mockEval.mockResolvedValue(RATE_LIMIT_MAX_PER_WINDOW + 1);
    const result = await validateJoinContext('user-1', 'battle:join');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('rate_limited');
  });

  it('Redis 抛错 → 降级 allow', async () => {
    mockEval.mockRejectedValue(new Error('boom'));
    const result = await validateJoinContext('user-1', 'battle:join');
    expect(result).toEqual({ ok: true });
  });

  it('validateJoinContext 不调 DB（仅 rate limit）', async () => {
    mockEval.mockResolvedValue(1);
    await validateJoinContext('user-1', 'battle:join');
    expect(mockQueryOne).not.toHaveBeenCalled();
  });
});

// ========================================
// 5. checkRateLimit 直接测试（边界 + 降级）
// ========================================

describe('checkRateLimit (direct)', () => {
  it('count === max → ok（边界 inclusive）', async () => {
    mockEval.mockResolvedValue(RATE_LIMIT_MAX_PER_WINDOW);
    const result = await checkRateLimit('user-1', 'battle:move');
    expect(result).toEqual({ ok: true });
  });

  it('count > max → rate_limited', async () => {
    mockEval.mockResolvedValue(RATE_LIMIT_MAX_PER_WINDOW + 1);
    const result = await checkRateLimit('user-1', 'battle:move');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('rate_limited');
  });

  it('Lua 返回 string（big number）→ 正确转换', async () => {
    // node-redis 在某些版本可能返回字符串而非数字
    mockEval.mockResolvedValue('61');
    const result = await checkRateLimit('user-1', 'battle:move');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('rate_limited');
  });

  it('Redis 抛错 → 降级 allow + console.error', async () => {
    mockEval.mockRejectedValue(new Error('Redis down'));
    const consoleSpy = console.error as jest.Mock;
    const result = await checkRateLimit('user-1', 'battle:move');
    expect(result).toEqual({ ok: true });
    expect(consoleSpy).toHaveBeenCalled();
  });
});