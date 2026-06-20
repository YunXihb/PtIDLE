import { Server as IOServer, Socket } from 'socket.io';
import { getPendingBattleForJoin } from '../services/battleService';
import { broadcastFullState } from './battleStateBroadcaster';
import { initBattleField } from '../services/battleInitializationService';
import { executeMove, executePlayCard, executeEndStep } from '../services/battleActionService';
import type { HandCard } from '../services/handService';
import { redisClient } from '../config/redis';
import { queryOne } from '../config/database';
import { validateOperationContext, validateJoinContext } from './wsValidation';

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

  // 1.5 T055: 跨切校验 - 仅 rate-limit（join 之前不在 room，room 检查会失败；status=pending 由 DB 查吸收）
  const rateCheck = await validateJoinContext(userId, 'battle:join');
  if (!rateCheck.ok) {
    socket.emit('battle:join:error', { error: rateCheck.reason });
    return;
  }

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

/**
 * T049: 处理客户端的 `battle:move` 事件
 *
 * 流程:
 *   1. 验证 payload 结构（battleId/characterId string, toX/toY 有限数字）
 *   2. 失败 → emit `battle:move:error` `{ error: 'invalid_payload' }`
 *   3. 调 `executeMove(io, battleId, characterId, toX, toY, socket.data.userId)`
 *   4. executeMove 失败 → emit `battle:move:error` 带 service 返回的 error
 *   5. 成功 → 不 emit 任何事件（依赖 broadcastBoardState room-wide 推送 + 客户端推断成功）
 *
 * @param io IOServer 实例
 * @param socket 客户端 socket
 * @param payload { battleId, characterId, toX, toY }
 */
export async function handleBattleMove(
  io: IOServer,
  socket: Socket,
  payload: {
    battleId?: unknown;
    characterId?: unknown;
    toX?: unknown;
    toY?: unknown;
  }
): Promise<void> {
  // 1. payload 验证
  const battleId = typeof payload?.battleId === 'string' ? payload.battleId : null;
  const characterId = typeof payload?.characterId === 'string' ? payload.characterId : null;
  const toX = typeof payload?.toX === 'number' && Number.isFinite(payload.toX) ? payload.toX : null;
  const toY = typeof payload?.toY === 'number' && Number.isFinite(payload.toY) ? payload.toY : null;

  if (!battleId || !characterId || toX === null || toY === null) {
    socket.emit('battle:move:error', { error: 'invalid_payload' });
    return;
  }

  const userId = socket.data.userId as string;

  // 1.5 T055: 跨切校验 - 房间成员 + battle status=ongoing + 速率限制
  const opCheck = await validateOperationContext(socket, {
    battleId,
    userId,
    eventName: 'battle:move',
  });
  if (!opCheck.ok) {
    socket.emit('battle:move:error', { error: opCheck.reason });
    return;
  }

  // 2. 调 service
  const result = await executeMove(io, battleId, characterId, toX, toY, userId);

  // 3. 失败回执
  if (!result.success) {
    socket.emit('battle:move:error', { error: result.error });
  }
  // 成功：不 emit（broadcaster 已 room-wide 推 board）
}

/**
 * T050 Task 8: 处理客户端的 `battle:play_card` 事件
 *
 * 流程:
 *   1. 验证 payload 结构（battleId/characterId string, handCard object with required fields）
 *   2. 失败 → emit `battle:play_card:error` `{ error: 'invalid_payload' }`
 *   3. 调 `executePlayCard(io, battleId, characterId, handCard, socket.data.userId)`
 *   4. executePlayCard 失败 → emit `battle:play_card:error` 带 service 返回的 error + detail
 *   5. 成功 → 不 emit 任何事件（依赖 broadcastHandState + broadcastCharacterStatus + broadcastBoardState 推送）
 *   6. executePlayCard 抛错 → 向上抛（异常路径，由 socketServer 层兜底）
 */
export async function handleBattlePlayCard(
  io: IOServer,
  socket: Socket,
  payload: { battleId?: unknown; characterId?: unknown; handCard?: unknown }
): Promise<void> {
  // 1. payload 验证
  const battleId = typeof payload?.battleId === 'string' ? payload.battleId : null;
  const characterId = typeof payload?.characterId === 'string' ? payload.characterId : null;
  const handCard = validatePlayCardPayload(payload?.handCard);

  if (!battleId || !characterId || !handCard) {
    socket.emit('battle:play_card:error', { error: 'invalid_payload' });
    return;
  }

  const userId = socket.data.userId as string;

  // 1.5 T055: 跨切校验 - 房间成员 + battle status=ongoing + 速率限制
  const opCheck = await validateOperationContext(socket, {
    battleId,
    userId,
    eventName: 'battle:play_card',
  });
  if (!opCheck.ok) {
    socket.emit('battle:play_card:error', { error: opCheck.reason });
    return;
  }

  // 2. 调 service
  const result = await executePlayCard(io, battleId, characterId, handCard, userId);

  // 3. 失败回执
  if (!result.success) {
    socket.emit('battle:play_card:error', {
      error: result.error,
      detail: result.detail,
    });
  }
  // 成功：不 emit（broadcaster 已 room-wide 推 hand/character/board）
}

/**
 * 内部 helper: 验证 handCard payload 结构
 * 严格按 HandCard 形状校验（deck_id/card_id/name/type/cost/effect/template_no/source）
 * 允许的 type: 'attack' | 'defense' | 'tactical'（'defense' 在 T050 service 层返回 unsupported_card_type）
 * 允许的 source: 'deck' | 'public_pool'
 *
 * 注意：handler 不做业务 type dispatch 过滤（防 'defense' 等）；只校验 shape。
 * 业务 type 校验由 service (executePlayCard) 负责 — handler 收到 unsupported 时转发即可。
 *
 * 透传 extra 字段（如 attack 卡片的 targetId），service 层通过 `(handCard as HandCard & { targetId? })` 读取。
 */
function validatePlayCardPayload(
  raw: unknown
): (HandCard & Record<string, unknown>) | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.deck_id !== 'string') return null;
  if (typeof c.card_id !== 'string') return null;
  if (typeof c.name !== 'string') return null;
  if (c.type !== 'attack' && c.type !== 'defense' && c.type !== 'tactical') return null;
  if (typeof c.cost !== 'number' || !Number.isFinite(c.cost)) return null;
  if (!c.effect || typeof c.effect !== 'object') return null;
  if (typeof c.template_no !== 'number') return null;
  if (c.source !== 'deck' && c.source !== 'public_pool') return null;

  return c as HandCard & Record<string, unknown>;
}

/**
 * T051 Task 7: 处理客户端的 `battle:skip_play` 事件
 *
 * 流程:
 *   1. 验证 payload 结构（battleId 是 string）
 *   2. 失败 → emit `battle:skip_play:error` `{ error: 'invalid_payload' }`
 *   3. 调 `executeEndStep(io, battleId)`
 *   4. executeEndStep 失败 → emit `battle:skip_play:error` 带 error + detail
 *   5. 成功 → 不 emit（依赖 broadcastSessionState + broadcastBoardState 推送）
 *   6. executeEndStep 抛错 → 向上抛（异常路径，由 socketServer 层兜底）
 *
 * 注意：handler 不做 actor 归属检查（依赖 phase machine 锁）。
 */
export async function handleBattleSkipPlay(
  io: IOServer,
  socket: Socket,
  payload: { battleId?: unknown }
): Promise<void> {
  // 1. payload 验证
  const battleId = typeof payload?.battleId === 'string' ? payload.battleId : null;
  if (!battleId) {
    socket.emit('battle:skip_play:error', { error: 'invalid_payload' });
    return;
  }

  const userId = socket.data.userId as string;

  // 1.5 T055: 跨切校验 - 房间成员 + battle status=ongoing + 速率限制
  const opCheck = await validateOperationContext(socket, {
    battleId,
    userId,
    eventName: 'battle:skip_play',
  });
  if (!opCheck.ok) {
    socket.emit('battle:skip_play:error', { error: opCheck.reason });
    return;
  }

  // 2. 调 service
  const result = await executeEndStep(io, battleId);

  // 3. 失败回执
  if (!result.success) {
    socket.emit('battle:skip_play:error', {
      error: result.error,
      detail: result.detail,
    });
  }
  // 成功: 不 emit（依赖 broadcaster 推送 session + board）
}
