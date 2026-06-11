// ========================================
// T047 单元测试 —— battleStateBroadcaster
// ========================================
// 7 用例:
//   1. buildBoardState happy path(6 角色)
//   2. buildBoardState 空 board(0 角色)
//   3. buildBoardState 战斗已消失 → throws
//   4. broadcastBoardState 推 room
//   5. broadcastHandState 推 user-room + 单角色手牌
//   6. broadcastFullState 组合 board + ownHand 推 user-room
//   7. broadcastCharacterStatus 单角色推 room
//
// jest.mock 必须在 import 之前(ts-jest TDZ 坑)

import type { Server as IOServer } from 'socket.io';

// ============== Mocks ==============

const mockListCharactersInBattle = jest.fn();
const mockGetAllBoardPositions = jest.fn();

const mockGetCharacterStatus = jest.fn();

const mockGetActorHand = jest.fn();

const mockGetDbSessionState = jest.fn();

jest.mock('../services/battleService', () => ({
  listCharactersInBattle: mockListCharactersInBattle,
  getAllBoardPositions: mockGetAllBoardPositions,
}));

jest.mock('../services/characterStatusService', () => ({
  getCharacterStatus: mockGetCharacterStatus,
}));

jest.mock('../services/handService', () => ({
  getActorHand: mockGetActorHand,
}));

jest.mock('../services/battleSessionService', () => ({
  getDbSessionState: mockGetDbSessionState,
}));

import {
  buildBoardState,
  broadcastBoardState,
  broadcastHandState,
  broadcastCharacterStatus,
  broadcastFullState,
} from './battleStateBroadcaster';

// ============== io mock ==============

const mockEmit = jest.fn();
const mockTo = jest.fn(() => ({ emit: mockEmit }));
const mockIo = { to: mockTo } as unknown as IOServer;

// ============== 测试 fixtures ==============

const BATTLE_ID = 'battle-1';
const USER_P1 = 'user-p1';
const USER_P2 = 'user-p2';

const sampleCharacters = [
  { characterId: 'c-p1-1', playerId: 'p1', userId: USER_P1, profession: 'warrior', name: 'W1' },
  { characterId: 'c-p1-2', playerId: 'p1', userId: USER_P1, profession: 'ranger', name: 'R1' },
  { characterId: 'c-p1-3', playerId: 'p1', userId: USER_P1, profession: 'mage', name: 'M1' },
  { characterId: 'c-p2-1', playerId: 'p2', userId: USER_P2, profession: 'warrior', name: 'W2' },
  { characterId: 'c-p2-2', playerId: 'p2', userId: USER_P2, profession: 'ranger', name: 'R2' },
  { characterId: 'c-p2-3', playerId: 'p2', userId: USER_P2, profession: 'mage', name: 'M2' },
];

function makeStatus(characterId: string, userId: string, name: string, profession: string) {
  return {
    characterId,
    name,
    profession,
    health: 20,
    maxHealth: 20,
    energy: 3,
    maxEnergy: 3,
    position: { x: 0, y: 0 },
    isAlive: true,
    effects: [],
    totalShield: 0,
    isTaunted: false,
    taunting: [],
  };
}

describe('T047 battleStateBroadcaster', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // 静默 controller console.error,避免污染测试输出
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    (console.error as jest.Mock).mockRestore?.();
  });

  // ========== 1 ==========
  it('buildBoardState happy path(6 角色)→ board.characters.length === 6', async () => {
    mockGetDbSessionState.mockResolvedValue({
      currentRound: 1,
      currentStep: 1,
      currentPhase: 'playing',
      currentActorId: 'c-p1-1',
    });
    mockListCharactersInBattle.mockResolvedValue(sampleCharacters);
    mockGetCharacterStatus.mockImplementation(async (_b, cid) =>
      makeStatus(cid, 'x', 'n', 'warrior')
    );

    const { board, characters } = await buildBoardState(BATTLE_ID);

    expect(board.battleId).toBe(BATTLE_ID);
    expect(board.currentRound).toBe(1);
    expect(board.currentStep).toBe(1);
    expect(board.currentPhase).toBe('playing');
    expect(board.currentActorId).toBe('c-p1-1');
    expect(board.characters).toHaveLength(6);
    expect(characters).toHaveLength(6); // 同时返回原始 list,供 ownHand 筛选用
    expect(mockGetCharacterStatus).toHaveBeenCalledTimes(6);
    // 所有 getCharacterStatus 用同一 currentRound
    for (const call of mockGetCharacterStatus.mock.calls) {
      expect(call[2]).toBe(1);
    }
  });

  // ========== 2 ==========
  it('buildBoardState 空 board(0 角色)→ board.characters === []', async () => {
    mockGetDbSessionState.mockResolvedValue({
      currentRound: 1,
      currentStep: 0,
      currentPhase: 'pending',
      currentActorId: null,
    });
    mockListCharactersInBattle.mockResolvedValue([]);

    const { board, characters } = await buildBoardState(BATTLE_ID);

    expect(board.characters).toEqual([]);
    expect(characters).toEqual([]);
    expect(mockGetCharacterStatus).not.toHaveBeenCalled();
  });

  // ========== 3 ==========
  it('buildBoardState 战斗已消失(getDbSessionState → null)throws', async () => {
    mockGetDbSessionState.mockResolvedValue(null);

    await expect(buildBoardState(BATTLE_ID)).rejects.toThrow(/battle not found/);
  });

  // ========== 4 ==========
  it('broadcastBoardState 推 room + emit battle:state:board', async () => {
    mockGetDbSessionState.mockResolvedValue({
      currentRound: 2,
      currentStep: 3,
      currentPhase: 'playing',
      currentActorId: 'c-p1-1',
    });
    mockListCharactersInBattle.mockResolvedValue(sampleCharacters);
    mockGetCharacterStatus.mockImplementation(async (_b, cid) =>
      makeStatus(cid, 'x', 'n', 'warrior')
    );

    await broadcastBoardState(mockIo, BATTLE_ID);

    expect(mockTo).toHaveBeenCalledWith(`battle:${BATTLE_ID}`);
    expect(mockEmit).toHaveBeenCalledWith(
      'battle:state:board',
      expect.objectContaining({
        battleId: BATTLE_ID,
        currentRound: 2,
        currentStep: 3,
        characters: expect.any(Array),
      })
    );
    expect(mockEmit.mock.calls[0][1].characters).toHaveLength(6);
  });

  // ========== 5 ==========
  it('broadcastHandState 推 user-room + 单角色手牌', async () => {
    const cards = [
      {
        deck_id: 'd1',
        card_id: 'c1',
        name: 'Strike',
        type: 'attack' as const,
        cost: 1,
        effect: {},
        template_no: 1,
        source: 'deck' as const,
      },
    ];
    mockGetActorHand.mockResolvedValue(cards);

    await broadcastHandState(mockIo, BATTLE_ID, USER_P1, 'c-p1-1');

    expect(mockTo).toHaveBeenCalledWith(`user:${USER_P1}`);
    expect(mockEmit).toHaveBeenCalledWith('battle:state:hand', {
      battleId: BATTLE_ID,
      characterId: 'c-p1-1',
      hand: cards,
    });
  });

  // ========== 6 ==========
  it('broadcastFullState 组合 board + ownHand 推 user-room', async () => {
    mockGetDbSessionState.mockResolvedValue({
      currentRound: 1,
      currentStep: 1,
      currentPhase: 'playing',
      currentActorId: 'c-p1-1',
    });
    // p1 视角 —— ownHand 应是 p1 的 3 个角色
    mockListCharactersInBattle.mockResolvedValue(sampleCharacters);
    mockGetCharacterStatus.mockImplementation(async (_b, cid) =>
      makeStatus(cid, 'x', 'n', 'warrior')
    );
    const handP1_1 = [
      {
        deck_id: 'd1',
        card_id: 'c1',
        name: 'A',
        type: 'attack' as const,
        cost: 1,
        effect: {},
        template_no: 1,
        source: 'deck' as const,
      },
    ];
    mockGetActorHand.mockImplementation(async (_b, cid) => {
      if (cid === 'c-p1-1') return handP1_1;
      return [];
    });

    await broadcastFullState(mockIo, BATTLE_ID, USER_P1);

    expect(mockTo).toHaveBeenCalledWith(`user:${USER_P1}`);
    expect(mockEmit).toHaveBeenCalledWith(
      'battle:state:full',
      expect.objectContaining({
        battleId: BATTLE_ID,
        board: expect.objectContaining({
          characters: expect.any(Array),
        }),
        ownHand: expect.any(Object),
      })
    );
    const payload = mockEmit.mock.calls[0][1];
    expect(payload.board.characters).toHaveLength(6);
    // ownHand 应只有 p1 的 3 个 characterId
    expect(Object.keys(payload.ownHand).sort()).toEqual(['c-p1-1', 'c-p1-2', 'c-p1-3']);
    expect(payload.ownHand['c-p1-1']).toEqual(handP1_1);
    expect(payload.ownHand['c-p1-2']).toEqual([]);
    expect(payload.ownHand['c-p1-3']).toEqual([]);
  });

  // ========== 7 ==========
  it('broadcastCharacterStatus 单角色推 room + emit battle:state:character', async () => {
    mockGetDbSessionState.mockResolvedValue({
      currentRound: 1,
      currentStep: 1,
      currentPhase: 'playing',
      currentActorId: 'c-p1-1',
    });
    const status = makeStatus('c-p1-1', 'x', 'W1', 'warrior');
    mockGetCharacterStatus.mockResolvedValue(status);

    await broadcastCharacterStatus(mockIo, BATTLE_ID, 'c-p1-1');

    expect(mockTo).toHaveBeenCalledWith(`battle:${BATTLE_ID}`);
    expect(mockEmit).toHaveBeenCalledWith('battle:state:character', {
      battleId: BATTLE_ID,
      character: status,
    });
  });
});
