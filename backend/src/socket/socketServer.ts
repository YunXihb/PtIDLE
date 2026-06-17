import { Server as IOServer, Socket } from 'socket.io';
import { verifyClientToken } from './authMiddleware';
import { handleBattleJoin, handleBattleMove, handleBattlePlayCard, broadcastOpponentDisconnected, userRoom } from './battleRoom';

/**
 * T045 + T046 Socket.io 入口
 *
 * T045 范围:
 *   - 握手期 JWT 鉴权（io.use）
 *   - connection / disconnect 日志
 *   - socket.data 写入 userId/username
 *
 * T046 范围（新增）:
 *   - 连接成功后自动 socket.join(`user:{userId}`) 作为个人推送通道
 *   - 注册 `battle:join` handler,验证后让 socket 加入 `battle:{battleId}` 房间
 *   - 导出 io 单例供其他模块（matchmakingController）推送 battle:matched
 *   - disconnect 时若 socket.data.battleId 存在,推 opponent_disconnected 给房间
 *
 * 范围外(Out of Scope,留给后续):
 *   - 棋盘状态/手牌/能量广播 → T047
 *   - 回合切换 WS 路由 → T051
 *   - 重连机制 / heartbeat / 断线超时强制胜利 → T046+
 *   - 撮合超时(撮合后 N 分钟未进)→ T046+
 *   - 跨节点 socket.io adapter(Redis adapter)→ 单体 MVP 不做
 */

// 模块级 io 单例 —— controller 层(matcher maker)需要直接 emit 给 user-room
let ioInstance: IOServer | null = null;

export function getIO(): IOServer {
  if (!ioInstance) {
    throw new Error('Socket.io server not initialized. Call initializeSocketServer first.');
  }
  return ioInstance;
}

export function initializeSocketServer(io: IOServer): void {
  ioInstance = io;

  // 1. 全局鉴权中间件(握手期拒绝,无效 client 不消耗 connection slot)
  io.use(verifyClientToken);

  // 2. connection handler
  io.on('connection', (socket: Socket) => {
    const userId = socket.data.userId as string;
    const username = socket.data.username as string;

    console.log(`[WS] Connected: userId=${userId} socketId=${socket.id}`);

    // T046: 自动加入 user-room 作为个人推送通道(支持同 user 多端连接)
    void socket.join(userRoom(userId));

    // T046: 注册 battle:join handler
    socket.on('battle:join', (payload: { battleId?: unknown }) => {
      handleBattleJoin(io, socket, payload).catch((err) => {
        console.error(`[WS] battle:join error: userId=${userId}`, err);
        socket.emit('battle:join:error', { error: 'Internal server error' });
      });
    });

    // T049: 注册 battle:move handler
    socket.on('battle:move', (payload: { battleId?: unknown; characterId?: unknown; toX?: unknown; toY?: unknown }) => {
      handleBattleMove(io, socket, payload).catch((err) => {
        console.error(`[WS] battle:move error: userId=${userId}`, err);
        socket.emit('battle:move:error', { error: 'internal_error' });
      });
    });

    // T050: 出牌事件
    socket.on('battle:play_card', (payload) => {
      const userId = (socket.data as { userId?: string }).userId;
      handleBattlePlayCard(io, socket, payload).catch((err) => {
        console.error(`[WS] battle:play_card error: userId=${userId}`, err);
        socket.emit('battle:play_card:error', { error: 'internal_error' });
      });
    });

    // disconnect: 若 socket.data.battleId 存在,推 opponent_disconnected
    socket.on('disconnect', (reason) => {
      console.log(`[WS] Disconnected: userId=${userId} reason=${reason}`);

      const battleId = socket.data.battleId as string | undefined;
      if (battleId) {
        broadcastOpponentDisconnected(io, battleId, userId);
      }
    });
  });
}
