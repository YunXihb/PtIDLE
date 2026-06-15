// jest.mock 必须在 import 之前(ts-jest TDZ 坑)
jest.mock('../services/battleService', () => ({
  getPendingBattleForJoin: jest.fn(),
  listCharactersInBattle: jest.fn(),
}));

jest.mock('../services/battleSessionService', () => ({
  getDbSessionState: jest.fn(),
}));

jest.mock('../services/characterStatusService', () => ({
  getCharacterStatus: jest.fn(),
}));

jest.mock('../services/handService', () => ({
  getActorHand: jest.fn(),
}));

jest.mock('../config/database', () => ({
  query: jest.fn(),
  queryOne: jest.fn().mockResolvedValue({ status: 'pending' }),
  execute: jest.fn(),
}));

jest.mock('../services/battleInitializationService', () => ({
  initBattleField: jest.fn().mockResolvedValue({ success: true, startedAt: new Date(), actorId: 'c1' }),
  cleanupPartialInit: jest.fn(),
}));

import http from 'http';
import express from 'express';
import {
  Server as IOServer,
  Socket,
  DefaultEventsMap,
} from 'socket.io';
import { io as Client, Socket as ClientSocket } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import { initializeSocketServer } from './socketServer';
import { JWT_SECRET } from '../config/jwt';
import * as battleService from '../services/battleService';
import * as battleSessionService from '../services/battleSessionService';
import * as characterStatusService from '../services/characterStatusService';
import * as handService from '../services/handService';

const mockGetPendingBattleForJoin =
  battleService.getPendingBattleForJoin as jest.MockedFunction<
    typeof battleService.getPendingBattleForJoin
  >;

const mockListCharactersInBattle =
  battleService.listCharactersInBattle as jest.MockedFunction<
    typeof battleService.listCharactersInBattle
  >;

const mockGetDbSessionState =
  battleSessionService.getDbSessionState as jest.MockedFunction<
    typeof battleSessionService.getDbSessionState
  >;

const mockGetCharacterStatus =
  characterStatusService.getCharacterStatus as jest.MockedFunction<
    typeof characterStatusService.getCharacterStatus
  >;

const mockGetActorHand = handService.getActorHand as jest.MockedFunction<
  typeof handService.getActorHand
>;

/**
 * T045 + T046 集成测试 —— 真实 socket.io-client 连真实 socket.io server
 *
 * T045 范围（3 用例）:
 *   1. 客户端带有效 JWT 连接 → connect + socket.connected=true + 服务端 socket.data.userId 可读
 *   2. 客户端无 token 连接 → connect_error + error.message='No token provided'
 *   3. 客户端断开 → 服务端 disconnect handler 被调用 + fetchSockets 归零
 *
 * T046 范围（新增 7 用例）:
 *   4. 连接后自动加入 user:{userId} room
 *   5. battle:join 成功 → 加入 battle room + 收到 join:ok
 *   6. battle:join 失败(非参与者)→ 收到 join:error
 *   7. battle:join 后对手应收到 battle:opponent_joined
 *   8. 房间内一方断开 → 对手收到 battle:opponent_disconnected
 *   9. 断开时 socket.data.battleId 未设置 → 不推送 opponent_disconnected
 *  10. battle:join 缺 battleId → 收到 join:error
 *
 * 端口隔离:listen(0) 随机端口
 */

/** T045 + T046 写入 socket.data 的字段集 */
interface SocketData {
  userId: string;
  username: string;
  battleId?: string;
}

type AuthedSocket = Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;

describe('T045 + T046 socketServer', () => {
  let httpServer: http.Server;
  let io: IOServer<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;
  let port: number;
  let activeClients: ClientSocket[] = [];

  beforeAll((done) => {
    const app = express();
    httpServer = http.createServer(app);
    io = new IOServer<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>(httpServer);
    initializeSocketServer(io);
    httpServer.listen(0, () => {
      port = (httpServer.address() as { port: number }).port;
      done();
    });
  });

  afterAll(async () => {
    await io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  // 防御性 cleanup
  afterEach(() => {
    for (const c of activeClients) c.close();
    activeClients = [];
    mockGetPendingBattleForJoin.mockReset();
    mockListCharactersInBattle.mockReset();
    mockGetDbSessionState.mockReset();
    mockGetCharacterStatus.mockReset();
    mockGetActorHand.mockReset();
  });

  // 工具
  const generateToken = (userId: string, username: string): string => {
    return jwt.sign({ userId, username }, JWT_SECRET);
  };

  const connectClient = (token?: string): ClientSocket => {
    const client = Client(`http://localhost:${port}`, {
      auth: token ? { token } : {},
      transports: ['websocket'],
    });
    activeClients.push(client);
    return client;
  };

  const waitForConnect = (client: ClientSocket): Promise<void> => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('connect timeout')), 3000);
      client.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      client.once('connect_error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  };

  const waitForConnectError = (client: ClientSocket): Promise<Error> => {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(new Error('connect_error timeout')), 3000);
      client.once('connect_error', (err) => {
        clearTimeout(timer);
        resolve(err);
      });
    });
  };

  const waitForNoSockets = async (maxMs = 1000): Promise<void> => {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      const sockets = await io.fetchSockets();
      if (sockets.length === 0) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('timeout waiting for sockets to drain');
  };

  const waitForEvent = <T = unknown>(
    client: ClientSocket,
    event: string,
    maxMs = 1000
  ): Promise<T> => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`event ${event} timeout`)), maxMs);
      client.once(event, (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
  };

  // ============== T045 tests ==============

  it('T045: 客户端带有效 JWT 应能成功连接,且服务端可读 userId/username', async () => {
    const userId = 'user-1';
    const username = 'alice';
    const client = connectClient(generateToken(userId, username));

    await waitForConnect(client);
    expect(client.connected).toBe(true);

    const sockets = await io.fetchSockets();
    expect(sockets.length).toBe(1);
    const serverSocket = sockets[0] as unknown as AuthedSocket;
    expect(serverSocket.data.userId).toBe(userId);
    expect(serverSocket.data.username).toBe(username);
  });

  it('T045: 客户端无 token 应触发 connect_error 且 message=No token provided', async () => {
    const client = connectClient();
    const err = await waitForConnectError(client);
    expect(err.message).toBe('No token provided');
    expect(client.connected).toBe(false);
  });

  it('T045: 客户端连接后断开,服务端 disconnect handler 应被调用', async () => {
    const client = connectClient(generateToken('user-2', 'bob'));
    await waitForConnect(client);
    expect(client.connected).toBe(true);

    const beforeSockets = await io.fetchSockets();
    expect(beforeSockets.length).toBe(1);

    client.close();
    activeClients = []; // 已主动关闭,afterEach 不再重复 close

    await waitForNoSockets();
  });

  // ============== T046 tests ==============

  it('T046: 连接成功后 socket 应自动加入 user:{userId} room', async () => {
    const userId = 'user-room-1';
    const client = connectClient(generateToken(userId, 'alice'));

    await waitForConnect(client);

    // 等服务端 join 异步完成
    await new Promise((r) => setTimeout(r, 50));

    const socketsInUserRoom = await io.in(`user:${userId}`).fetchSockets();
    expect(socketsInUserRoom.length).toBe(1);
  });

  it('T046: battle:join 验证通过后,客户端应加入 battle room 并收到 join:ok', async () => {
    const userId = 'joiner-1';
    const battleId = 'battle-abc-123';
    const client = connectClient(generateToken(userId, 'joiner'));

    await waitForConnect(client);

    // mock DB 鉴权通过
    mockGetPendingBattleForJoin.mockResolvedValueOnce({
      id: battleId,
      player1_id: 'p1',
      player2_id: 'p2',
      status: 'pending',
      matched_at: new Date(),
      started_at: null,
    });

    // 监听 join:ok 与 race with join
    const okPromise = waitForEvent<{ battleId: string; opponentInRoom: boolean }>(
      client,
      'battle:join:ok'
    );
    client.emit('battle:join', { battleId });
    const okPayload = await okPromise;

    expect(okPayload.battleId).toBe(battleId);
    expect(okPayload.opponentInRoom).toBe(false); // 房间内无其他 socket

    // 验证 socket 加入了 battle room
    const socketsInBattle = await io.in(`battle:${battleId}`).fetchSockets();
    expect(socketsInBattle.length).toBe(1);
  });

  it('T046: battle:join 验证失败(非参与者)应收到 join:error', async () => {
    const client = connectClient(generateToken('joiner-2', 'mallory'));
    await waitForConnect(client);

    // mock DB 鉴权失败(返回 null)
    mockGetPendingBattleForJoin.mockResolvedValueOnce(null);

    const errPromise = waitForEvent<{ battleId: string; error: string }>(
      client,
      'battle:join:error'
    );
    client.emit('battle:join', { battleId: 'some-battle' });
    const errPayload = await errPromise;

    expect(errPayload.error).toBe('Not a participant of this battle');
    expect(errPayload.battleId).toBe('some-battle');

    // 验证 socket 没有加入 battle room
    const socketsInBattle = await io.in('battle:some-battle').fetchSockets();
    expect(socketsInBattle.length).toBe(0);
  });

  it('T046: battle:join 缺 battleId 应收到 join:error', async () => {
    const client = connectClient(generateToken('joiner-3', 'eve'));
    await waitForConnect(client);

    const errPromise = waitForEvent<{ error: string }>(client, 'battle:join:error');
    client.emit('battle:join', {}); // 缺 battleId
    const errPayload = await errPromise;

    expect(errPayload.error).toBe('Invalid battleId');
    // mock 不应被调用
    expect(mockGetPendingBattleForJoin).not.toHaveBeenCalled();
  });

  it('T046: 第二个 client join 同一 battle 时,第一个 client 应收到 opponent_joined', async () => {
    const battleId = 'battle-shared';
    const client1 = connectClient(generateToken('player-1', 'alice'));
    const client2 = connectClient(generateToken('player-2', 'bob'));

    await waitForConnect(client1);
    await waitForConnect(client2);

    // mock DB 对两个 user 都返回同一个 battle
    mockGetPendingBattleForJoin.mockResolvedValue({
      id: battleId,
      player1_id: 'p1-id',
      player2_id: 'p2-id',
      status: 'pending',
      matched_at: new Date(),
      started_at: null,
    });

    // client1 先 join
    const ok1 = waitForEvent<{ opponentInRoom: boolean }>(client1, 'battle:join:ok');
    client1.emit('battle:join', { battleId });
    const ok1Payload = await ok1;
    expect(ok1Payload.opponentInRoom).toBe(false);

    // client2 join → client1 应收到 opponent_joined
    const opponentJoinedPromise = waitForEvent<{ userId: string; username: string }>(
      client1,
      'battle:opponent_joined'
    );
    const ok2Promise = waitForEvent<{ opponentInRoom: boolean }>(client2, 'battle:join:ok');

    client2.emit('battle:join', { battleId });

    const [opponentPayload, ok2Payload] = await Promise.all([
      opponentJoinedPromise,
      ok2Promise,
    ]);

    expect(opponentPayload.userId).toBe('player-2');
    expect(opponentPayload.username).toBe('bob');
    expect(ok2Payload.opponentInRoom).toBe(true);

    // 验证两个 socket 都在 room 内
    const socketsInBattle = await io.in(`battle:${battleId}`).fetchSockets();
    expect(socketsInBattle.length).toBe(2);
  });

  it('T046: 房间内一方断开时,另一方应收到 opponent_disconnected', async () => {
    const battleId = 'battle-disconn';
    const client1 = connectClient(generateToken('disc-1', 'alice'));
    const client2 = connectClient(generateToken('disc-2', 'bob'));

    await waitForConnect(client1);
    await waitForConnect(client2);

    mockGetPendingBattleForJoin.mockResolvedValue({
      id: battleId,
      player1_id: 'p1',
      player2_id: 'p2',
      status: 'pending',
      matched_at: new Date(),
      started_at: null,
    });

    // 双方都 join 房间
    const ok1 = waitForEvent(client1, 'battle:join:ok');
    const ok2 = waitForEvent(client2, 'battle:join:ok');
    client1.emit('battle:join', { battleId });
    client2.emit('battle:join', { battleId });
    await Promise.all([ok1, ok2]);

    // client1 监听 opponent_disconnected
    const disconnectPromise = waitForEvent<{ userId: string; timestamp: number }>(
      client1,
      'battle:opponent_disconnected'
    );

    // client2 断开
    client2.close();
    // 避免 afterEach 重复 close
    activeClients = activeClients.filter((c) => c !== client2);

    const payload = await disconnectPromise;
    expect(payload.userId).toBe('disc-2');
    expect(typeof payload.timestamp).toBe('number');
  });

  it('T046: 断开时 socket.data.battleId 未设置 → 不应推送 opponent_disconnected', async () => {
    const client = connectClient(generateToken('no-battle', 'eve'));
    await waitForConnect(client);

    // 监听 battle:opponent_disconnected(不应触发)
    const unexpectedEvent = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('should not receive event')), 300);
      client.once('battle:opponent_disconnected', (payload) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });

    client.close();
    activeClients = activeClients.filter((c) => c !== client);

    // 期望 300ms 内不收到事件
    await expect(unexpectedEvent).rejects.toThrow('should not receive event');

    // 等待 socket 完全断开
    await waitForNoSockets();
  });

  // ============== T047 tests ==============

  /**
   * 共享 mock 装配:6 角色(双方各 3),user-room 推手牌用
   */
  const setupFullStateMocks = (): {
    battleId: string;
    p1: string;
    p2: string;
  } => {
    const battleId = 'battle-t047-1';
    const p1 = 'user-t047-p1';
    const p2 = 'user-t047-p2';

    mockGetPendingBattleForJoin.mockResolvedValue({
      id: battleId,
      player1_id: 'p1-id',
      player2_id: 'p2-id',
      status: 'pending',
      matched_at: new Date(),
      started_at: null,
    });

    mockGetDbSessionState.mockResolvedValue({
      currentRound: 1,
      currentStep: 1,
      currentPhase: 'playing',
      currentActorId: 'c-p1-1',
    });

    mockListCharactersInBattle.mockResolvedValue([
      { characterId: 'c-p1-1', playerId: 'p1-id', userId: p1, profession: 'warrior', name: 'W1' },
      { characterId: 'c-p1-2', playerId: 'p1-id', userId: p1, profession: 'ranger', name: 'R1' },
      { characterId: 'c-p1-3', playerId: 'p1-id', userId: p1, profession: 'mage', name: 'M1' },
      { characterId: 'c-p2-1', playerId: 'p2-id', userId: p2, profession: 'warrior', name: 'W2' },
      { characterId: 'c-p2-2', playerId: 'p2-id', userId: p2, profession: 'ranger', name: 'R2' },
      { characterId: 'c-p2-3', playerId: 'p2-id', userId: p2, profession: 'mage', name: 'M2' },
    ]);

    mockGetCharacterStatus.mockImplementation(async (_b, cid) => ({
      characterId: cid,
      name: cid,
      profession: 'warrior' as const,
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
    }));

    mockGetActorHand.mockResolvedValue([]);

    return { battleId, p1, p2 };
  };

  it('T047: 两个 client 都 join 后,后加入者收到 battle:state:full 且 ownHand 是自己的角色', async () => {
    const { battleId, p1, p2 } = setupFullStateMocks();

    const client1 = connectClient(generateToken(p1, 'alice'));
    const client2 = connectClient(generateToken(p2, 'bob'));

    await waitForConnect(client1);
    await waitForConnect(client2);

    // client1 先 join(broadcaster 走 user-room,client1 是 user:p1 → 也会收到 state:full,
    // 但本测试不验证 client1 的 ownHand,只验证后加入者 client2 的 ownHand 隔离正确)
    const ok1Promise = waitForEvent<{ opponentInRoom: boolean }>(client1, 'battle:join:ok');
    client1.emit('battle:join', { battleId });
    await ok1Promise;

    // client2 join
    const ok2Promise = waitForEvent<{ opponentInRoom: boolean }>(client2, 'battle:join:ok');
    const c2FullPromise = waitForEvent<{ battleId: string; board: { characters: unknown[] }; ownHand: Record<string, unknown> }>(
      client2,
      'battle:state:full'
    );

    client2.emit('battle:join', { battleId });
    const [ok2Payload, fullPayload] = await Promise.all([ok2Promise, c2FullPromise]);

    expect(ok2Payload.opponentInRoom).toBe(true);
    expect(fullPayload.battleId).toBe(battleId);
    expect(fullPayload.board.characters).toHaveLength(6);
    // client2 自己的 ownHand 应只含 p2 的 3 个 characterId(隐私隔离 —— 不含 p1 的)
    expect(Object.keys(fullPayload.ownHand).sort()).toEqual(['c-p2-1', 'c-p2-2', 'c-p2-3']);
  });

  it('T047: 同一 socket join 时同时收到 battle:join:ok 和 battle:state:full', async () => {
    const { battleId, p1 } = setupFullStateMocks();

    const client = connectClient(generateToken(p1, 'alice'));
    await waitForConnect(client);

    const okPromise = waitForEvent<{ battleId: string; opponentInRoom: boolean }>(
      client,
      'battle:join:ok'
    );
    const fullPromise = waitForEvent<{ battleId: string; board: { characters: unknown[] }; ownHand: Record<string, unknown> }>(
      client,
      'battle:state:full'
    );

    client.emit('battle:join', { battleId });

    const [okPayload, fullPayload] = await Promise.all([okPromise, fullPromise]);

    expect(okPayload.battleId).toBe(battleId);
    expect(okPayload.opponentInRoom).toBe(false);
    expect(fullPayload.board.characters).toHaveLength(6);
    // p1 的 ownHand 应有 3 个 characterId
    expect(Object.keys(fullPayload.ownHand).sort()).toEqual(['c-p1-1', 'c-p1-2', 'c-p1-3']);
  });

  it('T047: broadcastFullState 内部异常时仍收到 join:ok,不发 join:error', async () => {
    const battleId = 'battle-t047-err';
    const userId = 'user-t047-err';
    const client = connectClient(generateToken(userId, 'eve'));
    await waitForConnect(client);

    // getPendingBattleForJoin 通过
    mockGetPendingBattleForJoin.mockResolvedValueOnce({
      id: battleId,
      player1_id: 'p1',
      player2_id: 'p2',
      status: 'pending',
      matched_at: new Date(),
      started_at: null,
    });

    // broadcastFullState 内部 listCharactersInBattle 抛错
    mockListCharactersInBattle.mockRejectedValueOnce(new Error('boom'));

    // getDbSessionState 也设个返 null,确保 board 路径不阻塞(error 在 broadcastFullState 的 try/catch 内吞掉)
    mockGetDbSessionState.mockResolvedValueOnce(null);

    // 静默 console.error(本测试预期它被调用)
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    // 监听 join:ok(应到)
    const okPromise = waitForEvent<{ battleId: string }>(client, 'battle:join:ok');

    // 监听 join:error(不应到)
    const errPromise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('should not receive join:error')), 300);
      client.once('battle:join:error', (payload) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });

    client.emit('battle:join', { battleId });

    const okPayload = await okPromise;
    expect(okPayload.battleId).toBe(battleId);

    // 不应收到 join:error
    await expect(errPromise).rejects.toThrow('should not receive join:error');

    // console.error 应被调用过(把 boom 记下来)
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
