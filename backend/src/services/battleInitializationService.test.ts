// T048 单测：TDZ 顺序，jest.mock 必须在所有 import 之前
const mockInitializeBoard = jest.fn();
const mockPlaceCharacter = jest.fn();
const mockSetEnergy = jest.fn();

const mockDrawCards = jest.fn();

const mockInitSession = jest.fn();
const mockGetOrder = jest.fn();

// T-FIX(战棋死锁): init 步骤 6.5 激活首 actor 的 helper
const mockActivateActor = jest.fn();

const mockQuery = jest.fn();
const mockQueryOne = jest.fn();
const mockExecute = jest.fn();

const mockRedisClient = {
  set: jest.fn(),
  del: jest.fn(),
  hGet: jest.fn(),
  hSet: jest.fn(),
};
const mockRedisDel = mockRedisClient.del;
const mockBroadcastDeploymentState = jest.fn();

jest.mock('./battleService', () => ({
  initializeBoard: mockInitializeBoard,
  placeCharacter: mockPlaceCharacter,
  setCharacterEnergy: mockSetEnergy,
}));
jest.mock('./handService', () => ({
  drawCards: mockDrawCards,
}));
jest.mock('./battleActionService', () => ({
  activateActorForStep: mockActivateActor,
}));
const mockCreateDeployment = jest.fn();
const mockFinalizeDeployment = jest.fn();
const mockPersistDeckSnapshots = jest.fn();
const mockCleanupDeployment = jest.fn();

jest.mock('./deploymentService', () => ({
  createDeployment: mockCreateDeployment,
  finalizeDeployment: mockFinalizeDeployment,
  persistDeckSnapshots: mockPersistDeckSnapshots,
  cleanupDeployment: mockCleanupDeployment,
}));
jest.mock('./battleSessionService', () => ({
  initializeSession: mockInitSession,
  getActivationOrder: mockGetOrder,
  buildSnakeOrder: (...args: any[]) => mockGetOrder(...args),
}));
jest.mock('../config/database', () => ({
  query: mockQuery,
  queryOne: mockQueryOne,
  execute: mockExecute,
}));
jest.mock('../config/redis', () => ({
  redisClient: mockRedisClient,
}));
jest.mock('../socket/battleStateBroadcaster', () => ({
  broadcastFullState: jest.fn(),
  broadcastBoardState: jest.fn(),
  broadcastHandState: jest.fn(),
  broadcastCharacterStatus: jest.fn(),
  broadcastDeploymentState: mockBroadcastDeploymentState,
}));

import { initBattleField, cleanupPartialInit, initDeployment, startBattle } from './battleInitializationService';
import type { FinalizedDeployment } from './deploymentService';

const mockBroadcastFullState = require('../socket/battleStateBroadcaster').broadcastFullState as jest.MockedFunction<any>;

const mockBroadcast = jest.fn();

// T1012: beforeEach 预排的 mockResolvedValueOnce 队列会让 ids 路径拿到旧值, 重置后自排
function resetDbMocks(): void {
  mockQuery.mockReset();
  mockQueryOne.mockReset();
  mockExecute.mockReset();
  mockExecute.mockResolvedValue(1);
}
const FAKE_IO: any = { to: jest.fn().mockReturnThis(), emit: mockBroadcast };

const P1_CHARS = [
  { id: 'c1', player_id: 'p1', user_id: 'u1', name: 'W1', profession: 'warrior', health: 20, max_health: 20, movement: 2, energy: 0, max_energy: 3, is_alive: true },
  { id: 'c2', player_id: 'p1', user_id: 'u1', name: 'R1', profession: 'ranger',  health: 15, max_health: 15, movement: 3, energy: 0, max_energy: 3, is_alive: true },
  { id: 'c3', player_id: 'p1', user_id: 'u1', name: 'M1', profession: 'mage',    health: 12, max_health: 12, movement: 2, energy: 0, max_energy: 3, is_alive: true },
];
const P2_CHARS = [
  { id: 'c4', player_id: 'p2', user_id: 'u2', name: 'W2', profession: 'warrior', health: 20, max_health: 20, movement: 2, energy: 0, max_energy: 3, is_alive: true },
  { id: 'c5', player_id: 'p2', user_id: 'u2', name: 'R2', profession: 'ranger',  health: 15, max_health: 15, movement: 3, energy: 0, max_energy: 3, is_alive: true },
  { id: 'c6', player_id: 'p2', user_id: 'u2', name: 'M2', profession: 'mage',    health: 12, max_health: 12, movement: 2, energy: 0, max_energy: 3, is_alive: true },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockInitializeBoard.mockResolvedValue({} as any);
  mockPlaceCharacter.mockResolvedValue({} as any);
  mockSetEnergy.mockResolvedValue(undefined);
  mockDrawCards.mockResolvedValue({} as any);
  mockInitSession.mockResolvedValue(undefined);
  mockGetOrder.mockReturnValue(['c1', 'c4', 'c2', 'c5', 'c3', 'c6']);
  mockActivateActor.mockResolvedValue(undefined);
  // mockQueryOne for loadBattleCharacters: battles row + p1 chars + p2 chars
  mockQueryOne.mockResolvedValueOnce({ player1_id: 'p1', player2_id: 'p2' });
  mockQuery.mockResolvedValueOnce(P1_CHARS);  // p1 chars query
  mockQuery.mockResolvedValueOnce(P2_CHARS);  // p2 chars query
  mockQuery.mockResolvedValueOnce({ rowCount: 1 });  // UPDATE characters.battle_id
  // T-FIX: step 6 UPDATE battles 改走 execute()（返回受影响行数）
  mockExecute.mockResolvedValue(1);
});

describe('initBattleField happy path', () => {
  it('should execute all 7 steps and return success', async () => {
    const result = await initBattleField(FAKE_IO, 'b1');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.actorId).toBe('c1');
      expect(result.startedAt).toBeInstanceOf(Date);
    }

    // 步骤 1: initializeBoard
    expect(mockInitializeBoard).toHaveBeenCalledWith('b1');
    // 步骤 2: placeCharacter × 6
    expect(mockPlaceCharacter).toHaveBeenCalledTimes(6);
    expect(mockPlaceCharacter).toHaveBeenNthCalledWith(1, 'b1', 'c1', 6, 0);
    expect(mockPlaceCharacter).toHaveBeenNthCalledWith(2, 'b1', 'c4', 0, 8);
    expect(mockPlaceCharacter).toHaveBeenNthCalledWith(6, 'b1', 'c6', 2, 8);
    // 步骤 3: setCharacterEnergy × 6
    expect(mockSetEnergy).toHaveBeenCalledTimes(6);
    expect(mockSetEnergy).toHaveBeenCalledWith('b1', 'c1', 3);
    // 步骤 4: drawCards × 6
    expect(mockDrawCards).toHaveBeenCalledTimes(6);
    expect(mockDrawCards).toHaveBeenCalledWith('b1', 'c1', 3);
    // 步骤 5: initializeSession
    expect(mockInitSession).toHaveBeenCalledWith(
      'b1',
      ['c1', 'c2', 'c3'],
      ['c4', 'c5', 'c6']
    );
    // 步骤 6: UPDATE battles -- T-FIX: 走 execute()（返回受影响行数）
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining(`UPDATE battles`),
      expect.arrayContaining(['c1', 'b1'])
    );
    // 步骤 6.5: T-FIX(战棋死锁) 激活首 actor（不抽牌 - 初始手牌步骤 4 已发）
    expect(mockActivateActor).toHaveBeenCalledTimes(1);
    expect(mockActivateActor).toHaveBeenCalledWith(FAKE_IO, 'b1');
    // 激活必须发生在全量广播之前（首屏即 phase=move，不能先推 idle 再推 move）
    expect(mockActivateActor.mock.invocationCallOrder[0]).toBeLessThan(mockBroadcastFullState.mock.invocationCallOrder[0]);
    // 步骤 7: broadcastFullState × 2
    expect(mockBroadcastFullState).toHaveBeenCalledTimes(2);
    expect(mockBroadcastFullState).toHaveBeenNthCalledWith(1, FAKE_IO, 'b1', 'u1');
    expect(mockBroadcastFullState).toHaveBeenNthCalledWith(2, FAKE_IO, 'b1', 'u2');
  });
});

describe('initBattleField insufficient characters', () => {
  it('should return failedStep=2 when p1 has only 2 characters', async () => {
    jest.clearAllMocks();
    mockInitializeBoard.mockResolvedValue({} as any);
    mockQueryOne.mockReset();
    mockQuery.mockReset();
    mockQueryOne.mockResolvedValueOnce({ player1_id: 'p1', player2_id: 'p2' });
    mockQuery.mockResolvedValueOnce(P1_CHARS.slice(0, 2));  // p1 only has 2
    mockQuery.mockResolvedValueOnce(P2_CHARS);

    const result = await initBattleField(FAKE_IO, 'b1');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.failedStep).toBe(2);
      expect(result.error).toMatch(/Insufficient characters.*p1=2/);
    }
    // Should NOT continue to subsequent steps
    expect(mockSetEnergy).not.toHaveBeenCalled();
    expect(mockDrawCards).not.toHaveBeenCalled();
  });

  it('should return failedStep=2 when p2 has 0 characters', async () => {
    jest.clearAllMocks();
    mockInitializeBoard.mockResolvedValue({} as any);
    mockQueryOne.mockReset();
    mockQuery.mockReset();
    mockQueryOne.mockResolvedValueOnce({ player1_id: 'p1', player2_id: 'p2' });
    mockQuery.mockResolvedValueOnce(P1_CHARS);
    mockQuery.mockResolvedValueOnce([]);  // p2 has 0

    const result = await initBattleField(FAKE_IO, 'b1');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.failedStep).toBe(2);
      expect(result.error).toMatch(/p2=0/);
    }
  });
});

describe('cleanupPartialInit ladder cleanup', () => {
  it('should DEL only positions when lastStep=1', async () => {
    mockRedisDel.mockClear();
    await cleanupPartialInit('b1', 1);
    expect(mockRedisDel).toHaveBeenCalledTimes(1);
    expect(mockRedisDel).toHaveBeenCalledWith('battle:b1:positions');
    // 不应回滚 battles（lastStep < 6）
    expect(mockQuery).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE battles SET status'), expect.anything());
  });

  it('should DEL positions + pieces when lastStep=2', async () => {
    mockRedisDel.mockClear();
    await cleanupPartialInit('b1', 2);
    expect(mockRedisDel).toHaveBeenCalledWith('battle:b1:pieces');
    expect(mockRedisDel).toHaveBeenCalledWith('battle:b1:positions');
  });

  it('should DEL hand/retained/discard keys for all 6 chars when lastStep=4', async () => {
    jest.clearAllMocks();
    mockQueryOne.mockReset();
    mockQuery.mockReset();
    // cleanupPartialInit 内部会调 loadBattleCharacters → 需要 mock
    mockQueryOne.mockResolvedValueOnce({ player1_id: 'p1', player2_id: 'p2' });
    mockQuery.mockResolvedValueOnce(P1_CHARS);
    mockQuery.mockResolvedValueOnce(P2_CHARS);
    mockQuery.mockResolvedValueOnce({ rowCount: 6 });  // UPDATE characters.battle_id

    mockRedisDel.mockClear();
    await cleanupPartialInit('b1', 4);
    // 6 chars × 3 keys (hand/retained/discard) = 18 个 DEL
    expect(mockRedisDel.mock.calls.length).toBeGreaterThanOrEqual(18);
  });

  it('should DEL session key when lastStep=5', async () => {
    mockRedisDel.mockClear();
    await cleanupPartialInit('b1', 5);
    expect(mockRedisDel).toHaveBeenCalledWith('battle:b1:session');
  });

  it('should UPDATE battles rollback when lastStep=6', async () => {
    jest.clearAllMocks();
    mockQueryOne.mockReset();
    mockQuery.mockReset();
    mockQueryOne.mockResolvedValueOnce({ player1_id: 'p1', player2_id: 'p2' });
    mockQuery.mockResolvedValueOnce(P1_CHARS);
    mockQuery.mockResolvedValueOnce(P2_CHARS);
    mockQuery.mockResolvedValueOnce({ rowCount: 6 });

    await cleanupPartialInit('b1', 6);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining(`UPDATE battles SET status='pending'`),
      ['b1']
    );
  });

  it('should swallow cleanup errors (loadBattleCharacters fails → no throw)', async () => {
    jest.clearAllMocks();
    mockQueryOne.mockReset();
    mockQueryOne.mockRejectedValue(new Error('PG down'));
    // 不应 throw
    await expect(cleanupPartialInit('b1', 4)).resolves.toBeUndefined();
  });
});

describe('initBattleField failure paths', () => {
  it('should return failedStep=1 when initializeBoard throws', async () => {
    jest.clearAllMocks();
    mockInitializeBoard.mockReset();
    mockInitializeBoard.mockRejectedValue(new Error('Redis ECONNRESET'));
    // mock cleanup 调用
    mockQueryOne.mockReset();
    mockQuery.mockReset();
    mockRedisDel.mockReset();
    mockRedisDel.mockResolvedValue(1);

    const result = await initBattleField(FAKE_IO, 'b1');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.failedStep).toBe(1);
      expect(result.error).toMatch(/Redis ECONNRESET/);
    }
  });

  it('should return failedStep=6 and rollback UPDATE when step 6 UPDATE returns 0 rows', async () => {
    jest.clearAllMocks();
    mockInitializeBoard.mockResolvedValue({} as any);
    mockPlaceCharacter.mockResolvedValue({} as any);
    mockSetEnergy.mockResolvedValue(undefined);
    mockDrawCards.mockResolvedValue({} as any);
    mockInitSession.mockResolvedValue(undefined);
    mockGetOrder.mockReturnValue(['c1', 'c4', 'c2', 'c5', 'c3', 'c6']);
    mockQueryOne.mockReset();
    mockQuery.mockReset();
    mockExecute.mockReset();
    // loadBattleCharacters 3 queries
    mockQueryOne.mockResolvedValueOnce({ player1_id: 'p1', player2_id: 'p2' });
    mockQuery.mockResolvedValueOnce(P1_CHARS);
    mockQuery.mockResolvedValueOnce(P2_CHARS);
    mockQuery.mockResolvedValueOnce({ rowCount: 6 });  // UPDATE characters.battle_id
    // step 6 UPDATE battles returns 0 rows (race condition) -- T-FIX: 走 execute()
    mockExecute.mockResolvedValueOnce(0);
    // cleanup 调用的 query
    mockQueryOne.mockReset();
    mockQueryOne.mockResolvedValueOnce({ player1_id: 'p1', player2_id: 'p2' });
    mockQuery.mockResolvedValueOnce(P1_CHARS);
    mockQuery.mockResolvedValueOnce(P2_CHARS);
    mockQuery.mockResolvedValueOnce({ rowCount: 6 });

    const result = await initBattleField(FAKE_IO, 'b1');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.failedStep).toBe(6);
      expect(result.error).toMatch(/battle_row_not_updated/);
    }
    // battles 行未更新时不应激活首 actor
    expect(mockActivateActor).not.toHaveBeenCalled();
  });
});


// ========================================
// T1012: 布置阶段两段式
// ========================================

const DEPLOYED: FinalizedDeployment = {
  p1: {
    // 选择顺序与 created_at 顺序不同: c2 -> c1 -> c3 (验证按配置顺序出场)
    pieces: [
      { characterId: 'c2', x: 4, y: 0, deckCardIds: ['k2'] },
      { characterId: 'c1', x: 7, y: 0, deckCardIds: [] },
      { characterId: 'c3', x: 1, y: 0, deckCardIds: ['k3'] },
    ],
  },
  p2: {
    pieces: [
      { characterId: 'c4', x: 8, y: 8, deckCardIds: [] },
      { characterId: 'c5', x: 6, y: 8, deckCardIds: [] },
      { characterId: 'c6', x: 7, y: 8, deckCardIds: [] },
    ],
  },
};

describe('T1012 initBattleField with deployedPieces', () => {
  it('棋子按配置顺序出场 + 配置位置放置', async () => {
    resetDbMocks();
    mockQueryOne.mockResolvedValueOnce({ player1_id: 'p1', player2_id: 'p2' });
    // loadSideCharacters(ids): 双方各一次 query, 返回乱序行(代码需按配置排序)
    mockQuery.mockResolvedValueOnce([P1_CHARS[0], P1_CHARS[2], P1_CHARS[1]]); // c1,c3,c2 乱序
    mockQuery.mockResolvedValueOnce([P2_CHARS[2], P2_CHARS[0], P2_CHARS[1]]);
    mockQuery.mockResolvedValueOnce({ rowCount: 6 });
    // 蛇形顺序按配置顺序: c2,c4,c1,c5,c3,c6
    mockGetOrder.mockReturnValue(['c2', 'c4', 'c1', 'c5', 'c3', 'c6']);

    const result = await initBattleField(FAKE_IO, 'b1', DEPLOYED);

    expect(result.success).toBe(true);
    // 位置 = 配置位置(按配置顺序)
    expect(mockPlaceCharacter).toHaveBeenNthCalledWith(1, 'b1', 'c2', 4, 0);
    expect(mockPlaceCharacter).toHaveBeenNthCalledWith(2, 'b1', 'c4', 8, 8);
    expect(mockPlaceCharacter).toHaveBeenNthCalledWith(3, 'b1', 'c1', 7, 0);
    expect(mockPlaceCharacter).toHaveBeenNthCalledWith(4, 'b1', 'c5', 6, 8);
    expect(mockPlaceCharacter).toHaveBeenNthCalledWith(5, 'b1', 'c3', 1, 0);
    expect(mockPlaceCharacter).toHaveBeenNthCalledWith(6, 'b1', 'c6', 7, 8);
    // 蛇形顺序按配置顺序: c2,c4,c1,c5,c3,c6
    expect(mockInitSession).toHaveBeenCalledWith('b1', ['c2', 'c1', 'c3'], ['c4', 'c5', 'c6']);
    expect(result.success && result.actorId).toBe('c2');
  });

  it('配置棋子数不足 3 -> failedStep=2', async () => {
    resetDbMocks();
    mockQueryOne.mockResolvedValueOnce({ player1_id: 'p1', player2_id: 'p2' });
    mockQuery.mockResolvedValueOnce(P1_CHARS.slice(0, 1)); // 只查到 1 个 alive
    mockQuery.mockResolvedValueOnce(P2_CHARS);
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });

    const result = await initBattleField(FAKE_IO, 'b1', DEPLOYED);
    expect(result).toEqual({
      success: false,
      failedStep: 2,
      error: 'Insufficient characters: p1=1, p2=3',
    });
  });
});

describe('T1012 initDeployment', () => {
  it('创建部署状态 + 广播 deploy_state', async () => {
    mockCreateDeployment.mockResolvedValueOnce({ success: true, state: {} });

    const r = await initDeployment(FAKE_IO, 'b1');

    expect(r.success).toBe(true);
    expect(mockInitializeBoard).toHaveBeenCalledWith('b1');
    expect(mockCreateDeployment).toHaveBeenCalledWith('b1');
    expect(mockBroadcastDeploymentState).toHaveBeenCalledWith(FAKE_IO, 'b1');
  });

  it('createDeployment 失败 -> 透传 error', async () => {
    mockCreateDeployment.mockResolvedValueOnce({ success: false, error: 'battle_not_pending' });

    const r = await initDeployment(FAKE_IO, 'b1');

    expect(r).toEqual({ success: false, error: 'battle_not_pending' });
    expect(mockBroadcastDeploymentState).not.toHaveBeenCalled();
  });
});

describe('T1012 startBattle', () => {
  it('finalize -> 快照 -> initBattleField(带配置) -> cleanup', async () => {
    resetDbMocks();
    mockGetOrder.mockReturnValue(['c2', 'c4', 'c1', 'c5', 'c3', 'c6']);
    mockFinalizeDeployment.mockResolvedValueOnce({ success: true, finalized: DEPLOYED });
    mockPersistDeckSnapshots.mockResolvedValueOnce(undefined);
    mockCleanupDeployment.mockResolvedValueOnce(undefined);
    mockQueryOne.mockResolvedValueOnce({ player1_id: 'p1', player2_id: 'p2' });
    mockQuery.mockResolvedValueOnce([P1_CHARS[0], P1_CHARS[2], P1_CHARS[1]]);
    mockQuery.mockResolvedValueOnce([P2_CHARS[2], P2_CHARS[0], P2_CHARS[1]]);
    mockQuery.mockResolvedValueOnce({ rowCount: 6 });
    mockExecute.mockResolvedValue(1);

    const result = await startBattle(FAKE_IO, 'b1');

    expect(result.success).toBe(true);
    expect(mockFinalizeDeployment).toHaveBeenCalledWith('b1');
    // 快照必须先于抽牌写入
    expect(mockPersistDeckSnapshots.mock.invocationCallOrder[0]).toBeLessThan(
      mockDrawCards.mock.invocationCallOrder[0]
    );
    expect(mockPersistDeckSnapshots).toHaveBeenCalledWith('b1', DEPLOYED);
    expect(mockPlaceCharacter).toHaveBeenNthCalledWith(1, 'b1', 'c2', 4, 0);
    expect(mockCleanupDeployment).toHaveBeenCalledWith('b1');
  });

  it('finalize 失败 -> failedStep=0, 不进入初始化', async () => {
    mockFinalizeDeployment.mockResolvedValueOnce({ success: false, error: 'deployment_not_found' });

    const result = await startBattle(FAKE_IO, 'b1');

    expect(result).toEqual({ success: false, failedStep: 0, error: 'finalize: deployment_not_found' });
    expect(mockInitializeBoard).not.toHaveBeenCalled();
    expect(mockCleanupDeployment).not.toHaveBeenCalled();
  });
});
