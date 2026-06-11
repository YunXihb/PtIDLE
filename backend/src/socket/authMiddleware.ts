import { Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/jwt';

/**
 * T045 Socket.io 握手鉴权中间件
 *
 * - token 位置：socket.handshake.auth.token（socket.io v4 推荐方式，替代 v3 的 query.token）
 * - 共用 config/jwt.ts 的 JWT_SECRET,与 REST 鉴权（middleware/auth.ts）保持同一秘钥
 * - 验证成功后将 userId/username 写入 socket.data，供后续 connection handler / 房间管理使用
 * - 验证失败通过 next(new Error(...)) 拒绝握手，客户端收到 connect_error 事件
 */
export function verifyClientToken(
  socket: Socket,
  next: (err?: Error) => void
): void {
  const token = socket.handshake.auth?.token;
  if (!token) {
    return next(new Error('No token provided'));
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; username: string };

    // 写入 socket.data 供后续 handler 使用（T046 房间管理直接读）
    socket.data.userId = decoded.userId;
    socket.data.username = decoded.username;

    next();
  } catch (err) {
    next(new Error('Invalid token'));
  }
}
