// T048 单测：handleBattleJoin + tryInitBattleField
jest.mock('../config/redis', () => ({
  redisClient: {
    set: jest.fn(),
    del: jest.fn(),
    hGet: jest.fn(),
    hSet: jest.fn(),
    eval: jest.fn(), // T055: rate-limit Lua
  },
  connectRedis: jest.fn(),
  disconnectRedis: jest.fn(),
}));
jest.mock('../config/database', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
  execute: jest.fn(),
}));
jest.mock('../services/battleInitializationService', () => ({
  initBattleField: jest.fn(),
  cleanupPartialInit: jest.fn(),
}));
jest.mock('./battleStateBroadcaster', () => ({
  broadcastFullState: jest.fn(),
  broadcastBoardState: jest.fn(),
  broadcastHandState: jest.fn(),
  broadcastCharacterStatus: jest.fn(),
}));
jest.mock('../services/battleActionService', () => ({
  executeMove: jest.fn(),
  executePlayCard: jest.fn(),
  executeEndStep: jest.fn(),
}));

import { handleBattleJoin, handleBattleMove, handleBattlePlayCard, handleBattleSkipPlay } from './battleRoom';
import { initBattleField, cleanupPartialInit } from '../services/battleInitializationService';
import { broadcastFullState } from './battleStateBroadcaster';
import { executeMove, executePlayCard } from '../services/battleActionService';
import { redisClient } from '../config/redis';
import { queryOne } from '../config/database';

const mockInit = initBattleField as jest.MockedFunction<typeof initBattleField>;
const mockCleanup = cleanupPartialInit as jest.MockedFunction<typeof cleanupPartialInit>;
const mockBroadcast = broadcastFullState as jest.MockedFunction<typeof broadcastFullState>;
const mockExecuteMove = executeMove as jest.MockedFunction<typeof executeMove>;
const mockExecutePlayCard = executePlayCard as jest.MockedFunction<typeof executePlayCard>;
const mockRedisSet = redisClient.set as jest.MockedFunction<typeof redisClient.set>;
const mockRedisDel = redisClient.del as jest.MockedFunction<typeof redisClient.del>;
const mockQueryOne = queryOne as jest.MockedFunction<typeof queryOne>;

function createMockSocket(battleId?: string) {
  const handlers: Record<string, Function> = {};
  // T055: socket.rooms Set 默认包含 battle:battleId（battleId='b1' 是测试常用 battleId）
  const rooms = new Set<string>();
  rooms.add('s1'); // socket.io 默认自身房间
  const effectiveBattleId = battleId ?? 'b1';
  rooms.add(`battle:${effectiveBattleId}`);
  const socket: any = {
    id: 's1',
    data: { userId: 'u1', battleId: effectiveBattleId },
    handshake: { auth: { userId: 'u1' } },
    rooms,
    join: jest.fn().mockResolvedValue(undefined),
    emit: jest.fn(),
    on: (event: string, cb: Function) => { handlers[event] = cb; },
    to: jest.fn().mockReturnThis(),
  };
  return { socket, handlers };
}

function createMockIO(roomSize = 1) {
  const io: any = {
    sockets: {
      adapter: {
        rooms: {
          get: jest.fn().mockReturnValue({ size: roomSize }),
        },
      },
    },
    in: jest.fn().mockReturnThis(),
    to: jest.fn().mockReturnThis(),
    emit: jest.fn(),
    fetchSockets: jest.fn().mockResolvedValue([]),
  };
  return io;
}

beforeEach(() => {
  jest.clearAllMocks();
  // T055: 默认 queryOne 返回 status='ongoing'（wsValidation 跨切校验通过所需）
  // handleBattleJoin 测试会在 beforeEach / 各 case 中显式 override 为 'pending' 以测试 init 路径
  mockQueryOne.mockResolvedValue({ id: 'b1', player1_id: 'p1', player2_id: 'p2', status: 'ongoing' });
  mockRedisSet.mockResolvedValue('OK');
  mockRedisDel.mockResolvedValue(1);
  // T055: 默认 redisClient.eval 返回 1（rate-limit 未超限）
  (redisClient.eval as jest.Mock).mockResolvedValue(1);
  mockInit.mockResolvedValue({ success: true, startedAt: new Date(), actorId: 'c1' });
  mockBroadcast.mockResolvedValue(undefined);
});

describe('handleBattleJoin — tryInitBattleField', () => {
  it('should NOT call initBattleField on first player join (other not in room)', async () => {
    const io = createMockIO(1);
    const { socket } = createMockSocket();
    await handleBattleJoin(io, socket, { battleId: 'b1' });
    expect(mockInit).not.toHaveBeenCalled();
    expect(mockBroadcast).toHaveBeenCalledWith(io, 'b1', 'u1');
  });

  it('should call initBattleField on second player join (both in room)', async () => {
    const io = createMockIO(2);
    const { socket } = createMockSocket();
    mockQueryOne.mockResolvedValue({ status: 'pending' });
    await handleBattleJoin(io, socket, { battleId: 'b1' });
    expect(mockInit).toHaveBeenCalledWith(io, 'b1');
  });

  it('should skip init when status=ongoing (re-join idempotent)', async () => {
    const io = createMockIO(2);
    const { socket } = createMockSocket();
    mockQueryOne.mockResolvedValue({ status: 'ongoing' });
    await handleBattleJoin(io, socket, { battleId: 'b1' });
    expect(mockInit).not.toHaveBeenCalled();
    expect(mockBroadcast).toHaveBeenCalledWith(io, 'b1', 'u1');
  });

  it('should release init_lock in finally even when init throws', async () => {
    const io = createMockIO(2);
    const { socket } = createMockSocket();
    mockQueryOne.mockResolvedValue({ status: 'pending' });
    mockInit.mockRejectedValue(new Error('init boom'));
    await handleBattleJoin(io, socket, { battleId: 'b1' });
    expect(mockRedisDel).toHaveBeenCalledWith('battle:b1:init_lock');
  });

  it('should NOT init when SETNX lock fails and status=pending (other is initializing)', async () => {
    const io = createMockIO(1);
    const { socket } = createMockSocket();
    mockRedisSet.mockResolvedValue(null);
    mockQueryOne.mockResolvedValue({ status: 'pending' });
    await handleBattleJoin(io, socket, { battleId: 'b1' });
    await new Promise(r => setTimeout(r, 150));
    expect(mockInit).not.toHaveBeenCalled();
  });
});

// ========================================
// T049: handleBattleMove
// ========================================
describe('handleBattleMove', () => {
  beforeEach(() => {
    mockExecuteMove.mockReset();
  });

  it('should call executeMove with io, battleId, characterId, toX, toY, userId on valid payload', async () => {
    mockExecuteMove.mockResolvedValue({ success: true });
    const io = createMockIO();
    const { socket } = createMockSocket();
    socket.data.userId = 'u1';

    await handleBattleMove(io, socket, {
      battleId: 'b1',
      characterId: 'c1',
      toX: 5,
      toY: 3,
    });

    expect(mockExecuteMove).toHaveBeenCalledWith(io, 'b1', 'c1', 5, 3, 'u1');
    expect(socket.emit).not.toHaveBeenCalledWith('battle:move:error', expect.anything());
  });

  it('should emit battle:move:error with invalid_payload when battleId is not string', async () => {
    const io = createMockIO();
    const { socket } = createMockSocket();
    socket.data.userId = 'u1';

    await handleBattleMove(io, socket, { characterId: 'c1', toX: 5, toY: 3 });

    expect(socket.emit).toHaveBeenCalledWith('battle:move:error', { error: 'invalid_payload' });
    expect(mockExecuteMove).not.toHaveBeenCalled();
  });

  it('should emit battle:move:error with invalid_payload when characterId is not string', async () => {
    const io = createMockIO();
    const { socket } = createMockSocket();
    socket.data.userId = 'u1';

    await handleBattleMove(io, socket, { battleId: 'b1', characterId: 123, toX: 5, toY: 3 });

    expect(socket.emit).toHaveBeenCalledWith('battle:move:error', { error: 'invalid_payload' });
    expect(mockExecuteMove).not.toHaveBeenCalled();
  });

  it('should emit battle:move:error with invalid_payload when toX is not finite number', async () => {
    const io = createMockIO();
    const { socket } = createMockSocket();
    socket.data.userId = 'u1';

    await handleBattleMove(io, socket, {
      battleId: 'b1',
      characterId: 'c1',
      toX: '5', // 字符串
      toY: 3,
    });

    expect(socket.emit).toHaveBeenCalledWith('battle:move:error', { error: 'invalid_payload' });
    expect(mockExecuteMove).not.toHaveBeenCalled();
  });

  it('should emit battle:move:error with invalid_payload when toY is NaN', async () => {
    const io = createMockIO();
    const { socket } = createMockSocket();
    socket.data.userId = 'u1';

    await handleBattleMove(io, socket, {
      battleId: 'b1',
      characterId: 'c1',
      toX: 5,
      toY: NaN,
    });

    expect(socket.emit).toHaveBeenCalledWith('battle:move:error', { error: 'invalid_payload' });
    expect(mockExecuteMove).not.toHaveBeenCalled();
  });

  it('should emit battle:move:error with service error when executeMove returns failure', async () => {
    mockExecuteMove.mockResolvedValue({ success: false, error: 'not_in_move_phase' });
    const io = createMockIO();
    const { socket } = createMockSocket();
    socket.data.userId = 'u1';

    await handleBattleMove(io, socket, {
      battleId: 'b1',
      characterId: 'c1',
      toX: 5,
      toY: 3,
    });

    expect(socket.emit).toHaveBeenCalledWith('battle:move:error', { error: 'not_in_move_phase' });
  });

  it('should not emit anything on success (rely on broadcastBoardState room-wide)', async () => {
    mockExecuteMove.mockResolvedValue({ success: true });
    const io = createMockIO();
    const { socket } = createMockSocket();
    socket.data.userId = 'u1';

    await handleBattleMove(io, socket, {
      battleId: 'b1',
      characterId: 'c1',
      toX: 5,
      toY: 3,
    });

    expect(socket.emit).not.toHaveBeenCalled();
  });
});

// ========================================
// T050 Task 8: handleBattlePlayCard
// ========================================
describe('handleBattlePlayCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: 成功返回（保持对其他 describe block 的 mock reset 隔离）
    mockExecutePlayCard.mockResolvedValue({ success: true, validation: {} as any });
  });

  it('case 1: valid play_card payload — calls executePlayCard and does not emit on success', async () => {
    const io = createMockIO();
    const { socket } = createMockSocket();
    socket.data.userId = 'u1';

    const handCard = {
      deck_id: 'd1',
      card_id: 'pc1',
      name: 'X',
      type: 'attack',
      cost: 1,
      effect: {},
      template_no: 1,
      source: 'deck',
      targetId: 't1',
    };
    await handleBattlePlayCard(io, socket, { battleId: 'b1', characterId: 'c1', handCard });

    expect(mockExecutePlayCard).toHaveBeenCalledWith(io, 'b1', 'c1', handCard, 'u1');
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('case 2: invalid payload (missing handCard) — emits invalid_payload error', async () => {
    const io = createMockIO();
    const { socket } = createMockSocket();
    socket.data.userId = 'u1';

    await handleBattlePlayCard(io, socket, { battleId: 'b1', characterId: 'c1' });

    expect(socket.emit).toHaveBeenCalledWith('battle:play_card:error', { error: 'invalid_payload' });
    expect(mockExecutePlayCard).not.toHaveBeenCalled();
  });

  it('case 3: defense card type — handler does NOT reject; lets service return unsupported_card_type', async () => {
    const io = createMockIO();
    const { socket } = createMockSocket();
    socket.data.userId = 'u1';
    mockExecutePlayCard.mockResolvedValueOnce({
      success: false,
      error: 'unsupported_card_type',
      detail: "card type 'defense' not supported in T050",
    });

    const handCard = {
      deck_id: 'd1',
      card_id: 'pc1',
      name: 'X',
      type: 'defense',
      cost: 1,
      effect: {},
      template_no: 1,
      source: 'deck',
    };
    await handleBattlePlayCard(io, socket, { battleId: 'b1', characterId: 'c1', handCard });

    expect(mockExecutePlayCard).toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith('battle:play_card:error', {
      error: 'unsupported_card_type',
      detail: "card type 'defense' not supported in T050",
    });
  });

  it('case 4: executePlayCard returns validation_failed — emits error with detail', async () => {
    const io = createMockIO();
    const { socket } = createMockSocket();
    socket.data.userId = 'u1';
    mockExecutePlayCard.mockResolvedValueOnce({
      success: false,
      error: 'validation_failed',
      detail: 'Target out of range',
    });

    await handleBattlePlayCard(io, socket, {
      battleId: 'b1',
      characterId: 'c1',
      handCard: {
        deck_id: 'd1',
        card_id: 'pc1',
        type: 'attack',
        cost: 1,
        effect: {},
        template_no: 1,
        source: 'deck',
        name: 'X',
      },
    });

    expect(socket.emit).toHaveBeenCalledWith('battle:play_card:error', {
      error: 'validation_failed',
      detail: 'Target out of range',
    });
  });

  it('case 5: executePlayCard throws — does NOT emit (caller is socketServer layer)', async () => {
    const io = createMockIO();
    const { socket } = createMockSocket();
    socket.data.userId = 'u1';
    mockExecutePlayCard.mockRejectedValueOnce(new Error('boom'));

    await expect(
      handleBattlePlayCard(io, socket, {
        battleId: 'b1',
        characterId: 'c1',
        handCard: {
          deck_id: 'd1',
          card_id: 'pc1',
          type: 'attack',
          cost: 1,
          effect: {},
          template_no: 1,
          source: 'deck',
          name: 'X',
        },
      })
    ).rejects.toThrow('boom');
    expect(socket.emit).not.toHaveBeenCalled();
  });
});

describe('handleBattleSkipPlay', () => {
  let mockSocket: any;
  let mockIo: any;
  let mockEmit: jest.Mock;

  beforeEach(() => {
    mockEmit = jest.fn();
    // T055: 添加 rooms Set（含 battle:b1 让 wsValidation room check 通过）
    mockSocket = {
      data: { userId: 'u1' },
      rooms: new Set(['s1', 'battle:b1']),
      emit: mockEmit,
    };
    mockIo = {} as any;
  });

  it('valid payload → executeEndStep 被调', async () => {
    const { executeEndStep } = require('../services/battleActionService');
    (executeEndStep as jest.Mock).mockResolvedValue({ success: true, state: {} as any });
    await handleBattleSkipPlay(mockIo, mockSocket, { battleId: 'b1' });
    expect(executeEndStep).toHaveBeenCalledWith(mockIo, 'b1');
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it('invalid payload (缺 battleId) → emit battle:skip_play:error invalid_payload', async () => {
    await handleBattleSkipPlay(mockIo, mockSocket, {});
    expect(mockEmit).toHaveBeenCalledWith('battle:skip_play:error', { error: 'invalid_payload' });
  });

  it('invalid payload (battleId 非 string) → emit invalid_payload', async () => {
    await handleBattleSkipPlay(mockIo, mockSocket, { battleId: 123 });
    expect(mockEmit).toHaveBeenCalledWith('battle:skip_play:error', { error: 'invalid_payload' });
  });

  it('executeEndStep 失败 → emit error + detail', async () => {
    const { executeEndStep } = require('../services/battleActionService');
    (executeEndStep as jest.Mock).mockResolvedValue({
      success: false, error: 'not_in_play_or_move_phase', detail: 'phase=idle',
    });
    await handleBattleSkipPlay(mockIo, mockSocket, { battleId: 'b1' });
    expect(mockEmit).toHaveBeenCalledWith('battle:skip_play:error', {
      error: 'not_in_play_or_move_phase', detail: 'phase=idle',
    });
  });

  it('executeEndStep 抛错 → 不 emit（socketServer 兜底）', async () => {
    const { executeEndStep } = require('../services/battleActionService');
    (executeEndStep as jest.Mock).mockRejectedValue(new Error('boom'));
    await expect(handleBattleSkipPlay(mockIo, mockSocket, { battleId: 'b1' }))
      .rejects.toThrow('boom');
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it('executeEndStep 成功 → 不 emit（依赖 broadcast 两连）', async () => {
    const { executeEndStep } = require('../services/battleActionService');
    (executeEndStep as jest.Mock).mockResolvedValue({ success: true, state: {} as any });
    await handleBattleSkipPlay(mockIo, mockSocket, { battleId: 'b1' });
    expect(mockEmit).not.toHaveBeenCalled();
  });
});

// ========================================
// T055: 跨切校验回归测试
// ========================================
describe('T055: handler 接入 validateOperationContext', () => {
  let mockSocket: any;
  let mockIo: any;
  let mockEmit: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEmit = jest.fn();
    mockSocket = {
      data: { userId: 'u1' },
      rooms: new Set(['s1']),
      emit: mockEmit,
    };
    mockIo = {} as any;
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ----- handleBattleMove -----
  it('T055-case 1: handleBattleMove + validator not_in_room → emit error，不调 executeMove', async () => {
    // socket 不在 battle room
    mockSocket.rooms = new Set(['s1']); // 仅自身房间，无 battle:b1
    await handleBattleMove(mockIo, mockSocket, {
      battleId: 'b1',
      characterId: 'c1',
      toX: 5,
      toY: 3,
    });
    expect(mockEmit).toHaveBeenCalledWith('battle:move:error', { error: 'not_in_room' });
    expect(mockExecuteMove).not.toHaveBeenCalled();
  });

  // ----- handleBattlePlayCard -----
  it('T055-case 2: handleBattlePlayCard + validator battle_not_ongoing → emit error，不调 executePlayCard', async () => {
    mockSocket.rooms = new Set(['s1', 'battle:b1']);
    // queryOne 返回 status='pending' → 校验失败
    mockQueryOne.mockResolvedValue({ status: 'pending' });
    (redisClient.eval as jest.Mock).mockResolvedValue(1);

    const handCard = {
      deck_id: 'd1',
      card_id: 'pc1',
      name: 'X',
      type: 'attack',
      cost: 1,
      effect: {},
      template_no: 1,
      source: 'deck',
    };
    await handleBattlePlayCard(mockIo, mockSocket, {
      battleId: 'b1',
      characterId: 'c1',
      handCard,
    });
    expect(mockEmit).toHaveBeenCalledWith('battle:play_card:error', {
      error: 'battle_not_ongoing',
    });
    expect(mockExecutePlayCard).not.toHaveBeenCalled();
  });

  // ----- handleBattleSkipPlay -----
  it('T055-case 3: handleBattleSkipPlay + validator rate_limited → emit error，不调 executeEndStep', async () => {
    mockSocket.rooms = new Set(['s1', 'battle:b1']);
    mockQueryOne.mockResolvedValue({ status: 'ongoing' });
    (redisClient.eval as jest.Mock).mockResolvedValue(61); // > 60 触发 rate_limited

    await handleBattleSkipPlay(mockIo, mockSocket, { battleId: 'b1' });
    expect(mockEmit).toHaveBeenCalledWith('battle:skip_play:error', {
      error: 'rate_limited',
    });

    const { executeEndStep } = require('../services/battleActionService');
    expect(executeEndStep).not.toHaveBeenCalled();
  });

  // ----- happy path 回归保护 -----
  it('T055-case 4 (happy path regression): handleBattleMove + validator ok → executeMove 被调', async () => {
    mockSocket.rooms = new Set(['s1', 'battle:b1']);
    mockQueryOne.mockResolvedValue({ status: 'ongoing' });
    (redisClient.eval as jest.Mock).mockResolvedValue(1);
    mockExecuteMove.mockResolvedValue({ success: true });

    await handleBattleMove(mockIo, mockSocket, {
      battleId: 'b1',
      characterId: 'c1',
      toX: 5,
      toY: 3,
    });

    expect(mockExecuteMove).toHaveBeenCalledWith(mockIo, 'b1', 'c1', 5, 3, 'u1');
    // happy path 不 emit 任何 error
    expect(mockEmit).not.toHaveBeenCalledWith('battle:move:error', expect.anything());
  });

  // ----- handleBattleJoin rate limit 回归 -----
  it('T055-case 5: handleBattleJoin + validator rate_limited → emit join:error', async () => {
    mockSocket.rooms = new Set(['s1']);
    mockSocket.data.username = 'u1-name';
    (redisClient.eval as jest.Mock).mockResolvedValue(61);

    await handleBattleJoin(mockIo, mockSocket, { battleId: 'b1' });

    expect(mockEmit).toHaveBeenCalledWith('battle:join:error', {
      error: 'rate_limited',
    });
    // 不应触发 DB join 查询（rate-limit 短路在前面）
    // 注: 第一行 queryOne 不应是 join 查询 — 但 jest 计数无法验证顺序,只能验证 mockGetPendingBattleForJoin
    // 这里通过 mockEmit 调用验证
  });
});
