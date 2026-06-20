/**
 * T055 操作合法性校验中心化（WS Handler 入口跨切校验）
 *
 * 背景:
 *   T049-T054 在 orchestrator 内部（executeMove / executePlayCard）实现了 per-action 业务校验
 *   （actor / phase / owner / range / 能量等）。但 WS handler 入口层缺跨切校验：
 *     - 房间成员资格（socket 不在 `battle:{battleId}` 房间 → 攻击者可伪造 battleId）
 *     - 对战状态（已结算 battle 仍能收到 move）
 *     - 速率限制（单连接可无限刷）
 *
 * 目标:
 *   在 WS handler 入口加 3 类跨切校验（fail-fast 返回 ValidationResult），
 *   不动 orchestrator 内部校验。降级策略：Redis/DB 异常 → allow + console.error。
 *
 * 范围外（明确不做）:
 *   - Nonce-based replay 防护
 *   - per-battle 全局 rate-limit
 *   - WS payload 形状检查（保留在 handler 内）
 *   - orchestrator 内部校验重构（T049/T050）
 */

import type { Socket } from 'socket.io';
import { redisClient } from '../config/redis';
import { queryOne } from '../config/database';
import { battleRoom } from './battleRoom';

// ========================================
// 常量
// ========================================

/** Rate limit 时间窗（秒） */
export const RATE_LIMIT_WINDOW_SEC = 60;

/** 每窗口最大请求次数（per user per event） */
export const RATE_LIMIT_MAX_PER_WINDOW = 60;

/** Rate limit Redis key 前缀 */
export const RATE_LIMIT_KEY_PREFIX = 'rl:ws:user:';

// ========================================
// 类型
// ========================================

/**
 * 校验失败原因。
 * - invalid_payload: payload 缺字段或类型不对（handler 层校验，validator 不会返回）
 * - not_in_room: socket 不在 battle room（攻击者伪造 battleId）
 * - battle_not_found: battleId 在 DB 中不存在
 * - battle_not_ongoing: status != 'ongoing'（已结算或未初始化）
 * - rate_limited: 当前窗口内调用次数超阈值
 */
export type ValidationFailureReason =
  | 'invalid_payload'
  | 'not_in_room'
  | 'battle_not_found'
  | 'battle_not_ongoing'
  | 'rate_limited';

export interface ValidationFailure {
  ok: false;
  reason: ValidationFailureReason;
  message: string;
}

export interface ValidationSuccess {
  ok: true;
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

/**
 * 调用方传入的上下文。
 * - battleId: 当前操作的战斗 ID
 * - userId: 来自 socket.data.userId（T045 authMiddleware 写入）
 * - eventName: 用于 rate-limit 按事件分桶（'battle:move' 等）
 */
export interface OperationContext {
  battleId: string;
  userId: string;
  eventName: string;
}

/**
 * BattleSocket: 简化的 socket 类型（只需要 .rooms / .data.userId）。
 * 用 Socket 兼容 socket.io 内置类型。
 */
export type BattleSocket = Socket;

// ========================================
// Rate limit Lua 脚本
// ========================================

/**
 * 原子 INCR + 首次设置 EXPIRE。
 *
 * KEYS[1] = rate limit key
 * ARGV[1] = window seconds（用于首次设置 EXPIRE）
 *
 * 返回: 当前计数（整数）
 *
 * 注意：EXPIRE 只在 current==1（首次创建）时设置，
 * 后续 INCR 不刷新 TTL —— 固定窗口语义。
 */
const RL_CHECK_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return current
`;

// ========================================
// Helpers（可单独调用，方便测试）
// ========================================

/**
 * 校验 socket 是否在 battle:{battleId} 房间内。
 *
 * 无 IO，纯内存检查 Socket.IO 内置房间注册表。
 *
 * @param socket 客户端 socket
 * @param battleId 战斗 ID
 * @returns 校验结果
 */
export function checkRoomMembership(
  socket: BattleSocket,
  battleId: string
): ValidationResult {
  // socket.rooms 至少包含 socket.id（自身房间），跨切检查要求显式加入 battle room
  if (!socket.rooms.has(battleRoom(battleId))) {
    return {
      ok: false,
      reason: 'not_in_room',
      message: `Socket not in battle room ${battleRoom(battleId)}`,
    };
  }
  return { ok: true };
}

/**
 * 校验 battle.status === 'ongoing'。
 *
 * DB 异常 → 降级为 allow（避免 Redis/DB 故障阻塞整个对战）。
 *
 * @param battleId 战斗 ID
 * @returns 校验结果
 */
export async function checkBattleOngoing(battleId: string): Promise<ValidationResult> {
  let row: { status: string } | null;
  try {
    row = await queryOne<{ status: string }>(
      `SELECT status FROM battles WHERE id = $1`,
      [battleId]
    );
  } catch (err) {
    console.error(`[wsValidation] checkBattleOngoing DB error (degrade-allow):`, err);
    return { ok: true };
  }

  if (!row) {
    return {
      ok: false,
      reason: 'battle_not_found',
      message: `Battle ${battleId} not found`,
    };
  }

  if (row.status !== 'ongoing') {
    return {
      ok: false,
      reason: 'battle_not_ongoing',
      message: `Battle ${battleId} status=${row.status}, expected 'ongoing'`,
    };
  }

  return { ok: true };
}

/**
 * 校验 user+event 在当前窗口内的调用次数是否超阈值。
 *
 * Redis 异常 → 降级为 allow（避免 Redis 故障阻塞合法玩家）。
 *
 * @param userId 用户 ID
 * @param eventName 事件名（'battle:move' 等）
 * @returns 校验结果
 */
export async function checkRateLimit(
  userId: string,
  eventName: string
): Promise<ValidationResult> {
  const key = `${RATE_LIMIT_KEY_PREFIX}${userId}:${eventName}`;

  let count: number;
  try {
    const result = (await redisClient.eval(RL_CHECK_LUA, {
      keys: [key],
      arguments: [String(RATE_LIMIT_WINDOW_SEC)],
    })) as number;
    count = Number(result);
  } catch (err) {
    console.error(`[wsValidation] checkRateLimit Redis error (degrade-allow):`, err);
    return { ok: true };
  }

  if (count > RATE_LIMIT_MAX_PER_WINDOW) {
    return {
      ok: false,
      reason: 'rate_limited',
      message: `Rate limit exceeded for ${eventName} (count=${count}, max=${RATE_LIMIT_MAX_PER_WINDOW})`,
    };
  }

  return { ok: true };
}

// ========================================
// 统一入口
// ========================================

/**
 * T055 统一校验入口。
 *
 * 检查顺序（fail-fast）:
 *   1. socket.rooms.has(battleRoom(battleId)) — 无 IO
 *   2. SELECT status FROM battles — DB 查询
 *   3. Redis Lua INCR + EXPIRE — 速率限制
 *
 * 降级策略：每步独立 try/catch，Redis/DB 异常降级为 allow + console.error。
 *
 * 注意：本函数不做 payload 形状检查（handler 内联校验，避免重复）。
 * 也跳过 actor/phase/owner/range/能量等业务校验（orchestrator 内部 T049/T050 负责）。
 *
 * @param socket 客户端 socket
 * @param ctx 操作上下文（battleId / userId / eventName）
 * @returns 校验结果
 */
export async function validateOperationContext(
  socket: BattleSocket,
  ctx: OperationContext
): Promise<ValidationResult> {
  // 1. 房间成员资格（无 IO）
  const roomCheck = checkRoomMembership(socket, ctx.battleId);
  if (!roomCheck.ok) return roomCheck;

  // 2. 对战状态（DB 查询，异常降级）
  const statusCheck = await checkBattleOngoing(ctx.battleId);
  if (!statusCheck.ok) return statusCheck;

  // 3. 速率限制（Redis Lua，异常降级）
  const rateCheck = await checkRateLimit(ctx.userId, ctx.eventName);
  if (!rateCheck.ok) return rateCheck;

  return { ok: true };
}

/**
 * 仅速率限制入口（用于 handleBattleJoin）。
 *
 * 设计原因：
 *   - join 之前用户本来就不在 battle room，room 检查会失败 → 跳过
 *   - join 只允许 status='pending'，由 getPendingBattleForJoin 吸收 → 跳过 status 检查
 *   - 唯一需要的是防止 join 攻击（同一 user 疯狂 join 触发 DB 查询 + 房间广播）
 *
 * @param userId 用户 ID
 * @param eventName 事件名（'battle:join'）
 * @returns 校验结果
 */
export async function validateJoinContext(
  userId: string,
  eventName: string
): Promise<ValidationResult> {
  return checkRateLimit(userId, eventName);
}