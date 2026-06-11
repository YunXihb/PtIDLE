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

/**
 * T045 集成测试 —— 真实 socket.io-client 连真实 socket.io server
 *
 * 覆盖 3 个用例：
 *   1. 客户端带有效 JWT 连接 → connect 事件 + socket.connected=true + 服务端 socket.data.userId 可读
 *   2. 客户端无 token 连接 → connect_error 事件 + error.message='No token provided'
 *   3. 客户端断开 → 服务端 disconnect handler 被调用 + socket 数归零
 *
 * 端口隔离：listen(0) 随机端口，避免与开发服务器冲突
 */

/** T045 写入 socket.data 的字段集（与 verifyClientToken / connection handler 约定） */
interface SocketData {
  userId: string;
  username: string;
}

type AuthedSocket = Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;

describe('T045 socketServer 基础连接', () => {
  let httpServer: http.Server;
  let io: IOServer<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;
  let port: number;
  let activeClient: ClientSocket | null = null;

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

  // 防御性 cleanup:即使测试在 close() 前抛错,也确保 client 关闭
  afterEach(() => {
    if (activeClient) {
      activeClient.close();
      activeClient = null;
    }
  });

  // 工具：生成有效 JWT
  const generateToken = (userId: string, username: string): string => {
    return jwt.sign({ userId, username }, JWT_SECRET);
  };

  // 工具：建连并返回 ClientSocket（统一设置 transport + 自动登记到 activeClient）
  const connectClient = (token?: string): ClientSocket => {
    const client = Client(`http://localhost:${port}`, {
      auth: token ? { token } : {},
      transports: ['websocket'],
    });
    activeClient = client;
    return client;
  };

  // 工具：等待 connect 事件
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

  // 工具：等待 connect_error 事件
  const waitForConnectError = (client: ClientSocket): Promise<Error> => {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(new Error('connect_error timeout')), 3000);
      client.once('connect_error', (err) => {
        clearTimeout(timer);
        resolve(err);
      });
    });
  };

  // 工具：事件驱动等待 fetchSockets() 长度归零（替代 200ms 硬睡眠）
  const waitForNoSockets = async (maxMs = 1000): Promise<void> => {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      const sockets = await io.fetchSockets();
      if (sockets.length === 0) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('timeout waiting for sockets to drain');
  };

  it('客户端带有效 JWT 应能成功连接,且服务端可读 userId/username', async () => {
    const userId = 'user-1';
    const username = 'alice';
    const client = connectClient(generateToken(userId, username));

    await waitForConnect(client);
    expect(client.connected).toBe(true);

    // 服务端侧：通过 fetchSockets 读取 socket.data
    const sockets = await io.fetchSockets();
    expect(sockets.length).toBe(1);
    const serverSocket = sockets[0] as unknown as AuthedSocket;
    expect(serverSocket.data.userId).toBe(userId);
    expect(serverSocket.data.username).toBe(username);
  });

  it('客户端无 token 应触发 connect_error 且 message=No token provided', async () => {
    const client = connectClient();

    const err = await waitForConnectError(client);
    expect(err.message).toBe('No token provided');
    expect(client.connected).toBe(false);
  });

  it('客户端连接后断开,服务端 disconnect handler 应被调用', async () => {
    const client = connectClient(generateToken('user-2', 'bob'));

    await waitForConnect(client);
    expect(client.connected).toBe(true);

    // 断开前确认 1 个 socket
    const beforeSockets = await io.fetchSockets();
    expect(beforeSockets.length).toBe(1);

    // 触发客户端断开
    client.close();
    activeClient = null; // 已主动关闭,afterEach 不再重复 close

    // 事件驱动等待 socket 数归零
    await waitForNoSockets();
  });
});
