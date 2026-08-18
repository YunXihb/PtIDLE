// 对战互动服务单测：退出对战（认输）/ 请求平局 / 回应平局
// TDZ 顺序：jest.mock 与 mock 变量声明必须在所有 import 之前
const mockQueryOne = jest.fn();
const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn();
const mockRedisDel = jest.fn();
const mockRecordVictory = jest.fn();

jest.mock('../config/database', () => ({
  queryOne: mockQueryOne,
  query: jest.fn(),
  execute: jest.fn(),
  withTransaction: jest.fn(),
}));
jest.mock('../config/redis', () => ({
  redisClient: { get: mockRedisGet, set: mockRedisSet, del: mockRedisDel },
}));
jest.mock('./battleOutcomeService', () => ({
  recordVictory: mockRecordVictory,
}));

import { surrenderBattle, requestDraw, respondDraw } from './battleInteractionService';
import { ApiError } from '../utils/ApiError';
import type { Server as IOServer } from 'socket.io';

const mockEmit = jest.fn();
// 注意：不能在顶层用 mockReturnThis()，beforeEach 的 resetAllMocks 会清掉实现
let FAKE_IO: IOServer;

const BATTLE_ID = 'b1';
const P1_USER = 'u1';
const P2_USER = 'u2';

function mockBattleRow(status: string): void {
  mockQueryOne.mockResolvedValueOnce({
    id: BATTLE_ID,
    status,
    player1_id: 'pl1',
    player2_id: 'pl2',
    p1_user_id: P1_USER,
    p2_user_id: P2_USER,
  });
}

beforeEach(() => {
  jest.resetAllMocks();
  FAKE_IO = { to: jest.fn().mockReturnThis(), emit: mockEmit } as unknown as IOServer;
  // 默认星数 0:0
  mockRedisGet.mockResolvedValue(null);
});

describe('surrenderBattle', () => {
  it('ongoing 对局 p1 退出 -> 对方(p2)胜利, victory source=surrender', async () => {
    mockBattleRow('ongoing');
    await surrenderBattle(FAKE_IO, BATTLE_ID, P1_USER);
    expect(mockRecordVictory).toHaveBeenCalledTimes(1);
    expect(mockRecordVictory).toHaveBeenCalledWith(
      FAKE_IO,
      BATTLE_ID,
      { status: 'win', winnerSide: 'p2', p1Stars: 0, p2Stars: 0 },
      'surrender'
    );
  });

  it('pending 对局也可退出（未开局卡死对局的逃生门）', async () => {
    mockBattleRow('pending');
    await surrenderBattle(FAKE_IO, BATTLE_ID, P2_USER);
    expect(mockRecordVictory).toHaveBeenCalledWith(
      FAKE_IO,
      BATTLE_ID,
      { status: 'win', winnerSide: 'p1', p1Stars: 0, p2Stars: 0 },
      'surrender'
    );
  });

  it('读取星数传给 recordVictory（无 key 按 0）', async () => {
    mockBattleRow('ongoing');
    mockRedisGet.mockImplementation(async (key: string) =>
      key.endsWith(':stars:p1') ? '2' : '5'
    );
    await surrenderBattle(FAKE_IO, BATTLE_ID, P1_USER);
    expect(mockRecordVictory).toHaveBeenCalledWith(
      FAKE_IO,
      BATTLE_ID,
      { status: 'win', winnerSide: 'p2', p1Stars: 2, p2Stars: 5 },
      'surrender'
    );
  });

  it('finished 对局 -> ApiError 409', async () => {
    mockBattleRow('finished');
    const err = await surrenderBattle(FAKE_IO, BATTLE_ID, P1_USER).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect(mockRecordVictory).not.toHaveBeenCalled();
  });

  it('非参与者 -> ApiError 403, 不结算', async () => {
    mockBattleRow('ongoing');
    await expect(surrenderBattle(FAKE_IO, BATTLE_ID, 'stranger')).rejects.toBeInstanceOf(ApiError);
    expect(mockRecordVictory).not.toHaveBeenCalled();
  });

  it('对局不存在 -> ApiError 404', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    await expect(surrenderBattle(FAKE_IO, BATTLE_ID, P1_USER)).rejects.toBeInstanceOf(ApiError);
  });
});

describe('requestDraw', () => {
  it('ongoing 对局 -> 登记 Redis + 向房间广播 draw_requested(带 fromUserId)', async () => {
    mockBattleRow('ongoing');
    await requestDraw(FAKE_IO, BATTLE_ID, P1_USER);
    expect(mockRedisSet).toHaveBeenCalledWith(`battle:${BATTLE_ID}:draw_request`, P1_USER);
    expect(mockEmit).toHaveBeenCalledWith('battle:draw_requested', {
      battleId: BATTLE_ID,
      fromUserId: P1_USER,
    });
  });

  it('pending 对局求和 -> ApiError 409（未开局无和局概念）', async () => {
    mockBattleRow('pending');
    await expect(requestDraw(FAKE_IO, BATTLE_ID, P1_USER)).rejects.toBeInstanceOf(ApiError);
    expect(mockRedisSet).not.toHaveBeenCalled();
  });
});

describe('respondDraw', () => {
  it('接受 -> DEL 请求 key + recordVictory 平局结算(victory source=draw)', async () => {
    mockBattleRow('ongoing');
    mockRedisGet.mockResolvedValueOnce(P1_USER); // draw_request = p1 发起
    await respondDraw(FAKE_IO, BATTLE_ID, P2_USER, true);
    expect(mockRedisDel).toHaveBeenCalledWith(`battle:${BATTLE_ID}:draw_request`);
    expect(mockRecordVictory).toHaveBeenCalledWith(
      FAKE_IO,
      BATTLE_ID,
      { status: 'draw', p1Stars: 0, p2Stars: 0 },
      'draw'
    );
  });

  it('拒绝 -> DEL 请求 key + 仅向请求方单播 draw_declined, 不结算', async () => {
    mockBattleRow('ongoing');
    mockRedisGet.mockResolvedValueOnce(P1_USER);
    await respondDraw(FAKE_IO, BATTLE_ID, P2_USER, false);
    expect(mockRedisDel).toHaveBeenCalledWith(`battle:${BATTLE_ID}:draw_request`);
    expect(mockRecordVictory).not.toHaveBeenCalled();
    expect(mockEmit).toHaveBeenCalledWith('battle:draw_declined', { battleId: BATTLE_ID });
  });

  it('请求方回应自己的请求 -> ApiError 403', async () => {
    mockBattleRow('ongoing');
    mockRedisGet.mockResolvedValueOnce(P1_USER);
    await expect(respondDraw(FAKE_IO, BATTLE_ID, P1_USER, true)).rejects.toBeInstanceOf(ApiError);
    expect(mockRecordVictory).not.toHaveBeenCalled();
  });

  it('无未决请求 -> ApiError 409', async () => {
    mockBattleRow('ongoing');
    mockRedisGet.mockResolvedValueOnce(null);
    await expect(respondDraw(FAKE_IO, BATTLE_ID, P2_USER, true)).rejects.toBeInstanceOf(ApiError);
  });
});
