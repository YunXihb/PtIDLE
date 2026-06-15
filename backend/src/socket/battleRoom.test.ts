// T048 单测：handleBattleJoin + tryInitBattleField
jest.mock('../config/redis', () => ({
  redisClient: {
    set: jest.fn(),
    del: jest.fn(),
    hGet: jest.fn(),
    hSet: jest.fn(),
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
}));

import { handleBattleJoin, handleBattleMove } from './battleRoom';
import { initBattleField, cleanupPartialInit } from '../services/battleInitializationService';
import { broadcastFullState } from './battleStateBroadcaster';
import { executeMove } from '../services/battleActionService';
import { redisClient } from '../config/redis';
import { queryOne } from '../config/database';

const mockInit = initBattleField as jest.MockedFunction<typeof initBattleField>;
const mockCleanup = cleanupPartialInit as jest.MockedFunction<typeof cleanupPartialInit>;
const mockBroadcast = broadcastFullState as jest.MockedFunction<typeof broadcastFullState>;
const mockExecuteMove = executeMove as jest.MockedFunction<typeof executeMove>;
const mockRedisSet = redisClient.set as jest.MockedFunction<typeof redisClient.set>;
const mockRedisDel = redisClient.del as jest.MockedFunction<typeof redisClient.del>;
const mockQueryOne = queryOne as jest.MockedFunction<typeof queryOne>;

function createMockSocket(battleId?: string) {
  const handlers: Record<string, Function> = {};
  const socket: any = {
    id: 's1',
    data: { userId: 'u1', battleId },
    handshake: { auth: { userId: 'u1' } },
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
  mockQueryOne.mockResolvedValue({ id: 'b1', player1_id: 'p1', player2_id: 'p2', status: 'pending' });
  mockRedisSet.mockResolvedValue('OK');
  mockRedisDel.mockResolvedValue(1);
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
