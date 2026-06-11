import { Server as IOServer, Socket } from 'socket.io';
import { verifyClientToken } from './authMiddleware';

/**
 * T045 Socket.io 基础连接入口
 *
 * 范围（仅 T045）：
 *   - 握手期 JWT 鉴权（io.use）
 *   - connection / disconnect 日志
 *   - socket.data 写入 userId/username（battleId 留给 T046）
 *
 * 范围外（Out of Scope，留给后续）：
 *   - 房间订阅 / battleId 绑定 / 房间事件广播 → T046
 *   - 棋盘状态实时同步、手牌广播、能量广播 → T047
 *   - 撮合成功后的 push（io.to(userId).emit('battle:matched', ...)）→ T046
 *   - 重连机制 / heartbeat / 速率限制 → 运维层
 *   - 跨节点 socket.io adapter（Redis adapter）→ 单体 MVP 不做
 */
export function initializeSocketServer(io: IOServer): void {
  // 1. 全局鉴权中间件（握手期拒绝，无效 client 不消耗 connection slot）
  io.use(verifyClientToken);

  // 2. connection handler
  io.on('connection', (socket: Socket) => {
    console.log(
      `[WS] Connected: userId=${socket.data.userId} socketId=${socket.id}`
    );

    // T046+ 在此注册房间事件（battle:join / battle:ready / battle:action）
    socket.on('disconnect', (reason) => {
      console.log(
        `[WS] Disconnected: userId=${socket.data.userId} reason=${reason}`
      );
    });
  });
}
