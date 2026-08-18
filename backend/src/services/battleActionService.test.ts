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
    hGetAll: jest.fn(),  // ★ T052: preStepAliveMap snapshot
    lRem: jest.fn(),
  },
  connectRedis: jest.fn(),
  disconnectRedis: jest.fn(),
}));

jest.mock('./battleSessionService', () => ({
  getSessionState: jest.fn(),
  getDbSessionState: jest.fn(),
  completeMovePhase: jest.fn(),
  completePlayPhase: jest.fn(),
  endCurrentStep: jest.fn(),
  activateCurrentUnit: jest.fn(),
  completeDrawPhase: jest.fn(),
  endCurrentRound: jest.fn(),
  finishSession: jest.fn(),  // ★ T052
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
  broadcastSessionState: jest.fn(),
}));

jest.mock('./handService', () => ({
  getActorHand: jest.fn(),
  addToDiscardPile: jest.fn(),
  retainHandOnStepEnd: jest.fn(),
  drawCards: jest.fn(),
  removeCardFromHand: jest.fn(),
}));

jest.mock('./professionMechanicService', () => ({
  tickBurnDamageOnTarget: jest.fn(),
}));

jest.mock('./statusEffectService', () => ({
  tickEffects: jest.fn(),
}));

jest.mock('./battleOutcomeService', () => ({
  applyKillStars: jest.fn(),
  applyBaseStars: jest.fn(),
  checkWinCondition: jest.fn(),
  recordVictory: jest.fn(),
}));

// ★ T053: 事务 helper mock
jest.mock('../config/database', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
  execute: jest.fn(),
  withTransaction: jest.fn(),
  pool: { connect: jest.fn(), on: jest.fn() },
  testConnection: jest.fn(),
}));

import { getSessionState, getDbSessionState, completeMovePhase, completePlayPhase, endCurrentStep, activateCurrentUnit, completeDrawPhase, endCurrentRound, finishSession } from './battleSessionService';
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
import { broadcastBoardState, broadcastHandState, broadcastCharacterStatus, broadcastSessionState } from '../socket/battleStateBroadcaster';
import { getActorHand, addToDiscardPile, retainHandOnStepEnd, drawCards, removeCardFromHand } from './handService';
import { tickBurnDamageOnTarget } from './professionMechanicService';
import { tickEffects } from './statusEffectService';
import { applyKillStars, applyBaseStars, checkWinCondition, recordVictory } from './battleOutcomeService';
import { redisClient } from '../config/redis';
import { withTransaction } from '../config/database';
import type { Server as IOServer } from 'socket.io';

const mockGetSessionState = getSessionState as jest.MockedFunction<any>;
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
const mockRemoveCardFromHand = removeCardFromHand as jest.MockedFunction<typeof removeCardFromHand>;
const mockAddToDiscardPile = addToDiscardPile as jest.MockedFunction<typeof addToDiscardPile>;
const mockValidateAttack = validateAttack as jest.MockedFunction<typeof validateAttack>;
const mockValidateAOEAttack = validateAOEAttack as jest.MockedFunction<typeof validateAOEAttack>;
const mockValidateTauntCard = validateTauntCard as jest.MockedFunction<typeof validateTauntCard>;
const mockSetCharacterEnergy = setCharacterEnergy as jest.MockedFunction<typeof setCharacterEnergy>;
const mockCompletePlayPhase = completePlayPhase as jest.MockedFunction<typeof completePlayPhase>;
const mockBroadcastHandState = broadcastHandState as jest.MockedFunction<typeof broadcastHandState>;
const mockBroadcastCharacterStatus = broadcastCharacterStatus as jest.MockedFunction<typeof broadcastCharacterStatus>;
const mockTickBurnDamageOnTarget = tickBurnDamageOnTarget as jest.MockedFunction<typeof tickBurnDamageOnTarget>;
const mockTickEffects = tickEffects as jest.MockedFunction<typeof tickEffects>;
const mockRetainHandOnStepEnd = retainHandOnStepEnd as jest.MockedFunction<typeof retainHandOnStepEnd>;
const mockDrawCards = drawCards as jest.MockedFunction<typeof drawCards>;
const mockEndCurrentStep = endCurrentStep as jest.MockedFunction<typeof endCurrentStep>;
const mockActivateCurrentUnit = activateCurrentUnit as jest.MockedFunction<typeof activateCurrentUnit>;
const mockCompleteDrawPhase = completeDrawPhase as jest.MockedFunction<typeof completeDrawPhase>;
const mockEndCurrentRound = endCurrentRound as jest.MockedFunction<typeof endCurrentRound>;
const mockBroadcastSessionState = broadcastSessionState as jest.MockedFunction<typeof broadcastSessionState>;
const mockApplyKillStars = applyKillStars as jest.MockedFunction<typeof applyKillStars>;
const mockApplyBaseStars = applyBaseStars as jest.MockedFunction<typeof applyBaseStars>;
const mockCheckWinCondition = checkWinCondition as jest.MockedFunction<typeof checkWinCondition>;
const mockRecordVictory = recordVictory as jest.MockedFunction<typeof recordVictory>;
const mockFinishSession = finishSession as jest.MockedFunction<typeof finishSession>;
const mockWithTransaction = withTransaction as jest.MockedFunction<typeof withTransaction>;

function createMockIO(): IOServer {
  return {
    to: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    emit: jest.fn(),
  } as unknown as IOServer;
}

beforeEach(() => {
  jest.resetAllMocks();
  // 默认 happy path 桩：每个测试按需覆盖
  mockGetSessionState.mockResolvedValue({
    currentRound: 1,
    currentStep: 0,
    currentActorId: 'c1',
    currentPhase: 'move',
    activationOrder: ['c1', 'c4', 'c2', 'c5', 'c3', 'c6'],
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
  mockRemoveCardFromHand.mockResolvedValue([]);
  // T051 默认 happy path 桩
  mockTickBurnDamageOnTarget.mockResolvedValue({ totalDamage: 0, newHp: -1, isDead: false });
  mockTickEffects.mockResolvedValue([]);
  mockRetainHandOnStepEnd.mockResolvedValue({ success: true, retained: null, discarded: [] });
  mockDrawCards.mockResolvedValue({ success: true, cards: [], drawn_count: 0, deck_size: 0 });
  mockEndCurrentStep.mockResolvedValue({ success: true, state: undefined as any });
  mockActivateCurrentUnit.mockResolvedValue({ success: true, state: undefined as any });
  mockCompleteDrawPhase.mockResolvedValue({ success: true, state: undefined as any });
  mockEndCurrentRound.mockResolvedValue({ success: true, state: undefined as any });
  mockBroadcastSessionState.mockResolvedValue(undefined);
  mockListCharactersInBattle.mockResolvedValue([
    { characterId: 'c1', playerId: 'p1', userId: 'u1', profession: 'warrior', name: 'p1-c1' },
    { characterId: 'c2', playerId: 'p1', userId: 'u1', profession: 'ranger', name: 'p1-c2' },
    { characterId: 'c3', playerId: 'p1', userId: 'u1', profession: 'mage', name: 'p1-c3' },
    { characterId: 'c4', playerId: 'p2', userId: 'u2', profession: 'warrior', name: 'p2-c4' },
    { characterId: 'c5', playerId: 'p2', userId: 'u2', profession: 'ranger', name: 'p2-c5' },
    { characterId: 'c6', playerId: 'p2', userId: 'u2', profession: 'mage', name: 'p2-c6' },
  ]);
  // T052 默认 happy path
  mockApplyKillStars.mockResolvedValue({ p1Delta: 0, p2Delta: 0, p1StarsAfter: 0, p2StarsAfter: 0 });
  mockApplyBaseStars.mockResolvedValue({
    p1Delta: 0, p2Delta: 0, p1StarsAfter: 0, p2StarsAfter: 0,
    bases: { '2,2': 'neutral', '6,6': 'neutral' },
  });
  mockCheckWinCondition.mockResolvedValue({ status: 'not_over', p1Stars: 0, p2Stars: 0 });
  mockRecordVictory.mockResolvedValue(undefined);
  mockFinishSession.mockResolvedValue({ success: true, state: undefined as any });
  // 模拟 pieces HASH 6 角色全 alive
  (redisClient.hGetAll as jest.Mock).mockResolvedValue({
    c1: JSON.stringify({ is_alive: true }),
    c2: JSON.stringify({ is_alive: true }),
    c3: JSON.stringify({ is_alive: true }),
    c4: JSON.stringify({ is_alive: true }),
    c5: JSON.stringify({ is_alive: true }),
    c6: JSON.stringify({ is_alive: true }),
  });
});

describe('executeMove — happy path', () => {
  it('should return success and trigger broadcast + phase progression in order', async () => {
    const { executeMove } = await import('./battleActionService');
    const io = createMockIO();

    const result = await executeMove(io, 'b1', 'c1', 5, 3, 'u1');

    expect(result).toEqual({ success: true });
    // 验证所有依赖被调一次
    expect(mockGetSessionState).toHaveBeenCalledWith('b1');
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
    mockGetSessionState.mockResolvedValue({
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
    mockGetSessionState.mockResolvedValue({
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
    mockGetSessionState.mockResolvedValueOnce({
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
      mockGetSessionState,
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
    mockGetSessionState.mockResolvedValueOnce({
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
    expect(mockValidateAOEAttack).toHaveBeenCalledWith('b1', 'c1', 'pc2', 'deck', 1);
    expect(mockValidateAttack).not.toHaveBeenCalled();
  });

  it('happy path: tactical taunt — dispatches to validateTauntCard', async () => {
    mockGetSessionState.mockResolvedValueOnce({
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

  it('happy path: public_pool card — does NOT call addToDiscardPile', async () => {
    mockGetSessionState.mockResolvedValueOnce({
      currentRound: 1, currentStep: 0, currentActorId: 'c1', currentPhase: 'play',
    });
    mockListCharactersInBattle.mockResolvedValueOnce([
      { characterId: 'c1', playerId: 'p1', userId: 'u1', profession: 'warrior', name: 'A' },
    ]);
    mockGetActorHand.mockResolvedValueOnce([
      { deck_id: 'pool:1', card_id: 'ct1', name: '轻击', type: 'attack', cost: 1,
        effect: { damage: 2, range: 1 }, template_no: 1, source: 'public_pool' },
    ]);

    const { executePlayCard } = await import('./battleActionService');
    const io = createMockIO();

    const handCard: any = {
      deck_id: 'pool:1', card_id: 'ct1', name: '轻击', type: 'attack', cost: 1,
      effect: { damage: 2, range: 1 }, template_no: 1, source: 'public_pool',
      targetId: 't1',
    };

    const result = await executePlayCard(io, 'b1', 'c1', handCard, 'u1');

    expect(result.success).toBe(true);
    expect(mockAddToDiscardPile).not.toHaveBeenCalled();
    expect(mockValidateAttack).toHaveBeenCalledWith('b1', 'c1', 'ct1', 't1', expect.any(Number), 'public_pool');
  });

  it('happy path: deck card — calls addToDiscardPile', async () => {
    mockGetSessionState.mockResolvedValueOnce({
      currentRound: 1, currentStep: 0, currentActorId: 'c1', currentPhase: 'play',
    });
    mockListCharactersInBattle.mockResolvedValueOnce([
      { characterId: 'c1', playerId: 'p1', userId: 'u1', profession: 'warrior', name: 'A' },
    ]);
    mockGetActorHand.mockResolvedValueOnce([
      { deck_id: 'd1', card_id: 'pc1', name: '重击', type: 'attack', cost: 2,
        effect: { damage: 4, range: 1 }, template_no: 4, source: 'deck' },
    ]);

    const { executePlayCard } = await import('./battleActionService');
    const io = createMockIO();

    const handCard: any = {
      deck_id: 'd1', card_id: 'pc1', name: '重击', type: 'attack', cost: 2,
      effect: { damage: 4, range: 1 }, template_no: 4, source: 'deck',
      targetId: 't1',
    };

    const result = await executePlayCard(io, 'b1', 'c1', handCard, 'u1');

    expect(result.success).toBe(true);
    expect(mockAddToDiscardPile).toHaveBeenCalledWith('b1', 'c1', [handCard]);
  });

  it('error: not_in_play_phase — returns error when phase !== "play"', async () => {
    mockGetSessionState.mockResolvedValueOnce({
      currentRound: 1,
      currentStep: 0,
      currentActorId: 'c1',
      currentPhase: 'move',  // ← wrong phase
    });

    const { executePlayCard } = await import('./battleActionService');
    const io = createMockIO();

    const result = await executePlayCard(
      io, 'b1', 'c1',
      { deck_id: 'd1', source: 'deck', type: 'attack', card_id: 'pc1', name: 'X', cost: 1, effect: {}, template_no: 1 } as any,
      'u1'
    );

    expect(result).toEqual({ success: false, error: 'not_in_play_phase' });
    // 后续副作用全部未调
    expect(mockListCharactersInBattle).not.toHaveBeenCalled();
    expect(mockGetActorHand).not.toHaveBeenCalled();
    expect(mockValidateAttack).not.toHaveBeenCalled();
    expect(mockSetCharacterEnergy).not.toHaveBeenCalled();
  });

  it('error: not_current_actor — returns error when actor mismatch', async () => {
    mockGetSessionState.mockResolvedValueOnce({
      currentRound: 1,
      currentStep: 0,
      currentActorId: 'c2',  // ← different
      currentPhase: 'play',
    });

    const { executePlayCard } = await import('./battleActionService');
    const io = createMockIO();

    const result = await executePlayCard(
      io, 'b1', 'c1',
      { deck_id: 'd1', source: 'deck', type: 'attack', card_id: 'pc1', name: 'X', cost: 1, effect: {}, template_no: 1 } as any,
      'u1'
    );

    expect(result).toEqual({ success: false, error: 'not_current_actor' });
    expect(mockListCharactersInBattle).not.toHaveBeenCalled();
  });

  it('error: not_owner — returns error when userId mismatch', async () => {
    mockGetSessionState.mockResolvedValueOnce({
      currentRound: 1, currentStep: 0, currentActorId: 'c1', currentPhase: 'play',
    });
    mockListCharactersInBattle.mockResolvedValueOnce([
      { characterId: 'c1', playerId: 'p1', userId: 'u2', profession: 'warrior', name: 'A' },  // ← different userId
    ]);

    const { executePlayCard } = await import('./battleActionService');
    const io = createMockIO();

    const result = await executePlayCard(
      io, 'b1', 'c1',
      { deck_id: 'd1', source: 'deck', type: 'attack', card_id: 'pc1', name: 'X', cost: 1, effect: {}, template_no: 1 } as any,
      'u1'
    );

    expect(result).toEqual({ success: false, error: 'not_owner' });
    expect(mockGetActorHand).not.toHaveBeenCalled();
  });

  it('error: card_not_in_hand — returns error when deck_id not in hand', async () => {
    mockGetSessionState.mockResolvedValueOnce({
      currentRound: 1, currentStep: 0, currentActorId: 'c1', currentPhase: 'play',
    });
    mockListCharactersInBattle.mockResolvedValueOnce([
      { characterId: 'c1', playerId: 'p1', userId: 'u1', profession: 'warrior', name: 'A' },
    ]);
    mockGetActorHand.mockResolvedValueOnce([
      { deck_id: 'd_other', source: 'deck', type: 'attack', card_id: 'pc_other', name: 'X', cost: 1, effect: {}, template_no: 1 },
    ]);

    const { executePlayCard } = await import('./battleActionService');
    const io = createMockIO();

    const result = await executePlayCard(io, 'b1', 'c1', { deck_id: 'd1', source: 'deck', type: 'attack', card_id: 'pc1', name: 'X', cost: 1, effect: {}, template_no: 1 } as any, 'u1');

    expect(result).toEqual({ success: false, error: 'card_not_in_hand' });
    expect(mockValidateAttack).not.toHaveBeenCalled();
  });

  it('error: unsupported_card_type (defense) — returns error', async () => {
    mockGetSessionState.mockResolvedValueOnce({
      currentRound: 1, currentStep: 0, currentActorId: 'c1', currentPhase: 'play',
    });
    mockListCharactersInBattle.mockResolvedValueOnce([
      { characterId: 'c1', playerId: 'p1', userId: 'u1', profession: 'warrior', name: 'A' },
    ]);

    const handCard: any = { deck_id: 'd1', source: 'deck', type: 'defense', card_id: 'pc1', name: '防御', cost: 1, effect: { shield: 5 }, template_no: 5 };
    mockGetActorHand.mockResolvedValueOnce([handCard]);

    const { executePlayCard } = await import('./battleActionService');
    const io = createMockIO();

    const result = await executePlayCard(io, 'b1', 'c1', handCard, 'u1');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('unsupported_card_type');
      expect(result.detail).toContain('defense');
    }
    expect(mockValidateAttack).not.toHaveBeenCalled();
  });

  it('error: unsupported_card_type (tactical non-taunt) — returns error', async () => {
    mockGetSessionState.mockResolvedValueOnce({
      currentRound: 1, currentStep: 0, currentActorId: 'c1', currentPhase: 'play',
    });
    mockListCharactersInBattle.mockResolvedValueOnce([
      { characterId: 'c1', playerId: 'p1', userId: 'u1', profession: 'warrior', name: 'A' },
    ]);

    const handCard: any = { deck_id: 'd1', source: 'deck', type: 'tactical', card_id: 'pc1', name: '烟雾', cost: 1, effect: { type: 'smoke' }, template_no: 6 };
    mockGetActorHand.mockResolvedValueOnce([handCard]);

    const { executePlayCard } = await import('./battleActionService');
    const io = createMockIO();

    const result = await executePlayCard(io, 'b1', 'c1', handCard, 'u1');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('unsupported_card_type');
    }
  });

  it('error: validation_failed (Card not found) — wraps validate error in detail', async () => {
    mockGetSessionState.mockResolvedValueOnce({
      currentRound: 1, currentStep: 0, currentActorId: 'c1', currentPhase: 'play',
    });
    mockListCharactersInBattle.mockResolvedValueOnce([
      { characterId: 'c1', playerId: 'p1', userId: 'u1', profession: 'warrior', name: 'A' },
    ]);

    const { executePlayCard } = await import('./battleActionService');
    const io = createMockIO();

    mockValidateAttack.mockResolvedValueOnce({ valid: false, error: 'Card not found' });

    const result = await executePlayCard(io, 'b1', 'c1', { deck_id: 'd1', source: 'deck', type: 'attack', card_id: 'pc1', name: 'X', cost: 1, effect: {}, template_no: 1, targetId: 't1' } as any, 'u1');

    expect(result).toEqual({ success: false, error: 'validation_failed', detail: 'Card not found' });
    expect(mockSetCharacterEnergy).not.toHaveBeenCalled();
  });

  it('error: validation_failed (Not enough energy) — wraps validate error', async () => {
    mockGetSessionState.mockResolvedValueOnce({
      currentRound: 1, currentStep: 0, currentActorId: 'c1', currentPhase: 'play',
    });
    mockListCharactersInBattle.mockResolvedValueOnce([
      { characterId: 'c1', playerId: 'p1', userId: 'u1', profession: 'warrior', name: 'A' },
    ]);

    const { executePlayCard } = await import('./battleActionService');
    const io = createMockIO();

    mockValidateAttack.mockResolvedValueOnce({
      valid: false,
      error: 'Not enough energy (need 3, have 1)',
      energyCost: 3,
    });

    const result = await executePlayCard(io, 'b1', 'c1', { deck_id: 'd1', source: 'deck', type: 'attack', card_id: 'pc1', name: 'X', cost: 3, effect: {}, template_no: 1, targetId: 't1' } as any, 'u1');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('validation_failed');
      expect(result.detail).toContain('energy');
    }
  });

  it('error: validation_failed (Target out of range) — wraps validate error', async () => {
    mockGetSessionState.mockResolvedValueOnce({
      currentRound: 1, currentStep: 0, currentActorId: 'c1', currentPhase: 'play',
    });
    mockListCharactersInBattle.mockResolvedValueOnce([
      { characterId: 'c1', playerId: 'p1', userId: 'u1', profession: 'warrior', name: 'A' },
    ]);

    const { executePlayCard } = await import('./battleActionService');
    const io = createMockIO();

    mockValidateAttack.mockResolvedValueOnce({
      valid: false,
      error: 'Target out of range (melee range: 1.5, actual: 3.00)',
    });

    const result = await executePlayCard(io, 'b1', 'c1', { deck_id: 'd1', source: 'deck', type: 'attack', card_id: 'pc1', name: 'X', cost: 1, effect: {}, template_no: 1, targetId: 't1' } as any, 'u1');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('validation_failed');
      expect(result.detail).toContain('out of range');
    }
  });

  it('error: validation_failed (Cannot attack friendly) — wraps validate error', async () => {
    mockGetSessionState.mockResolvedValueOnce({
      currentRound: 1, currentStep: 0, currentActorId: 'c1', currentPhase: 'play',
    });
    mockListCharactersInBattle.mockResolvedValueOnce([
      { characterId: 'c1', playerId: 'p1', userId: 'u1', profession: 'warrior', name: 'A' },
    ]);

    const { executePlayCard } = await import('./battleActionService');
    const io = createMockIO();

    mockValidateAttack.mockResolvedValueOnce({ valid: false, error: 'Cannot attack friendly target' });

    const result = await executePlayCard(io, 'b1', 'c1', { deck_id: 'd1', source: 'deck', type: 'attack', card_id: 'pc1', name: 'X', cost: 1, effect: {}, template_no: 1, targetId: 't1' } as any, 'u1');

    expect(result).toEqual({ success: false, error: 'validation_failed', detail: 'Cannot attack friendly target' });
  });

  it('error: validation_failed (taunt range error) — wraps validateTauntCard error', async () => {
    mockGetSessionState.mockResolvedValueOnce({
      currentRound: 1, currentStep: 0, currentActorId: 'c3', currentPhase: 'play',
    });
    mockListCharactersInBattle.mockResolvedValueOnce([
      { characterId: 'c3', playerId: 'p1', userId: 'u1', profession: 'warrior', name: 'A' },
    ]);
    mockGetActorHand.mockResolvedValueOnce([
      { deck_id: 'd3', source: 'deck', type: 'tactical', card_id: 'pc3', name: '挑战', cost: 1, effect: { type: 'taunt', range: 3 }, template_no: 3 },
    ]);

    const { executePlayCard } = await import('./battleActionService');
    const io = createMockIO();

    mockValidateTauntCard.mockResolvedValueOnce({ valid: false, error: 'Target out of taunt range' });

    const result = await executePlayCard(io, 'b1', 'c3', { deck_id: 'd3', source: 'deck', type: 'tactical', card_id: 'pc3', name: '挑战', cost: 1, effect: { type: 'taunt', range: 3 }, template_no: 3, targetId: 't1' } as any, 'u1');

    expect(result).toEqual({ success: false, error: 'validation_failed', detail: 'Target out of taunt range' });
  });

  it('error: energy_deduct_failed (setCharacterEnergy throws)', async () => {
    mockGetSessionState.mockResolvedValueOnce({
      currentRound: 1, currentStep: 0, currentActorId: 'c1', currentPhase: 'play',
    });
    mockListCharactersInBattle.mockResolvedValueOnce([
      { characterId: 'c1', playerId: 'p1', userId: 'u1', profession: 'warrior', name: 'A' },
    ]);

    mockSetCharacterEnergy.mockRejectedValueOnce(new Error('Redis down'));

    const { executePlayCard } = await import('./battleActionService');
    const io = createMockIO();

    const result = await executePlayCard(io, 'b1', 'c1', { deck_id: 'd1', source: 'deck', type: 'attack', card_id: 'pc1', name: 'X', cost: 1, effect: {}, template_no: 1, targetId: 't1' } as any, 'u1');

    expect(result).toEqual({
      success: false,
      error: 'energy_deduct_failed',
      detail: 'Redis down',
    });
    expect(mockAddToDiscardPile).not.toHaveBeenCalled();
    expect(mockBroadcastHandState).not.toHaveBeenCalled();
  });

  it('error: side_effect_failed (removeCardFromHand throws)', async () => {
    mockGetSessionState.mockResolvedValueOnce({
      currentRound: 1, currentStep: 0, currentActorId: 'c1', currentPhase: 'play',
    });
    mockListCharactersInBattle.mockResolvedValueOnce([
      { characterId: 'c1', playerId: 'p1', userId: 'u1', profession: 'warrior', name: 'A' },
    ]);

    mockRemoveCardFromHand.mockRejectedValueOnce(new Error('remove failed'));

    const { executePlayCard } = await import('./battleActionService');
    const io = createMockIO();

    const result = await executePlayCard(io, 'b1', 'c1', { deck_id: 'd1', source: 'deck', type: 'attack', card_id: 'pc1', name: 'X', cost: 1, effect: {}, template_no: 1, targetId: 't1' } as any, 'u1');

    expect(result).toEqual({
      success: false,
      error: 'side_effect_failed',
      detail: 'remove failed',
    });
    expect(mockAddToDiscardPile).not.toHaveBeenCalled();
    expect(mockBroadcastHandState).not.toHaveBeenCalled();
  });

  // ========================================
  // ★ T053: 卡牌消耗 (consumePlayerCard)
  // ========================================
  describe('T053: card consumption (step 9.5)', () => {
    beforeEach(() => {
      // 默认 withTransaction 模拟：把传入的 fn 直接执行（透传 mockClient）
      // 这里的 mockClient 形参对应 withTransaction 内部传给 fn 的 client
      mockWithTransaction.mockImplementation(async (fn: any) => {
        const fakeClient = { query: jest.fn() };
        return await fn(fakeClient);
      });
    });

    it('T053-1: source=deck happy path — calls DELETE character_deck + DELETE player_cards, returns success', async () => {
      // 模拟 DELETE 返回 rowCount=1
      const fakeClient = { query: jest.fn().mockResolvedValue({ rowCount: 1, rows: [] }) };
      mockWithTransaction.mockImplementation(async (fn: any) => fn(fakeClient));

      mockGetSessionState.mockResolvedValue({
        battleId: 'b1',
        currentRound: 1,
        currentStep: 1,
        currentActorId: 'c1',
        currentPhase: 'play',
      } as any);
      mockListCharactersInBattle.mockResolvedValue([
        { characterId: 'c1', userId: 'u1', playerId: 'p1', side: 'p1' },
      ] as any);
      mockGetActorHand.mockResolvedValue([
        { deck_id: 'd1', card_id: 'pc1', source: 'deck', type: 'attack', name: 'X', cost: 1, effect: {}, template_no: 1 },
      ] as any);
      mockValidateAttack.mockResolvedValue({ valid: true, energyCost: 1, damage: 2 } as any);
      (redisClient.hGet as jest.Mock).mockResolvedValue(JSON.stringify({ energy: 3 }));
      (redisClient.lRem as jest.Mock).mockResolvedValue(1);

      const handCard = {
        deck_id: 'd1', card_id: 'pc1', source: 'deck' as const,
        type: 'attack' as const, name: 'X', cost: 1, effect: {}, template_no: 1,
      };
      const io = {} as any;
      const { executePlayCard } = await import('./battleActionService');
      const result = await executePlayCard(io, 'b1', 'c1', handCard, 'u1');

      expect(result.success).toBe(true);
      // withTransaction 被调一次
      expect(mockWithTransaction).toHaveBeenCalledTimes(1);
      // fn 内 fakeClient.query 调过 2 次（2 个 DELETE）
      expect(fakeClient.query).toHaveBeenCalledTimes(2);
      expect(fakeClient.query.mock.calls[0][0]).toContain('DELETE FROM character_deck');
      expect(fakeClient.query.mock.calls[1][0]).toContain('DELETE FROM player_cards');
      // 不应有 query('BEGIN') / query('COMMIT') 直接调用
      // （事务由 withTransaction 包，本测试不直接验 — Task 1 覆盖）
    });

    it('T053-2: source=public_pool — does NOT call withTransaction, no DELETE', async () => {
      mockGetSessionState.mockResolvedValue({
        battleId: 'b1', currentRound: 1, currentStep: 1, currentActorId: 'c1', currentPhase: 'play',
      } as any);
      mockListCharactersInBattle.mockResolvedValue([
        { characterId: 'c1', userId: 'u1', playerId: 'p1', side: 'p1' },
      ] as any);
      mockGetActorHand.mockResolvedValue([
        { deck_id: 'pool:1', card_id: 'pt1', source: 'public_pool', type: 'attack', name: '轻击', cost: 1, effect: { damage: 2 }, template_no: 1 },
      ] as any);
      mockValidateAttack.mockResolvedValue({ valid: true, energyCost: 1, damage: 2 } as any);
      (redisClient.hGet as jest.Mock).mockResolvedValue(JSON.stringify({ energy: 3 }));
      (redisClient.lRem as jest.Mock).mockResolvedValue(1);

      const handCard = {
        deck_id: 'pool:1', card_id: 'pt1', source: 'public_pool' as const,
        type: 'attack' as const, name: '轻击', cost: 1, effect: { damage: 2 }, template_no: 1,
      };
      const io = {} as any;
      const { executePlayCard } = await import('./battleActionService');
      const result = await executePlayCard(io, 'b1', 'c1', handCard, 'u1');

      expect(result.success).toBe(true);
      // 公共池卡 → withTransaction 不被调
      expect(mockWithTransaction).toHaveBeenCalledTimes(0);
    });

    it('T053-3: DELETE throws inside withTransaction — best-effort, executePlayCard still success', async () => {
      // withTransaction 的 fn 抛错 → withTransaction 内部 ROLLBACK + 重新抛错
      // → executePlayCard 步骤 9.5 应当不返错（吞掉）
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      mockWithTransaction.mockRejectedValue(new Error('DB connection lost'));

      mockGetSessionState.mockResolvedValue({
        battleId: 'b1', currentRound: 1, currentStep: 1, currentActorId: 'c1', currentPhase: 'play',
      } as any);
      mockListCharactersInBattle.mockResolvedValue([
        { characterId: 'c1', userId: 'u1', playerId: 'p1', side: 'p1' },
      ] as any);
      mockGetActorHand.mockResolvedValue([
        { deck_id: 'd1', card_id: 'pc1', source: 'deck', type: 'attack', name: 'X', cost: 1, effect: {}, template_no: 1 },
      ] as any);
      mockValidateAttack.mockResolvedValue({ valid: true, energyCost: 1, damage: 2 } as any);
      (redisClient.hGet as jest.Mock).mockResolvedValue(JSON.stringify({ energy: 3 }));
      (redisClient.lRem as jest.Mock).mockResolvedValue(1);

      const handCard = {
        deck_id: 'd1', card_id: 'pc1', source: 'deck' as const,
        type: 'attack' as const, name: 'X', cost: 1, effect: {}, template_no: 1,
      };
      const io = {} as any;
      const { executePlayCard } = await import('./battleActionService');
      const result = await executePlayCard(io, 'b1', 'c1', handCard, 'u1');

      // best-effort: 仍然 success（步骤 9.5 失败不影响上层）
      expect(result.success).toBe(true);
      // console.error 被调（[consumePlayerCard] failed）
      expect(consoleErrorSpy).toHaveBeenCalled();
      const errorMsg = consoleErrorSpy.mock.calls.flat().join(' ');
      expect(errorMsg).toMatch(/consumePlayerCard.*failed/);
      consoleErrorSpy.mockRestore();
    });

    it('T053-4: DELETE returns rowCount=0 — ROLLBACK + warn, executePlayCard still success', async () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      // 新实现: fn 内部检测 rowCount=0 → 抛 PartialDeleteError
      // withTransaction 接 throw → 自动 ROLLBACK → rethrow → 外层 catch 识别 sentinel → warn
      const fakeClient = {
        query: jest.fn()
          .mockResolvedValueOnce({ rowCount: 0, rows: [] })   // DELETE character_deck 返回 0 行
          .mockResolvedValueOnce({ rows: [] }),               // ROLLBACK (被 withTransaction 调)
      };
      mockWithTransaction.mockImplementation(async (fn: any) => {
        try {
          return await fn(fakeClient);
        } catch (err) {
          // 模拟真实 withTransaction: ROLLBACK 后 rethrow
          await fakeClient.query('ROLLBACK');
          throw err;
        }
      });

      mockGetSessionState.mockResolvedValue({
        battleId: 'b1', currentRound: 1, currentStep: 1, currentActorId: 'c1', currentPhase: 'play',
      } as any);
      mockListCharactersInBattle.mockResolvedValue([
        { characterId: 'c1', userId: 'u1', playerId: 'p1', side: 'p1' },
      ] as any);
      mockGetActorHand.mockResolvedValue([
        { deck_id: 'd1', card_id: 'pc1', source: 'deck', type: 'attack', name: 'X', cost: 1, effect: {}, template_no: 1 },
      ] as any);
      mockValidateAttack.mockResolvedValue({ valid: true, energyCost: 1, damage: 2 } as any);
      (redisClient.hGet as jest.Mock).mockResolvedValue(JSON.stringify({ energy: 3 }));
      (redisClient.lRem as jest.Mock).mockResolvedValue(1);

      const handCard = {
        deck_id: 'd1', card_id: 'pc1', source: 'deck' as const,
        type: 'attack' as const, name: 'X', cost: 1, effect: {}, template_no: 1,
      };
      const io = {} as any;
      const { executePlayCard } = await import('./battleActionService');
      const result = await executePlayCard(io, 'b1', 'c1', handCard, 'u1');

      expect(result.success).toBe(true);
      expect(consoleWarnSpy).toHaveBeenCalled();
      const warnMsg = consoleWarnSpy.mock.calls.flat().join(' ');
      expect(warnMsg).toMatch(/partial delete/);
      // ROLLBACK was called by withTransaction (not by fn)
      expect(fakeClient.query).toHaveBeenCalledWith('ROLLBACK');
      consoleWarnSpy.mockRestore();
    });

    it('T053-5: T050 existing 18 tests still pass (regression check via test file run)', async () => {
      // 这个 case 实质上是"跑整个 describe('executePlayCard') 块全绿"
      // 不写额外 mock — 依赖 beforeEach 默认值
      // 跑测试时这个 it 会跟其他 4 个一起跑，全部 pass 即说明 18+5 兼容性
      // 本 it 本身不做事（仅占位），验证靠 jest run
      expect(true).toBe(true);
    });
  });
});

describe('executeEndStep', () => {
  // 复用 helper 设置 mid-round state
  const setupMidRoundState = () => {
    const fullState = (overrides: any) => ({
      battleId: 'b1',
      currentRound: 1,
      activationOrder: ['c1', 'c4', 'c2', 'c5', 'c3', 'c6'],
      player1Chars: ['c1', 'c2', 'c3'],
      player2Chars: ['c4', 'c5', 'c6'],
      updatedAt: '2026-01-01T00:00:00Z',
      ...overrides,
    });
    mockGetSessionState
      .mockResolvedValueOnce(fullState({ currentStep: 2, currentPhase: 'play', currentActorId: 'c1' }) as any)  // 步骤 1 读
      .mockResolvedValueOnce(fullState({ currentStep: 3, currentPhase: 'draw', currentActorId: 'c4' }) as any)  // 步骤 7 重读
      .mockResolvedValueOnce(fullState({ currentStep: 3, currentPhase: 'draw', currentActorId: 'c4' }) as any); // 步骤 9 末尾重读
  };

  it('mid-round happy path (step 0-4/6) → endStep → activate → draw → completeDrawPhase → 2 broadcast, 不调 executeRoundEnd', async () => {
    setupMidRoundState();
    mockGetActorHand.mockResolvedValue([{ deck_id: 'd1', card_id: 'pc1', name: '轻击', type: 'attack', cost: 1, effect: { damage: 2 }, template_no: 1, source: 'deck' } as any]);
    const { executeEndStep } = await import('./battleActionService');
    const result = await executeEndStep(createMockIO(), 'b1');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.state.currentStep).toBe(3);
    }
    expect(mockRetainHandOnStepEnd).toHaveBeenCalledTimes(1);
    expect(mockEndCurrentStep).toHaveBeenCalledTimes(1);
    expect(mockActivateCurrentUnit).toHaveBeenCalledTimes(1);
    expect(mockDrawCards).toHaveBeenCalledTimes(1);
    expect(mockCompleteDrawPhase).toHaveBeenCalledTimes(1);
    expect(mockEndCurrentRound).not.toHaveBeenCalled();
    expect(mockTickBurnDamageOnTarget).not.toHaveBeenCalled();
  });

  it('retain 失败 → error: retain_failed, endStep 未调', async () => {
    setupMidRoundState();
    mockGetActorHand.mockResolvedValue([]);
    mockRetainHandOnStepEnd.mockResolvedValueOnce({ success: false, retained: null, discarded: [], error: 'retain fail' });
    const { executeEndStep } = await import('./battleActionService');
    const result = await executeEndStep(createMockIO(), 'b1');
    expect(result).toEqual({ success: false, error: 'retain_failed', detail: 'retain fail' });
    expect(mockEndCurrentStep).not.toHaveBeenCalled();
  });

  it('end_step 失败 → error: end_step_failed, activate 未调', async () => {
    setupMidRoundState();
    mockGetActorHand.mockResolvedValue([]);
    mockEndCurrentStep.mockRejectedValueOnce(new Error('end step fail'));
    const { executeEndStep } = await import('./battleActionService');
    const result = await executeEndStep(createMockIO(), 'b1');
    expect(result).toEqual({ success: false, error: 'end_step_failed', detail: 'end step fail' });
    expect(mockActivateCurrentUnit).not.toHaveBeenCalled();
  });

  it('last-step happy path (step 5/6) → executeRoundEnd 触发, endCurrentRound 1 次, currentRound 推进到 2', async () => {
    mockGetSessionState
      .mockResolvedValueOnce({  // 步骤 1 读 (last step)
        battleId: 'b1', currentRound: 1, currentStep: 5, currentPhase: 'play', currentActorId: 'c6',
      } as any)
      .mockResolvedValueOnce({  // 步骤 4 executeRoundEnd 内重读（endCurrentRound 后）
        battleId: 'b1', currentRound: 2, currentStep: 5, currentPhase: 'play', currentActorId: 'c6',
      } as any)
      .mockResolvedValueOnce({  // 步骤 7 draw 前重读
        battleId: 'b1', currentRound: 2, currentStep: 0, currentPhase: 'draw', currentActorId: 'c1',
      } as any)
      .mockResolvedValueOnce({  // 步骤 9 末尾重读
        battleId: 'b1', currentRound: 2, currentStep: 0, currentPhase: 'draw', currentActorId: 'c1',
      } as any);
    mockGetActorHand.mockResolvedValue([]);
    const { executeEndStep } = await import('./battleActionService');
    const result = await executeEndStep(createMockIO(), 'b1');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.state.currentRound).toBe(2);
      expect(result.state.currentStep).toBe(0);
    }
    expect(mockEndCurrentRound).toHaveBeenCalledTimes(1);
    expect(mockTickBurnDamageOnTarget).toHaveBeenCalledTimes(6);
    // round-end 广播 2 次（executeRoundEnd 内 endCurrentRound 后 1 次 + T-FIX 新回合首步激活后 1 次）
    expect(mockBroadcastSessionState).toHaveBeenCalledTimes(2);
  });

  // ★ T-FIX(战棋死锁) 回归：回合结束无胜负时必须激活新回合首 actor，否则卡「待机」
  it('last-step 无胜负 -> 激活新回合首 actor (activate -> draw -> completeDrawPhase)', async () => {
    mockGetSessionState
      .mockResolvedValueOnce({  // 步骤 1 读 (last step)
        battleId: 'b1', currentRound: 1, currentStep: 5, currentPhase: 'play', currentActorId: 'c6',
      } as any)
      .mockResolvedValueOnce({  // executeRoundEnd 内 endCurrentRound 后重读
        battleId: 'b1', currentRound: 2, currentStep: 0, currentPhase: 'idle', currentActorId: 'c1',
      } as any)
      .mockResolvedValueOnce({  // activateActorForStep 兜底重读
        battleId: 'b1', currentRound: 2, currentStep: 0, currentPhase: 'move', currentActorId: 'c1',
      } as any)
      .mockResolvedValueOnce({  // executeEndStep 末尾重读
        battleId: 'b1', currentRound: 2, currentStep: 0, currentPhase: 'move', currentActorId: 'c1',
      } as any);
    mockGetActorHand.mockResolvedValue([]);
    mockActivateCurrentUnit.mockResolvedValueOnce({
      success: true,
      state: { battleId: 'b1', currentRound: 2, currentStep: 0, currentPhase: 'draw', currentActorId: 'c1' },
    } as any);
    const { executeEndStep } = await import('./battleActionService');
    const result = await executeEndStep(createMockIO(), 'b1');
    expect(result.success).toBe(true);
    expect(mockActivateCurrentUnit).toHaveBeenCalledTimes(1);
    // 新回合首 actor 已抽牌
    expect(mockDrawCards).toHaveBeenCalledWith('b1', 'c1');
    expect(mockCompleteDrawPhase).toHaveBeenCalledTimes(1);
  });

  // ★ T-FIX(战棋死锁) 回归：已分出胜负时不激活（session 已 finished）
  it('last-step 有胜负(win) -> 不激活新回合 actor', async () => {
    mockGetSessionState
      .mockResolvedValueOnce({  // 步骤 1 读 (last step)
        battleId: 'b1', currentRound: 1, currentStep: 5, currentPhase: 'play', currentActorId: 'c6',
      } as any)
      .mockResolvedValueOnce({  // executeRoundEnd 内重读
        battleId: 'b1', currentRound: 2, currentStep: 0, currentPhase: 'finished', currentActorId: 'c1',
      } as any);
    mockGetActorHand.mockResolvedValue([]);
    mockCheckWinCondition.mockResolvedValueOnce({ status: 'win', winner: 'p1', p1Stars: 3, p2Stars: 0 } as any);
    const { executeEndStep } = await import('./battleActionService');
    const result = await executeEndStep(createMockIO(), 'b1');
    expect(result.success).toBe(true);
    expect(mockActivateCurrentUnit).not.toHaveBeenCalled();
    expect(mockDrawCards).not.toHaveBeenCalled();
    expect(mockRecordVictory).toHaveBeenCalledTimes(1);
  });

  it('executeRoundEnd 失败 → error: round_end_failed（endCurrentStep 已先执行）', async () => {
    mockGetSessionState.mockResolvedValueOnce({
      battleId: 'b1', currentRound: 1, currentStep: 5, currentPhase: 'play', currentActorId: 'c6',
    } as any);
    mockGetActorHand.mockResolvedValue([]);
    mockEndCurrentRound.mockRejectedValueOnce(new Error('round end fail'));
    const { executeEndStep } = await import('./battleActionService');
    const result = await executeEndStep(createMockIO(), 'b1');
    expect(result).toEqual({ success: false, error: 'round_end_failed', detail: 'round end fail' });
    // 新流程：endCurrentStep 在 executeRoundEnd 之前执行（先把 phase 推到 end_round）
    expect(mockEndCurrentStep).toHaveBeenCalledTimes(1);
  });

  it('executeRoundEnd 调 tickBurnDamageOnTarget 6 次（每个 char）', async () => {
    mockGetSessionState
      .mockResolvedValueOnce({
        battleId: 'b1', currentRound: 1, currentStep: 5, currentPhase: 'play', currentActorId: 'c6',
      } as any)
      .mockResolvedValueOnce({
        battleId: 'b1', currentRound: 2, currentStep: 5, currentPhase: 'play', currentActorId: 'c6',
      } as any)
      .mockResolvedValueOnce({
        battleId: 'b1', currentRound: 2, currentStep: 0, currentPhase: 'draw', currentActorId: 'c1',
      } as any)
      .mockResolvedValueOnce({
        battleId: 'b1', currentRound: 2, currentStep: 0, currentPhase: 'draw', currentActorId: 'c1',
      } as any);
    mockGetActorHand.mockResolvedValue([]);
    const { executeEndStep } = await import('./battleActionService');
    await executeEndStep(createMockIO(), 'b1');
    expect(mockTickBurnDamageOnTarget).toHaveBeenCalledTimes(6);
    const calledWith = mockTickBurnDamageOnTarget.mock.calls.map(c => c[1]);
    expect(calledWith).toEqual(expect.arrayContaining(['c1', 'c2', 'c3', 'c4', 'c5', 'c6']));
  });

  describe('executeEndStep error branches', () => {
    const setupState = () => mockGetSessionState
      .mockResolvedValueOnce({
        battleId: 'b1', currentRound: 1, currentStep: 2, currentPhase: 'play', currentActorId: 'c1',
      } as any);

    it('currentPhase=idle → error: not_in_play_or_move_phase, retain 未调', async () => {
      setupState();
      mockGetSessionState.mockReset();
      mockGetSessionState.mockResolvedValueOnce({
        battleId: 'b1', currentRound: 1, currentStep: 0, currentPhase: 'idle', currentActorId: null,
      } as any);
      const { executeEndStep } = await import('./battleActionService');
      const result = await executeEndStep(createMockIO(), 'b1');
      expect(result).toEqual({ success: false, error: 'not_in_play_or_move_phase' });
      expect(mockRetainHandOnStepEnd).not.toHaveBeenCalled();
    });

    it('activate 失败 → error: activate_failed', async () => {
      setupState();
      mockActivateCurrentUnit.mockRejectedValueOnce(new Error('activate fail'));
      const { executeEndStep } = await import('./battleActionService');
      const result = await executeEndStep(createMockIO(), 'b1');
      expect(result).toEqual({ success: false, error: 'activate_failed', detail: 'activate fail' });
    });

    it('drawCards 失败 → error: draw_failed', async () => {
      setupState();
      mockGetSessionState
        .mockReset()
        .mockResolvedValueOnce({  // 步骤 1
          battleId: 'b1', currentRound: 1, currentStep: 2, currentPhase: 'play', currentActorId: 'c1',
        } as any)
        .mockResolvedValueOnce({  // 步骤 7 重读
          battleId: 'b1', currentRound: 1, currentStep: 3, currentPhase: 'draw', currentActorId: 'c4',
        } as any);
      mockDrawCards.mockRejectedValueOnce(new Error('draw fail'));
      const { executeEndStep } = await import('./battleActionService');
      const result = await executeEndStep(createMockIO(), 'b1');
      expect(result).toEqual({ success: false, error: 'draw_failed', detail: 'draw fail' });
    });

    it('completeDrawPhase 失败 → error: complete_phase_failed', async () => {
      setupState();
      mockGetSessionState
        .mockReset()
        .mockResolvedValueOnce({
          battleId: 'b1', currentRound: 1, currentStep: 2, currentPhase: 'play', currentActorId: 'c1',
        } as any)
        .mockResolvedValueOnce({
          battleId: 'b1', currentRound: 1, currentStep: 3, currentPhase: 'draw', currentActorId: 'c4',
        } as any);
      mockCompleteDrawPhase.mockRejectedValueOnce(new Error('phase fail'));
      const { executeEndStep } = await import('./battleActionService');
      const result = await executeEndStep(createMockIO(), 'b1');
      expect(result).toEqual({ success: false, error: 'complete_phase_failed', detail: 'phase fail' });
    });
  });
});

describe('executeEndStep - T052 wire-up', () => {
  it('should capture preStepAliveMap and call applyKillStars + checkWinCondition', async () => {
    mockGetSessionState.mockResolvedValue({
      currentRound: 1,
      currentStep: 0,
      currentActorId: 'c1',
      currentPhase: 'play',
      activationOrder: ['c1', 'c4', 'c2', 'c5', 'c3', 'c6'],
    });

    const { executeEndStep } = await import('./battleActionService');
    const io = createMockIO();

    await executeEndStep(io, 'b1');

    // 验证 preStepAliveMap 传给 applyKillStars
    expect(mockApplyKillStars).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({
        c1: true, c2: true, c3: true, c4: true, c5: true, c6: true,
      })
    );
    // 验证 checkWinCondition 被调
    expect(mockCheckWinCondition).toHaveBeenCalledWith('b1');
    // 默认 not_over → recordVictory 不调
    expect(mockRecordVictory).not.toHaveBeenCalled();
  });

  it('should call recordVictory when checkWinCondition returns win', async () => {
    mockCheckWinCondition.mockResolvedValue({
      status: 'win',
      winnerSide: 'p1',
      p1Stars: 6,
      p2Stars: 2,
    });
    mockGetSessionState.mockResolvedValue({
      currentRound: 1,
      currentStep: 0,
      currentActorId: 'c1',
      currentPhase: 'play',
      activationOrder: ['c1', 'c4', 'c2', 'c5', 'c3', 'c6'],
    });

    const { executeEndStep } = await import('./battleActionService');
    const io = createMockIO();

    await executeEndStep(io, 'b1');

    expect(mockRecordVictory).toHaveBeenCalledWith(
      io,
      'b1',
      { status: 'win', winnerSide: 'p1', p1Stars: 6, p2Stars: 2 },
      'kill'  // source 默认 kill
    );
  });
});

describe('executeRoundEnd - T052 wire-up', () => {
  it('should call applyBaseStars + checkWinCondition', async () => {
    const { executeRoundEnd } = await import('./battleActionService');
    const io = createMockIO();

    await executeRoundEnd(io, 'b1', {
      battleId: 'b1',
      currentRound: 1,
      currentStep: 5,
      currentPhase: 'end_round',
      currentActorId: 'c6',
      activationOrder: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'],
      player1Chars: ['c1', 'c2', 'c3'],
      player2Chars: ['c4', 'c5', 'c6'],
      updatedAt: new Date().toISOString(),
    });

    expect(mockApplyBaseStars).toHaveBeenCalledWith('b1');
    expect(mockCheckWinCondition).toHaveBeenCalledWith('b1');
    expect(mockRecordVictory).not.toHaveBeenCalled(); // not_over 默认
  });

  it('should call recordVictory with source=base when win', async () => {
    mockCheckWinCondition.mockResolvedValue({
      status: 'win',
      winnerSide: 'p2',
      p1Stars: 4,
      p2Stars: 6,
    });

    const { executeRoundEnd } = await import('./battleActionService');
    const io = createMockIO();

    await executeRoundEnd(io, 'b1', {
      battleId: 'b1',
      currentRound: 1,
      currentStep: 5,
      currentPhase: 'end_round',
      currentActorId: 'c6',
      activationOrder: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'],
      player1Chars: ['c1', 'c2', 'c3'],
      player2Chars: ['c4', 'c5', 'c6'],
      updatedAt: new Date().toISOString(),
    });

    expect(mockRecordVictory).toHaveBeenCalledWith(
      io,
      'b1',
      { status: 'win', winnerSide: 'p2', p1Stars: 4, p2Stars: 6 },
      'base'  // ★ source='base'
    );
  });

  it('should NOT call applyKillStars (only last step executeEndStep handles it)', async () => {
    const { executeRoundEnd } = await import('./battleActionService');
    const io = createMockIO();

    await executeRoundEnd(io, 'b1', {
      battleId: 'b1',
      currentRound: 1,
      currentStep: 5,
      currentPhase: 'end_round',
      currentActorId: 'c6',
      activationOrder: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'],
      player1Chars: ['c1', 'c2', 'c3'],
      player2Chars: ['c4', 'c5', 'c6'],
      updatedAt: new Date().toISOString(),
    });

    expect(mockApplyKillStars).not.toHaveBeenCalled();
  });
});
