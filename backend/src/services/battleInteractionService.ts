/**
 * 对战互动服务 (Battle Interaction Service)
 *
 * 玩家在对战中的主动互动操作：
 * - surrenderBattle: 退出对战（判负，对方胜利）
 * - requestDraw / respondDraw: 请求平局 / 对方接受或拒绝
 *
 * 设计要点：
 * - result.success 风格（对齐 matchmakingService），业务失败返回 error 字符串，
 *   由 battleRoom handler 转 emit `battle:X:error`
 * - 结算统一走 recordVictory（UPDATE battles + finishSession + broadcastBattleEnd），
 *   胜负战绩入账由前端收到 battle:end 后 POST /api/battle/result（T054 settleBattle）完成
 * - 求和请求存 Redis `battle:{battleId}:draw_request`（值=请求方 userId，无 TTL），
 *   战斗结束由 recordVictory 统一清理
 */

import type { Server as IOServer } from 'socket.io';
import { queryOne } from '../config/database';
import { redisClient } from '../config/redis';
import { redisKey } from '../utils/redisKeys';
import { recordVictory, Side } from './battleOutcomeService';
import { ApiError } from '../utils/ApiError';

interface BattleRow {
  id: string;
  status: string;
  player1_id: string;
  player2_id: string;
  p1_user_id: string | null;
  p2_user_id: string | null;
}

/**
 * 读取对局行（JOIN 双方 user_id），含归属判定
 * @returns battle 行 + 该 userId 的对侧信息；玩家非参与者时抛 ApiError(403)
 */
async function loadBattleContext(battleId: string, userId: string): Promise<{
  battle: BattleRow;
  mySide: Side;
  opponentSide: Side;
  opponentUserId: string | null;
}> {
  const row = await queryOne<BattleRow>(
    `SELECT b.id, b.status, b.player1_id, b.player2_id,
            p1.user_id AS p1_user_id,
            p2.user_id AS p2_user_id
     FROM battles b
     LEFT JOIN players p1 ON p1.id = b.player1_id
     LEFT JOIN players p2 ON p2.id = b.player2_id
     WHERE b.id = $1`,
    [battleId]
  );
  if (!row) {
    throw new ApiError(404, 'Battle not found');
  }
  if (row.p1_user_id !== userId && row.p2_user_id !== userId) {
    throw new ApiError(403, 'Not a participant of this battle');
  }
  const mySide: Side = row.p1_user_id === userId ? 'p1' : 'p2';
  const opponentSide: Side = mySide === 'p1' ? 'p2' : 'p1';
  return {
    battle: row,
    mySide,
    opponentSide,
    opponentUserId: mySide === 'p1' ? row.p2_user_id : row.p1_user_id,
  };
}

/** 读双方当前星数（无 key 按 0，与 checkWinCondition 同口径） */
async function readStars(battleId: string): Promise<{ p1Stars: number; p2Stars: number }> {
  const [p1Raw, p2Raw] = await Promise.all([
    redisClient.get(redisKey.stars(battleId, 'p1')),
    redisClient.get(redisKey.stars(battleId, 'p2')),
  ]);
  return {
    p1Stars: p1Raw === null ? 0 : parseInt(p1Raw, 10),
    p2Stars: p2Raw === null ? 0 : parseInt(p2Raw, 10),
  };
}

// ========================================
// 1. 退出对战（认输）
// ========================================

/**
 * 退出对战：中止本次对局，退出方判负、对方胜利
 *
 * - status ∈ {pending, ongoing} 均可退出（pending 兼作未开局卡死对局的逃生门）
 * - 结算复用 recordVictory（victory_type='surrender'），双方客户端收 battle:end
 *
 * @throws ApiError: 404 对局不存在 / 403 非参与者 / 409 对局已结束
 */
export async function surrenderBattle(
  io: IOServer,
  battleId: string,
  userId: string
): Promise<void> {
  const { battle, opponentSide } = await loadBattleContext(battleId, userId);

  if (battle.status !== 'pending' && battle.status !== 'ongoing') {
    throw new ApiError(409, 'Battle already finished');
  }

  const { p1Stars, p2Stars } = await readStars(battleId);

  // 退出方判负 -> 对方胜利
  await recordVictory(
    io,
    battleId,
    { status: 'win', winnerSide: opponentSide, p1Stars, p2Stars },
    'surrender'
  );
}

// ========================================
// 2. 请求平局
// ========================================

/**
 * 请求平局：登记请求方并向对战房间广播
 *
 * - 仅 status='ongoing' 可求和（未开局无和局概念，直接退出对战即可）
 * - 同一时刻至多一个未决请求（后发覆盖先发）
 * - 客户端按 fromUserId === 自己 忽略自己发出的广播
 *
 * @throws ApiError: 404 / 403 / 409（对局不存在 / 非参与者 / 非进行中）
 */
export async function requestDraw(
  io: IOServer,
  battleId: string,
  userId: string
): Promise<void> {
  const { battle } = await loadBattleContext(battleId, userId);

  if (battle.status !== 'ongoing') {
    throw new ApiError(409, 'Battle not ongoing');
  }

  await redisClient.set(redisKey.drawRequest(battleId), userId);

  io.to(`battle:${battleId}`).emit('battle:draw_requested', {
    battleId,
    fromUserId: userId,
  });
}

// ========================================
// 3. 回应平局
// ========================================

/**
 * 回应平局请求（仅对方玩家可回应）
 *
 * - accept=true  -> DEL 请求 key + recordVictory 平局结算（victory_type='draw'）
 * - accept=false -> DEL 请求 key + 仅向请求方单播 battle:draw_declined（对当前对局无影响）
 *
 * @throws ApiError: 404 / 403（非参与者或回应自己的请求）/ 409（非进行中或无未决请求）
 */
export async function respondDraw(
  io: IOServer,
  battleId: string,
  userId: string,
  accept: boolean
): Promise<void> {
  const { battle } = await loadBattleContext(battleId, userId);

  if (battle.status !== 'ongoing') {
    throw new ApiError(409, 'Battle not ongoing');
  }

  const requesterId = await redisClient.get(redisKey.drawRequest(battleId));
  if (!requesterId) {
    throw new ApiError(409, 'No pending draw request');
  }
  if (requesterId === userId) {
    throw new ApiError(403, 'Cannot respond to your own draw request');
  }

  await redisClient.del(redisKey.drawRequest(battleId));

  if (accept) {
    const { p1Stars, p2Stars } = await readStars(battleId);
    await recordVictory(io, battleId, { status: 'draw', p1Stars, p2Stars }, 'draw');
  } else {
    // 仅向请求方单播（socket room 按 userId 路由：userRoom 是每个 userId 的个人房间）
    io.to(`user:${requesterId}`).emit('battle:draw_declined', { battleId });
  }
}
