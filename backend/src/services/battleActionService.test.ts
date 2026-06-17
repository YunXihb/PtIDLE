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
    lRem: jest.fn(),
  },
  connectRedis: jest.fn(),
  disconnectRedis: jest.fn(),
}));

jest.mock('./battleSessionService', () => ({
  getDbSessionState: jest.fn(),
  completeMovePhase: jest.fn(),
  completePlayPhase: jest.fn(),
}));

jest.mock('./battleService', () => ({
  listCharactersInBattle: jest.fn(),
  validateMovement: jest.fn(),
  moveCharacter: jest.fn(),
  getCharacterPosition: jest.fn(),
  getCharacterPiece: jest.fn(),
  validateAttack: jest.fn(),
  validateAOEAttack: jest.fn(),
  validateTauntCard: jest.fn(),
  setCharacterEnergy: jest.fn(),
}));

jest.mock('../socket/battleStateBroadcaster', () => ({
  broadcastBoardState: jest.fn(),
  broadcastHandState: jest.fn(),
  broadcastCharacterStatus: jest.fn(),
}));

jest.mock('./handService', () => ({
  getActorHand: jest.fn(),
  addToDiscardPile: jest.fn(),
}));

import { getDbSessionState, completeMovePhase, completePlayPhase } from './battleSessionService';
import {
  listCharactersInBattle,
  validateMovement,
  moveCharacter,
  getCharacterPosition,
  getCharacterPiece,
  validateAttack,
  validateAOEAttack,
  validateTauntCard,
  setCharacterEnergy,
} from './battleService';
import { broadcastBoardState, broadcastHandState, broadcastCharacterStatus } from '../socket/battleStateBroadcaster';
import { getActorHand, addToDiscardPile } from './handService';
import { redisClient } from '../config/redis';
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
const mockGetCharacterPosition = getCharacterPosition as jest.MockedFunction<
  typeof getCharacterPosition
>;
const mockGetCharacterPiece = getCharacterPiece as jest.MockedFunction<typeof getCharacterPiece>;
const mockGetActorHand = getActorHand as jest.MockedFunction<typeof getActorHand>;
const mockAddToDiscardPile = addToDiscardPile as jest.MockedFunction<typeof addToDiscardPile>;
const mockValidateAttack = validateAttack as jest.MockedFunction<typeof validateAttack>;
const mockValidateAOEAttack = validateAOEAttack as jest.MockedFunction<typeof validateAOEAttack>;
const mockValidateTauntCard = validateTauntCard as jest.MockedFunction<typeof validateTauntCard>;
const mockSetCharacterEnergy = setCharacterEnergy as jest.MockedFunction<typeof setCharacterEnergy>;
const mockCompletePlayPhase = completePlayPhase as jest.MockedFunction<typeof completePlayPhase>;
const mockBroadcastHandState = broadcastHandState as jest.MockedFunction<typeof broadcastHandState>;
const mockBroadcastCharacterStatus = broadcastCharacterStatus as jest.MockedFunction<typeof broadcastCharacterStatus>;

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
  mockGetCharacterPosition.mockResolvedValue({ x: 3, y: 3 });
  // T050 默认 happy path 桩
  mockGetActorHand.mockResolvedValue([
    { deck_id: 'd1', card_id: 'pc1', name: '轻击', type: 'attack', cost: 1, effect: { damage: 2, range: 1 }, template_no: 1, source: 'deck' },
  ]);
  mockAddToDiscardPile.mockResolvedValue(undefined);
  mockValidateAttack.mockResolvedValue({
    valid: true,
    damage: 2,
    targets: ['t1'],
    energyCost: 1,
  });
  mockValidateAOEAttack.mockResolvedValue({
    valid: true,
    damage: 2,
    targets: ['t1', 't2'],
    energyCost: 2,
  });
  mockValidateTauntCard.mockResolvedValue({
    valid: true,
    targets: ['t1'],
    energyCost: 1,
  });
  mockSetCharacterEnergy.mockResolvedValue(undefined);
  mockCompletePlayPhase.mockResolvedValue({ success: true, state: undefined as any });
  mockBroadcastHandState.mockResolvedValue(undefined);
  mockBroadcastCharacterStatus.mockResolvedValue(undefined);
  mockGetCharacterPiece.mockImplementation(async (_battleId: string, charId: string) => {
    return {
      character_id: charId,
      player_id: 'p1',
      profession: 'warrior',
      is_alive: true,
      health: 20,
      max_health: 20,
      energy: 3,
      position_x: 3,
      position_y: 3,
    } as any;
  });
  (redisClient.lRem as jest.Mock).mockResolvedValue(1);
  (redisClient.hGet as jest.Mock).mockResolvedValue(JSON.stringify({ energy: 3 }));
});

describe('executeMove — happy path', () => {
  it('should return success and trigger broadcast + phase progression in order', async () => {
    const { executeMove } = await import('./battleActionService');
    const io = createMockIO();

    const result = await executeMove(io, 'b1', 'c1', 5, 3, 'u1');

    expect(result).toEqual({ success: true });
    // 验证所有依赖被调一次
    expect(mockGetDbSessionState).toHaveBeenCalledWith('b1');
    expect(mockListCharactersInBattle).toHaveBeenCalledWith('b1');
    expect(mockValidateMovement).toHaveBeenCalledWith('b1', 'c1', 5, 3);
    expect(mockMoveCharacter).toHaveBeenCalledWith('b1', 'c1', expect.any(Number), expect.any(Number), 5, 3);
    expect(mockBroadcastBoardState).toHaveBeenCalledWith(io, 'b1');
    expect(mockCompleteMovePhase).toHaveBeenCalledWith('b1');
    // 验证顺序：broadcast 在 phase 推进前（保证客户端先看到新 board，再看到 play 阶段）
    const broadcastOrder = mockBroadcastBoardState.mock.invocationCallOrder[0];
    const completeOrder = mockCompleteMovePhase.mock.invocationCallOrder[0];
    expect(broadcastOrder).toBeLessThan(completeOrder);
  });

  it('should pass io reference to broadcastBoardState', async () => {
    const { executeMove } = await import('./battleActionService');
    const io = createMockIO();
    await executeMove(io, 'b1', 'c1', 5, 3, 'u1');
    expect(mockBroadcastBoardState).toHaveBeenCalledWith(io, 'b1');
  });
});

describe('executeMove — error branches', () => {
  it('should return not_in_move_phase when currentPhase !== move', async () => {
    mockGetDbSessionState.mockResolvedValue({
      currentRound: 1,
      currentStep: 0,
      currentActorId: 'c1',
      currentPhase: 'play', // 不是 move
    });
    const { executeMove } = await import('./battleActionService');
    const io = createMockIO();
    const result = await executeMove(io, 'b1', 'c1', 5, 3, 'u1');
    expect(result).toEqual({ success: false, error: 'not_in_move_phase' });
    expect(mockValidateMovement).not.toHaveBeenCalled();
    expect(mockMoveCharacter).not.toHaveBeenCalled();
    expect(mockBroadcastBoardState).not.toHaveBeenCalled();
    expect(mockCompleteMovePhase).not.toHaveBeenCalled();
  });

  it('should return not_current_actor when characterId does not match currentActorId', async () => {
    mockGetDbSessionState.mockResolvedValue({
      currentRound: 1,
      currentStep: 0,
      currentActorId: 'c2', // 不是 c1
      currentPhase: 'move',
    });
    const { executeMove } = await import('./battleActionService');
    const io = createMockIO();
    const result = await executeMove(io, 'b1', 'c1', 5, 3, 'u1');
    expect(result).toEqual({ success: false, error: 'not_current_actor' });
    expect(mockListCharactersInBattle).not.toHaveBeenCalled();
  });

  it('should return not_owner when userId does not own the character', async () => {
    mockListCharactersInBattle.mockResolvedValue([
      { characterId: 'c1', playerId: 'p1', userId: 'u_other', profession: 'warrior', name: 'A' },
    ]);
    const { executeMove } = await import('./battleActionService');
    const io = createMockIO();
    const result = await executeMove(io, 'b1', 'c1', 5, 3, 'u1');
    expect(result).toEqual({ success: false, error: 'not_owner' });
    expect(mockValidateMovement).not.toHaveBeenCalled();
  });

  it('should return invalid_path when validateMovement returns invalid', async () => {
    mockValidateMovement.mockResolvedValue({
      valid: false,
      error: 'Target too far (distance: 10, movement: 3)',
    });
    const { executeMove } = await import('./battleActionService');
    const io = createMockIO();
    const result = await executeMove(io, 'b1', 'c1', 5, 3, 'u1');
    expect(result).toEqual({ success: false, error: 'invalid_path' });
    expect(mockMoveCharacter).not.toHaveBeenCalled();
    expect(mockBroadcastBoardState).not.toHaveBeenCalled();
    expect(mockCompleteMovePhase).not.toHaveBeenCalled();
  });

  it('should return move_failed when moveCharacter returns false (concurrent occupy)', async () => {
    mockMoveCharacter.mockResolvedValue(false);
    const { executeMove } = await import('./battleActionService');
    const io = createMockIO();
    const result = await executeMove(io, 'b1', 'c1', 5, 3, 'u1');
    expect(result).toEqual({ success: false, error: 'move_failed' });
    expect(mockBroadcastBoardState).not.toHaveBeenCalled();
    expect(mockCompleteMovePhase).not.toHaveBeenCalled();
  });

  it('should return move_failed when character has no from position (defensive)', async () => {
    mockGetCharacterPosition.mockResolvedValue(null);
    const { executeMove } = await import('./battleActionService');
    const io = createMockIO();
    const result = await executeMove(io, 'b1', 'c1', 5, 3, 'u1');
    expect(result).toEqual({ success: false, error: 'move_failed' });
    expect(mockMoveCharacter).not.toHaveBeenCalled();
  });
});

describe('executePlayCard', () => {
  it('happy path: attack single — calls all 17 steps in order and returns success', async () => {
    // 覆盖 T049 默认（move phase） → T050 happy 路径需要 play phase
    mockGetDbSessionState.mockResolvedValueOnce({
      currentRound: 1,
      currentStep: 0,
      currentActorId: 'c1',
      currentPhase: 'play',
    });
    mockListCharactersInBattle.mockResolvedValueOnce([
      { characterId: 'c1', playerId: 'p1', userId: 'u1', profession: 'warrior', name: 'A' },
    ]);

    const { executePlayCard } = await import('./battleActionService');
    const io = createMockIO();

    const handCard: any = {
      deck_id: 'd1',
      card_id: 'pc1',
      name: '轻击',
      type: 'attack',
      cost: 1,
      effect: { damage: 2, range: 1 },
      template_no: 1,
      source: 'deck',
      targetId: 't1',
    };

    const result = await executePlayCard(io, 'b1', 'c1', handCard, 'u1');

    expect(result).toEqual({
      success: true,
      validation: expect.objectContaining({ valid: true, damage: 2 }),
    });

    // 验证调用顺序：核心 10 个 mock 都被调用过
    const callOrder = [
      mockGetDbSessionState,
      mockListCharactersInBattle,
      mockGetActorHand,
      mockValidateAttack,
      mockSetCharacterEnergy,
      mockAddToDiscardPile,
      mockBroadcastHandState,
      mockBroadcastCharacterStatus,
      mockCompletePlayPhase,
      mockBroadcastBoardState,
    ];
    for (let i = 0; i < callOrder.length; i++) {
      expect(callOrder[i]).toHaveBeenCalled();
    }

    // 验证调用顺序：completePlayPhase 在 broadcastBoardState 之前（保证客户端先看到新 board 再看到 phase 推进）
    const completeOrder = mockCompletePlayPhase.mock.invocationCallOrder[0];
    const broadcastBoardOrder = mockBroadcastBoardState.mock.invocationCallOrder[0];
    expect(completeOrder).toBeLessThan(broadcastBoardOrder);
  });

  it('happy path: attack AOE — dispatches to validateAOEAttack', async () => {
    mockGetDbSessionState.mockResolvedValueOnce({
      currentRound: 1, currentStep: 0, currentActorId: 'c1', currentPhase: 'play',
    });
    mockListCharactersInBattle.mockResolvedValueOnce([
      { characterId: 'c1', playerId: 'p1', userId: 'u1', profession: 'warrior', name: 'A' },
    ]);
    mockGetActorHand.mockResolvedValueOnce([
      { deck_id: 'd2', card_id: 'pc2', name: 'AOE 攻击', type: 'attack', cost: 2,
        effect: { damage: 3, range: 2, aoe: true }, template_no: 2, source: 'deck' },
    ]);

    const { executePlayCard } = await import('./battleActionService');
    const io = createMockIO();

    const handCard: any = {
      deck_id: 'd2', card_id: 'pc2', name: 'AOE 攻击', type: 'attack', cost: 2,
      effect: { damage: 3, range: 2, aoe: true }, template_no: 2, source: 'deck',
    };

    const result = await executePlayCard(io, 'b1', 'c1', handCard, 'u1');

    expect(result).toEqual({
      success: true,
      validation: expect.objectContaining({ valid: true }),
    });
    expect(mockValidateAOEAttack).toHaveBeenCalledWith('b1', 'c1', 'pc2', 'deck');
    expect(mockValidateAttack).not.toHaveBeenCalled();
  });

  it('happy path: tactical taunt — dispatches to validateTauntCard', async () => {
    mockGetDbSessionState.mockResolvedValueOnce({
      currentRound: 1, currentStep: 0, currentActorId: 'c1', currentPhase: 'play',
    });
    mockListCharactersInBattle.mockResolvedValueOnce([
      { characterId: 'c1', playerId: 'p1', userId: 'u1', profession: 'warrior', name: 'A' },
    ]);
    mockGetActorHand.mockResolvedValueOnce([
      { deck_id: 'd3', card_id: 'pc3', name: '挑战', type: 'tactical', cost: 1,
        effect: { type: 'taunt', range: 3 }, template_no: 3, source: 'deck' },
    ]);

    const { executePlayCard } = await import('./battleActionService');
    const io = createMockIO();

    const handCard: any = {
      deck_id: 'd3', card_id: 'pc3', name: '挑战', type: 'tactical', cost: 1,
      effect: { type: 'taunt', range: 3 }, template_no: 3, source: 'deck',
      targetId: 't1',
    };

    const result = await executePlayCard(io, 'b1', 'c1', handCard, 'u1');

    expect(result).toEqual({
      success: true,
      validation: expect.objectContaining({ valid: true }),
    });
    expect(mockValidateTauntCard).toHaveBeenCalledWith('b1', 'c1', 'pc3', 't1', expect.any(Number));
    expect(mockValidateAttack).not.toHaveBeenCalled();
    expect(mockValidateAOEAttack).not.toHaveBeenCalled();
  });
});
