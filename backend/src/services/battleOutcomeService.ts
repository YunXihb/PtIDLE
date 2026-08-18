// ========================================
// T052 胜负判定服务
// ========================================
// 提供对战胜利判定：
//   - applyKillStars: 捕获本步新增死亡 → 给击杀方 +1 star
//   - applyBaseStars: 扫描 2 个据点 → 占领方 +1 star
//   - checkWinCondition: 判定 win/draw/not_over
//   - recordVictory: 持久化 winner + finishSession + 广播 battle:end
//
// 数据存储：
//   - Redis: battle:{id}:stars:p1/p2 (STRING), battle:{id}:bases (STRING JSON), battle:{id}:alive_p1/p2 (STRING)
//   - DB: battles.p1_stars, p2_stars, winner_player_id, victory_type (migration 009)
//
// 调用方:
//   - T051 executeEndStep: 调 applyKillStars + checkWinCondition + recordVictory
//   - T051 executeRoundEnd: 调 applyBaseStars + checkWinCondition + recordVictory
//
// 范围外:
//   - 卡牌消耗: T053
//   - 战斗结算 API: T054
//   - 伤害权威化: T056

import type { Server as IOServer } from 'socket.io';
import { query, queryOne, execute } from '../config/database';
import { redisClient } from '../config/redis';
import { listCharactersInBattle } from './battleService';
import { finishSession } from './battleSessionService';
import { broadcastBattleEnd } from '../socket/battleStateBroadcaster';
import { redisKey } from '../utils/redisKeys';
// 注：query/execute/redisClient/listCharactersInBattle/finishSession 将在 Task 3-6 实现中使用，
//      骨架阶段先 import 占位，避免后续任务频繁改动 import 段。

// ========================================
// 常量
// ========================================

/**
 * 棋盘上的固定据点（3v3 模式，9x9 棋盘对角线，关于中心 (4,4) 对称）
 */
export const BASES: ReadonlyArray<{ x: number; y: number; key: string }> = [
  { x: 2, y: 2, key: '2,2' },
  { x: 6, y: 6, key: '6,6' },
] as const;

/**
 * 据点占领范围半径（Chebyshev 距离 ≤ BASE_RADIUS，等价 5x5 正方形）
 */
export const BASE_RADIUS = 2;

/**
 * 胜利阈值（达到即获胜）
 */
export const WIN_THRESHOLD = 6;

// ========================================
// 类型
// ========================================

export type Side = 'p1' | 'p2';
export type BaseOwner = Side | 'neutral';
export type VictoryType = 'kill_threshold' | 'base_threshold' | 'draw' | 'surrender';
/**
 * 胜利进度来源类型（用于区分击杀加星 vs 据点加星）
 * T052 范围：仅作类型导出；Task 3-4 的 applyKillStars / applyBaseStars 在内部使用
 * 未来扩展：可用于胜负事件 telemetry、replay 回放等
 */
export type StarSource = 'kill' | 'base';
/**
 * recordVictory 的胜负来源（映射 victory_type）
 * 'surrender': 玩家退出对战判负（battleInteractionService 使用）
 */
export type VictorySource = StarSource | 'surrender' | 'draw';

export type BasesState = Record<string, BaseOwner>;

export interface KillStarDelta {
  p1Delta: number; // 本步 p1 stars 增量（p1 击杀对方 N 棋 → +N）
  p2Delta: number; // 本步 p2 stars 增量（p2 击杀对方 N 棋 → +N）
  p1StarsAfter: number;
  p2StarsAfter: number;
}

export interface BaseStarDelta {
  p1Delta: number;
  p2Delta: number;
  p1StarsAfter: number;
  p2StarsAfter: number;
  bases: BasesState;
}

export type WinCheckResult =
  | { status: 'win'; winnerSide: Side; p1Stars: number; p2Stars: number }
  | { status: 'draw'; p1Stars: number; p2Stars: number }
  | { status: 'not_over'; p1Stars: number; p2Stars: number };

export type RecordVictoryOutcome = Extract<WinCheckResult, { status: 'win' | 'draw' }>;

// ========================================
// Redis key 辅助
// ========================================

function starsKey(battleId: string, side: Side): string {
  return redisKey.stars(battleId, side);
}

function aliveKey(battleId: string, side: Side): string {
  return redisKey.alive(battleId, side);
}

function basesKey(battleId: string): string {
  return redisKey.bases(battleId);
}

function piecesKey(battleId: string): string {
  return redisKey.pieces(battleId);
}

function positionsKey(battleId: string): string {
  return redisKey.positions(battleId);
}

/**
 * 加载 battle 双方 player_id，用于把「角色 player_id(UUID)」映射到 side(p1/p2)。
 * 单次查询，applyKillStars / applyBaseStars 共用。
 */
async function loadBattleSides(battleId: string): Promise<{
  p1PlayerId: string | null;
  p2PlayerId: string | null;
}> {
  try {
    const row = await queryOne<{ player1_id: string; player2_id: string }>(
      `SELECT player1_id, player2_id FROM battles WHERE id = $1`,
      [battleId]
    );
    if (!row) {
      return { p1PlayerId: null, p2PlayerId: null };
    }
    return { p1PlayerId: row.player1_id, p2PlayerId: row.player2_id };
  } catch (err) {
    // 降级：无法读取 sides 时返回 null，sideForPlayerId 会回退到字面量判断
    console.error(`[battleOutcome] loadBattleSides failed: battleId=${battleId}`, err);
    return { p1PlayerId: null, p2PlayerId: null };
  }
}

/**
 * 把角色 playerId 判定为 p1/p2。
 * - 先按字面量 'p1'/'p2' 匹配（兼容测试/简化数据）
 * - 再按 DB 双方 player_id (UUID) 匹配（生产真实路径）
 * - 都不命中 → null（异常数据）
 */
function sideForPlayerId(
  playerId: string,
  sides: { p1PlayerId: string | null; p2PlayerId: string | null }
): Side | null {
  if (playerId === 'p1' || playerId === 'p2') {
    return playerId as Side;
  }
  if (sides.p1PlayerId !== null && playerId === sides.p1PlayerId) return 'p1';
  if (sides.p2PlayerId !== null && playerId === sides.p2PlayerId) return 'p2';
  return null;
}

/**
 * 从 positions HASH 反查某角色坐标。
 * positions HASH 结构：key = "x,y"（棋盘格），value = characterId。
 * 因此按 characterId 找 key，需遍历 entries。
 */
async function getPositionByCharacterId(
  battleId: string,
  characterId: string
): Promise<{ x: number; y: number } | null> {
  const positionsRaw = await redisClient.hGetAll(positionsKey(battleId));
  for (const [posKey, charId] of Object.entries(positionsRaw)) {
    if (charId === characterId) {
      const [xStr, yStr] = posKey.split(',');
      const x = parseInt(xStr, 10);
      const y = parseInt(yStr, 10);
      if (Number.isInteger(x) && Number.isInteger(y)) {
        return { x, y };
      }
    }
  }
  return null;
}

// ========================================
// 公共函数（Task 3-6 逐步实现）
// ========================================

/**
 * T052 §3.1: 应用击杀 star
 *
 * 对比「调用前 is_alive 快照」与「当前 pieces HASH」，捕获本步新增死亡数，
 * 给击杀方 +1 star/次。
 *
 * 流程：
 *   1. listCharactersInBattle 拿全部 6 角色
 *   2. hGetAll pieces HASH 拿当前 is_alive
 *   3. 比对 preStepAliveMap vs 当前 → 找出本步新增死亡 (pre=true AND cur=false)
 *   4. 按 player_id 分组：p1 死 → p2 +1; p2 死 → p1 +1
 *   5. persistStars 写回 Redis + DB
 *   6. decrementAlive 更新 alive 计数
 *
 * @param battleId battle id
 * @param preStepAliveMap 调用方快照（characterId → is_alive）
 * @returns { p1Delta, p2Delta, p1StarsAfter, p2StarsAfter }
 */
export async function applyKillStars(
  battleId: string,
  preStepAliveMap: Record<string, boolean>
): Promise<KillStarDelta> {
  // 1. 拿所有角色
  const characters = await listCharactersInBattle(battleId);
  if (characters.length === 0) {
    return { p1Delta: 0, p2Delta: 0, p1StarsAfter: 0, p2StarsAfter: 0 };
  }

  // 1.5 加载双方 player_id → 用于 playerId(UUID) → side(p1/p2) 映射
  const sides = await loadBattleSides(battleId);

  // 2. 读当前 pieces
  const piecesRaw = await redisClient.hGetAll(piecesKey(battleId));

  // 3. 找本步新增死亡
  let p1Killed = 0; // p1 棋子死亡数（p2 击杀敌数）
  let p2Killed = 0; // p2 棋子死亡数（p1 击杀敌数）
  for (const c of characters) {
    const wasAlive = preStepAliveMap[c.characterId] === true;
    const curRaw = piecesRaw[c.characterId];
    if (!curRaw) continue;
    const cur = JSON.parse(curRaw);
    const isAliveNow = cur.is_alive === true;
    if (wasAlive && !isAliveNow) {
      const side = sideForPlayerId(c.playerId, sides);
      if (side === 'p1') p1Killed++;
      else if (side === 'p2') p2Killed++;
    }
  }

  // 4-5. 累加 star + 同步 DB
  let p1StarsAfter = 0;
  let p2StarsAfter = 0;
  if (p2Killed > 0) {
    const r = await persistStars(battleId, 'p1', p2Killed);
    p1StarsAfter = r.newStars;
    await decrementAlive(battleId, 'p2');
  }
  if (p1Killed > 0) {
    const r = await persistStars(battleId, 'p2', p1Killed);
    p2StarsAfter = r.newStars;
    await decrementAlive(battleId, 'p1');
  }

  // 读其他方 stars (若无累加)
  if (p2Killed === 0) {
    const v = await redisClient.get(starsKey(battleId, 'p1'));
    p1StarsAfter = v === null ? 0 : parseInt(v, 10);
  }
  if (p1Killed === 0) {
    const v = await redisClient.get(starsKey(battleId, 'p2'));
    p2StarsAfter = v === null ? 0 : parseInt(v, 10);
  }

  return {
    p1Delta: p2Killed,
    p2Delta: p1Killed,
    p1StarsAfter,
    p2StarsAfter,
  };
}

/**
 * T052 §3.1: 应用据点 star
 *
 * 扫描 2 个固定据点 (2,2) 和 (6,6)，按 Chebyshev 距离 ≤2 范围
 * 内的 alive 棋子数判定占领方。占领方 +1 star。
 *
 * 流程：
 *   1. listCharactersInBattle 拿全部 6 角色
 *   2. hGetAll pieces 拿 is_alive + hGetAll positions 拿坐标
 *   3. 对每个据点：
 *      - 统计范围内 p1 alive, p2 alive
 *      - p1 > p2 → 'p1'; p1 < p2 → 'p2'; p1 == p2 → 'neutral'
 *   4. 累加 star（每占领 1 个 +1）
 *   5. SET bases JSON
 *   6. broadcastBasesState（由调用方负责，本函数只返 bases 状态）
 *
 * @param battleId battle id
 * @returns { p1Delta, p2Delta, p1StarsAfter, p2StarsAfter, bases }
 */
export async function applyBaseStars(battleId: string): Promise<BaseStarDelta> {
  // 1. 拿角色
  const characters = await listCharactersInBattle(battleId);
  if (characters.length === 0) {
    return {
      p1Delta: 0,
      p2Delta: 0,
      p1StarsAfter: 0,
      p2StarsAfter: 0,
      bases: { '2,2': 'neutral', '6,6': 'neutral' },
    };
  }

  // 1.5 加载双方 player_id → 用于 playerId(UUID) → side(p1/p2) 映射
  const sides = await loadBattleSides(battleId);

  // 2. 读 pieces（is_alive）
  const piecesRaw = await redisClient.hGetAll(piecesKey(battleId));

  // 3. 判定每个据点
  const bases: BasesState = {};
  let p1Delta = 0;
  let p2Delta = 0;

  for (const base of BASES) {
    let p1InRange = 0;
    let p2InRange = 0;
    for (const c of characters) {
      const pieceRaw = piecesRaw[c.characterId];
      if (!pieceRaw) continue;
      const piece = JSON.parse(pieceRaw);
      if (piece.is_alive !== true) continue;
      const pos = await getPositionByCharacterId(battleId, c.characterId);
      if (!pos) continue;
      // Chebyshev 距离
      const cheb = Math.max(Math.abs(pos.x - base.x), Math.abs(pos.y - base.y));
      if (cheb > BASE_RADIUS) continue;
      const side = sideForPlayerId(c.playerId, sides);
      if (side === 'p1') p1InRange++;
      else if (side === 'p2') p2InRange++;
    }
    if (p1InRange > p2InRange) {
      bases[base.key] = 'p1';
      p1Delta++;
    } else if (p2InRange > p1InRange) {
      bases[base.key] = 'p2';
      p2Delta++;
    } else {
      bases[base.key] = 'neutral';
    }
  }

  // 4. 累加 star
  let p1StarsAfter = 0;
  let p2StarsAfter = 0;
  if (p1Delta > 0) {
    const r = await persistStars(battleId, 'p1', p1Delta);
    p1StarsAfter = r.newStars;
  } else {
    const v = await redisClient.get(starsKey(battleId, 'p1'));
    p1StarsAfter = v === null ? 0 : parseInt(v, 10);
  }
  if (p2Delta > 0) {
    const r = await persistStars(battleId, 'p2', p2Delta);
    p2StarsAfter = r.newStars;
  } else {
    const v = await redisClient.get(starsKey(battleId, 'p2'));
    p2StarsAfter = v === null ? 0 : parseInt(v, 10);
  }

  // 5. SET bases JSON
  await redisClient.set(basesKey(battleId), JSON.stringify(bases));

  return { p1Delta, p2Delta, p1StarsAfter, p2StarsAfter, bases };
}

/**
 * T052 §3.1: 检查胜利条件
 *
 * 读取 stars:p1/p2，判定 win/draw/not_over。
 * victoryType 由调用方根据上下文（kill or base）推断。
 *
 * @param battleId battle id
 * @returns WinCheckResult
 */
export async function checkWinCondition(battleId: string): Promise<WinCheckResult> {
  const [p1Raw, p2Raw] = await Promise.all([
    redisClient.get(starsKey(battleId, 'p1')),
    redisClient.get(starsKey(battleId, 'p2')),
  ]);
  const p1Stars = p1Raw === null ? 0 : parseInt(p1Raw, 10);
  const p2Stars = p2Raw === null ? 0 : parseInt(p2Raw, 10);

  const p1Wins = p1Stars >= WIN_THRESHOLD;
  const p2Wins = p2Stars >= WIN_THRESHOLD;
  if (p1Wins && p2Wins) {
    return { status: 'draw', p1Stars, p2Stars };
  }
  if (p1Wins) {
    return { status: 'win', winnerSide: 'p1', p1Stars, p2Stars };
  }
  if (p2Wins) {
    return { status: 'win', winnerSide: 'p2', p1Stars, p2Stars };
  }
  return { status: 'not_over', p1Stars, p2Stars };
}

/**
 * T052 §3.1: 记录胜利
 *
 * 1. 单次 JOIN 查询拿 player1_id / player2_id / p1_user_id / p2_user_id
 * 2. UPDATE battles SET winner_player_id, victory_type, status='finished', finished_at=NOW()
 * 3. finishSession (best-effort)
 * 4. broadcastBattleEnd (best-effort)
 *
 * @param io IOServer
 * @param battleId
 * @param outcome checkWinCondition 返回的 win/draw
 * @param source 'kill' | 'base' 推断 victoryType（仅 win 时使用）
 */
export async function recordVictory(
  io: IOServer,
  battleId: string,
  outcome: RecordVictoryOutcome,
  source: VictorySource = 'kill'
): Promise<void> {
  // 1. 单次 JOIN 拿双方 playerId + userId
  const playerRows = await query<{
    player1_id: string;
    player2_id: string;
    p1_user_id: string | null;
    p2_user_id: string | null;
  }>(
    `SELECT b.player1_id, b.player2_id,
            p1.user_id AS p1_user_id,
            p2.user_id AS p2_user_id
     FROM battles b
     LEFT JOIN players p1 ON p1.id = b.player1_id
     LEFT JOIN players p2 ON p2.id = b.player2_id
     WHERE b.id = $1`,
    [battleId]
  );
  const row = playerRows[0];
  const p1 = row ? { id: row.player1_id, user_id: row.p1_user_id } : null;
  const p2 = row ? { id: row.player2_id, user_id: row.p2_user_id } : null;

  let winnerUserId: string | null = null;
  let winnerSide: 'p1' | 'p2' | null = null;
  let victoryType: VictoryType;

  if (outcome.status === 'win') {
    winnerSide = outcome.winnerSide;
    winnerUserId = outcome.winnerSide === 'p1' ? p1?.user_id ?? null : p2?.user_id ?? null;
    victoryType =
      source === 'base' ? 'base_threshold'
      : source === 'surrender' ? 'surrender'
      : 'kill_threshold';
  } else {
    victoryType = 'draw';
  }

  // 2. UPDATE battles
  await execute(
    `UPDATE battles
     SET winner_player_id = $1,
         victory_type = $2,
         status = 'finished',
         finished_at = NOW(),
         updated_at = NOW()
     WHERE id = $3`,
    [winnerSide === 'p1' ? p1?.id : (winnerSide === 'p2' ? p2?.id : null), victoryType, battleId]
  );

  // 3. finishSession (best-effort)
  try {
    await finishSession(battleId);
  } catch (err) {
    console.error(`[T052] recordVictory: finishSession failed: battleId=${battleId}`, err);
  }

  // 4. broadcast (best-effort)
  try {
    await broadcastBattleEnd(io, battleId, {
      winnerUserId,
      winnerSide,
      victoryType,
      p1Stars: outcome.p1Stars,
      p2Stars: outcome.p2Stars,
      p1UserId: p1?.user_id ?? null,
      p2UserId: p2?.user_id ?? null,
    });
  } catch (err) {
    console.error(`[T052] recordVictory: broadcastBattleEnd failed: battleId=${battleId}`, err);
  }

  // 5. 清理求和请求 key（所有终局路径的唯一漏斗，best-effort）
  try {
    await redisClient.del(redisKey.drawRequest(battleId));
  } catch {
    // 忽略：key 带战斗前缀，误留无实际影响
  }
}

// ========================================
// 内部 helper（Task 3, 4 使用）
// ========================================

/**
 * 内部：把 stars 累加写回 Redis（INCRBY）+ DB（UPDATE）
 */
async function persistStars(
  battleId: string,
  side: Side,
  incrementBy: number
): Promise<{ newStars: number }> {
  const newStars = await redisClient.incrBy(starsKey(battleId, side), incrementBy);
  await execute(
    `UPDATE battles SET ${side}_stars = $1, updated_at = NOW() WHERE id = $2`,
    [newStars, battleId]
  );
  return { newStars };
}

/**
 * 内部：把 pN alive 计数 -1
 */
async function decrementAlive(battleId: string, side: Side): Promise<void> {
  await redisClient.decr(aliveKey(battleId, side));
}
