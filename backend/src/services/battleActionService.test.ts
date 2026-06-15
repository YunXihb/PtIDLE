// T049 单测：executeMove 流水（验证 + 执行 + 广播 + 阶段推进）
//
// Mock 策略：
//   - jest.mock 全部在文件顶部（ts-jest TDZ 要求）
//   - 业务依赖 mock：battleSessionService / battleService / battleStateBroadcaster
//   - 实际 service 通过 require 拉（不静态 import 避免被 hoisted mock 抢走）

jest.mock('../config/redis', () => ({
  redisClient: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    hGet: jest.fn(),
    hSet: jest.fn(),
    hDel: jest.fn(),
  },
  connectRedis: jest.fn(),
  disconnectRedis: jest.fn(),
}));

jest.mock('./battleSessionService', () => ({
  getDbSessionState: jest.fn(),
  completeMovePhase: jest.fn(),
}));

jest.mock('./battleService', () => ({
  listCharactersInBattle: jest.fn(),
  validateMovement: jest.fn(),
  moveCharacter: jest.fn(),
}));

jest.mock('../socket/battleStateBroadcaster', () => ({
  broadcastBoardState: jest.fn(),
}));

import { getDbSessionState, completeMovePhase } from './battleSessionService';
import { listCharactersInBattle, validateMovement, moveCharacter } from './battleService';
import { broadcastBoardState } from '../socket/battleStateBroadcaster';
import type { Server as IOServer } from 'socket.io';

const mockGetDbSessionState = getDbSessionState as jest.MockedFunction<typeof getDbSessionState>;
const mockCompleteMovePhase = completeMovePhase as jest.MockedFunction<typeof completeMovePhase>;
const mockListCharactersInBattle = listCharactersInBattle as jest.MockedFunction<
  typeof listCharactersInBattle
>;
const mockValidateMovement = validateMovement as jest.MockedFunction<typeof validateMovement>;
const mockMoveCharacter = moveCharacter as jest.MockedFunction<typeof moveCharacter>;
const mockBroadcastBoardState = broadcastBoardState as jest.MockedFunction<
  typeof broadcastBoardState
>;

function createMockIO(): IOServer {
  return {
    to: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    emit: jest.fn(),
  } as unknown as IOServer;
}

beforeEach(() => {
  jest.clearAllMocks();
  // 默认 happy path 桩：每个测试按需覆盖
  mockGetDbSessionState.mockResolvedValue({
    currentRound: 1,
    currentStep: 0,
    currentActorId: 'c1',
    currentPhase: 'move',
  });
  mockListCharactersInBattle.mockResolvedValue([
    { characterId: 'c1', playerId: 'p1', userId: 'u1', profession: 'warrior', name: 'A' },
  ]);
  mockValidateMovement.mockResolvedValue({ valid: true, distance: 2 });
  mockMoveCharacter.mockResolvedValue(true);
  mockCompleteMovePhase.mockResolvedValue({ success: true });
  mockBroadcastBoardState.mockResolvedValue(undefined);
});

describe('executeMove', () => {
  it('placeholder — to be expanded in Task 2/3', async () => {
    const { executeMove } = await import('./battleActionService');
    const io = createMockIO();
    const result = await executeMove('b1', 'c1', 5, 3, 'u1');
    // Task 1 占位期望：函数能调通，结构正确
    expect(result).toHaveProperty('success');
  });
});
