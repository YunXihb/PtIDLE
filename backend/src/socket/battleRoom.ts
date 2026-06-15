import { Server as IOServer, Socket } from 'socket.io';
import { getPendingBattleForJoin } from '../services/battleService';
import { broadcastFullState } from './battleStateBroadcaster';
import { initBattleField } from '../services/battleInitializationService';
import { redisClient } from '../config/redis';
import { queryOne } from '../config/database';

/**
 * T046 房间管理 —— 集中 battle 房间相关的 socket.io 操作
 *
 * 房间命名约定:
 *   - `user:{userId}` —— 个人推送通道。连接握手成功后自动加入。
 *                          用于撮合成功 push、对手断线通知等「发给特定 user」场景。
 *                          支持同 user 多端连接（多 socket 共享 user-room）。
 *   - `battle:{battleId}` —— 对战房间广播。客户端发 `battle:join` 验证后加入。
 *                             用于对手状态、操作同步（T047+）。
 *
 * 事件协议:
 *   - server → client: `battle:matched`            { battleId, opponentUserId }
 *   - client → server: `battle:join`               { battleId }
 *   - server → client: `battle:join:ok`            { battleId, opponentInRoom }
 *   - server → client: `battle:join:error`         { battleId, error }
 *   - server → room:   `battle:opponent_joined`    { userId, username }
 *   - server → room:   `battle:opponent_disconnected` { userId, timestamp }
 */

// 房间名构造器
export const userRoom = (userId: string): string => `user:${userId}`;
export const battleRoom = (battleId: string): string => `battle:${battleId}`;

// 从房间名反解（保留供未来使用）
const USER_ROOM_PREFIX = 'user:';
const BATTLE_ROOM_PREFIX = 'battle:';

export const parseUserRoom = (room: string): string | null =>
  room.startsWith(USER_ROOM_PREFIX) ? room.slice(USER_ROOM_PREFIX.length) : null;

export const parseBattleRoom = (room: string): string | null =>
  room.startsWith(BATTLE_ROOM_PREFIX) ? room.slice(BATTLE_ROOM_PREFIX.length) : null;

/**
 * 处理客户端的 `battle:join` 事件。
 *
 * 流程:
 *   1. 验证 payload.battleId 是 string
 *   2. DB 查询验证 user 是该 battle 的参与者（status='pending'）
 *   3. 验证通过 → socket.join('battle:{battleId}') + 写 socket.data.battleId
 *      - 广播 `battle:opponent_joined` 给房间内其他 socket
 *      - 回 `battle:join:ok` 给本 socket,opponentInRoom 表示对手是否已在房间
 *   4. 验证失败 → 回 `battle:join:error`,不加入房间
 *
 * @param io IOServer 实例
 * @param socket 客户端 socket
 * @param payload { battleId: string }
 */
export async function handleBattleJoin(
  io: IOServer,
  socket: Socket,
  payload: { battleId?: unknown }
): Promise<void> {
  // 1. payload 校验
  const battleId = typeof payload?.battleId === 'string' ? payload.battleId : null;
  if (!battleId) {
    socket.emit('battle:join:error', { error: 'Invalid battleId' });
    return;
  }

  const userId = socket.data.userId as string;
  const username = socket.data.username as string;

  // 2. DB 鉴权:验证 user 是该 battle 参与者且 status='pending'
  const battle = await getPendingBattleForJoin(battleId, userId);
  if (!battle) {
    socket.emit('battle:join:error', { battleId, error: 'Not a participant of this battle' });
    return;
  }

  // 3. 加入房间 + 记录 battleId 到 socket.data
  await socket.join(battleRoom(battleId));
  socket.data.battleId = battleId;

  // 4. 检查房间内其他 socket（对手是否已 join）
  const socketsInRoom = await io.in(battleRoom(battleId)).fetchSockets();
  const opponentInRoom = socketsInRoom.some(
    (s) => (s.data as { userId?: string }).userId !== userId
  );

  // 5. 回执给本 socket
  socket.emit('battle:join:ok', { battleId, opponentInRoom });

  // 6. 广播给房间内其他 socket(对手)
  if (opponentInRoom) {
    socket.to(battleRoom(battleId)).emit('battle:opponent_joined', { userId, username });
  }

  // 7. T047 推全量首屏状态(含自己手牌,user-room)。
  //    broadcaster 内部 try/catch 已吞掉异常 + console.error —— 失败不回 join:error(房间已加入,前端可重试)
  void broadcastFullState(io, battleId, userId);

  // 8. T048: 双 join 后触发战场初始化
  try {
    await tryInitBattleField(io, battleId, userId);
  } catch (initErr) {
    console.error(`[handleBattleJoin] tryInitBattleField failed:`, initErr);
  }
}

/**
 * 推送对手断线通知给房间内其他 socket。
 *
 * 由 socketServer 的 disconnect handler 调用:当 socket.data.battleId 存在时触发。
 *
 * @param io IOServer 实例
 * @param battleId 战斗 id
 * @param userId 断线的 user id
 */
export function broadcastOpponentDisconnected(
  io: IOServer,
  battleId: string,
  userId: string
): void {
  io.in(battleRoom(battleId)).emit('battle:opponent_disconnected', {
    userId,
    timestamp: Date.now(),
  });
}

/**
 * T048: 双方都在 battle 房间后，调用 initBattleField 初始化战场
 * - SETNX init_lock 防止并发
 * - 检查 status='pending' 才执行（idempotent re-join 直接 broadcast）
 */
export async function tryInitBattleField(
  io: IOServer,
  battleId: string,
  joiningUserId: string
): Promise<void> {
  const lockToken = `${Date.now()}-${Math.random()}`;
  const locked = await redisClient.set(
    `battle:${battleId}:init_lock`,
    lockToken,
    { NX: true, EX: 30 }
  );

  if (!locked) {
    // 别人正在 init，sleep 100ms 后读 status
    await new Promise(r => setTimeout(r, 100));
    const status = await getBattleStatus(battleId);
    if (status === 'ongoing') {
      await broadcastFullState(io, battleId, joiningUserId).catch(err =>
        console.error(`[tryInitBattleField:${battleId}] broadcast after lock-loss:`, err)
      );
    }
    return;
  }

  try {
    const otherInRoom = isOtherPlayerInRoom(io, battleId);
    const status = await getBattleStatus(battleId);

    if (otherInRoom && status === 'pending') {
      await initBattleField(io, battleId).catch(err => {
        console.error(`[tryInitBattleField:${battleId}] init failed:`, err);
      });
    } else {
      await broadcastFullState(io, battleId, joiningUserId).catch(err =>
        console.error(`[tryInitBattleField:${battleId}] broadcast:`, err)
      );
    }
  } finally {
    await redisClient.del(`battle:${battleId}:init_lock`);
  }
}

function isOtherPlayerInRoom(io: IOServer, battleId: string): boolean {
  const room = io.sockets.adapter.rooms.get(`battle:${battleId}`);
  return (room?.size ?? 0) > 1;
}

async function getBattleStatus(battleId: string): Promise<string | null> {
  const row = await queryOne<{ status: string }>(`SELECT status FROM battles WHERE id=$1`, [battleId]);
  return row?.status ?? null;
}
