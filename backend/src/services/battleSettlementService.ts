// ========================================
// T054 对战结算服务
// ========================================
// 提供对战结算：
//   - settleBattle: 玩家触发结算入口（任一方调用即可）
//     1. 加载 battle + JOIN 拿双方 user_id
//     2. 鉴权（参与者）
//     3. 状态校验（status='finished'）
//     4. 幂等检测（battles.settled_at 非空 → 跳过写入）
//     5. 首次结算：withTransaction 内 UPDATE 双方 wins/losses/draws + INSERT 双 pbh + UPDATE battles.settled_at
//     6. 读双方最新 stats
//     7. 清理 Redis battle:{id}:* (best-effort)
//     8. 构造响应（含 yourResult = 从调用者视角推断 win/loss/draw）
//
// 数据存储：
//   - DB: players.wins/losses/draws (migration 010), player_battle_history (migration 010), battles.settled_at (migration 010)
//   - Redis: battle:{id}:* 全删
//
// 调用方:
//   - POST /api/battle/result 路由（T054）
//
// 范围外:
//   - 资源发放（金币/经验/制造点）— 后续任务
//   - Rating / 段位 — 后续任务
//   - 战报回放 — 后续任务
//   - 5v5 / NvN 通用（T054 沿用 T052 3v3 假设）
//   - Redis SCAN 优化（KEYS 够用，MVP 不上）

import {
  query,
  queryOne,
  withTransaction,
} from '../config/database';
import type { PoolClient } from 'pg';
import { redisClient } from '../config/redis';

// ========================================
// 常量
// ========================================

/**
 * Redis key 匹配模式（清理全部 battle 临时态）
 */
const REDIS_BATTLE_KEY_PATTERN = (battleId: string): string => `battle:${battleId}:*`;

// ========================================
// 类型
// ========================================

export type Side = 'p1' | 'p2';
export type PlayerResult = 'win' | 'loss' | 'draw';
export type VictoryType = 'kill_threshold' | 'base_threshold' | 'draw' | 'surrender';

export interface PlayerStats {
  wins: number;
  losses: number;
  draws: number;
}

export interface WinnerInfo {
  userId: string;
  side: Side;
}

export interface SettlementResponse {
  battleId: string;
  status: 'finished';
  yourResult: PlayerResult;
  winner: WinnerInfo | null;
  victoryType: VictoryType;
  p1Stars: number;
  p2Stars: number;
  p1UserId: string;
  p2UserId: string;
  duration: number;
  startedAt: string;
  finishedAt: string;
  yourStats: PlayerStats;
  opponentStats: PlayerStats;
}

export type SettleResult =
  | { ok: true; data: SettlementResponse }
  | { ok: false; error: 'battle_not_found' | 'not_participant' | 'battle_not_finished' };

// ========================================
// 内部类型
// ========================================

interface BattleForSettlement {
  battleId: string;
  status: string;
  matchedAt: Date | null;
  finishedAt: Date | null;
  settledAt: Date | null;
  p1Stars: number;
  p2Stars: number;
  winnerPlayerId: string | null;
  victoryType: VictoryType | null;
  p1PlayerId: string;
  p2PlayerId: string;
  p1UserId: string;
  p2UserId: string;
}

// ========================================
// 公共函数
// ========================================

/**
 * T054: 结算一场已结束的对战。
 *
 * 任一方玩家调用即可，不需要双方都调。
 * 幂等：第二次调用跳过玩家数据写入，只返回已存数据。
 *
 * @param battleId battle id
 * @param userId 调用者 user id
 * @returns SettleResult
 */
export async function settleBattle(
  battleId: string,
  userId: string
): Promise<SettleResult> {
  // 1. 加载 battle 行 + 双方 user_id（单次 JOIN）
  const battle = await loadBattleForSettlement(battleId);
  if (!battle) {
    return { ok: false, error: 'battle_not_found' };
  }

  // 2. 鉴权
  if (battle.p1UserId !== userId && battle.p2UserId !== userId) {
    return { ok: false, error: 'not_participant' };
  }
  if (battle.status !== 'finished') {
    return { ok: false, error: 'battle_not_finished' };
  }

  // 3. 幂等检测（settled_at 非空 → 跳过写入）
  //    并发竞态防护：读-改-写在事务内用 SELECT ... FOR UPDATE 行锁，
  //    两个并发请求同时到达时第二个会等第一个 COMMIT，读到 settled_at 后跳过。
  const alreadySettled = battle.settledAt !== null;

  // 4. 首次结算：withTransaction 内锁行检查 + 写双方 wins/losses/draws + 双 player_battle_history + battles.settled_at
  if (!alreadySettled) {
    await withTransaction(async (client: PoolClient) => {
      // 行锁 + 幂等复核：防止并发两个请求同时通过 settled_at 检查
      const lockRes = await client.query<{ settled_at: Date | null }>(
        'SELECT settled_at FROM battles WHERE id = $1 FOR UPDATE',
        [battleId]
      );
      if (lockRes.rows.length > 0 && lockRes.rows[0].settled_at !== null) {
        return; // 已被并发请求结算，跳过写入
      }
      await applySettlementInTransaction(client, battle);
    });
  }

  // 5. 读双方最新 stats + 6. 清理 Redis battle:{id}:*（best-effort）— 两者独立,并行执行
  const [yourStats, opponentStats] = await Promise.all([
    loadPlayerStats(yourPlayerId(battle, userId)),
    loadPlayerStats(opponentPlayerId(battle, userId)),
    cleanupAllBattleRedisKeys(battleId),
  ]);

  // 7. 构造响应
  return { ok: true, data: buildResponse(battle, userId, yourStats, opponentStats) };
}

// ========================================
// 内部 helper
// ========================================

/**
 * 加载 battle 行 + 双方 player_id + user_id（单次 JOIN）
 */
async function loadBattleForSettlement(battleId: string): Promise<BattleForSettlement | null> {
  const rows = await query<{
    id: string;
    status: string;
    matched_at: Date | null;
    finished_at: Date | null;
    settled_at: Date | null;
    p1_stars: number | null;
    p2_stars: number | null;
    winner_player_id: string | null;
    victory_type: VictoryType | null;
    player1_id: string;
    player2_id: string;
    p1_user_id: string;
    p2_user_id: string;
  }>(
    `SELECT b.id, b.status, b.matched_at, b.finished_at, b.settled_at,
            b.p1_stars, b.p2_stars, b.winner_player_id, b.victory_type,
            b.player1_id, b.player2_id,
            p1.user_id AS p1_user_id,
            p2.user_id AS p2_user_id
     FROM battles b
     LEFT JOIN players p1 ON p1.id = b.player1_id
     LEFT JOIN players p2 ON p2.id = b.player2_id
     WHERE b.id = $1`,
    [battleId]
  );
  const row = rows[0];
  if (!row) return null;
  if (!row.p1_user_id || !row.p2_user_id) return null;
  return {
    battleId: row.id,
    status: row.status,
    matchedAt: row.matched_at,
    finishedAt: row.finished_at,
    settledAt: row.settled_at,
    p1Stars: row.p1_stars ?? 0,
    p2Stars: row.p2_stars ?? 0,
    winnerPlayerId: row.winner_player_id,
    victoryType: row.victory_type,
    p1PlayerId: row.player1_id,
    p2PlayerId: row.player2_id,
    p1UserId: row.p1_user_id,
    p2UserId: row.p2_user_id,
  };
}

/**
 * 在单连接事务内：4a 更新双方 players.wins/losses/draws、4b 写双 player_battle_history、4c UPDATE battles.settled_at
 */
async function applySettlementInTransaction(
  client: PoolClient,
  battle: BattleForSettlement
): Promise<void> {
  // 4a + 4b. 双方各自 UPDATE 计数 + INSERT pbh 记录
  const sides: ReadonlyArray<{
    playerId: string;
    opponentId: string;
    myStars: number;
    oppStars: number;
    result: PlayerResult;
  }> = [
    {
      playerId: battle.p1PlayerId,
      opponentId: battle.p2PlayerId,
      myStars: battle.p1Stars,
      oppStars: battle.p2Stars,
      result: playerResultFor(battle, battle.p1PlayerId),
    },
    {
      playerId: battle.p2PlayerId,
      opponentId: battle.p1PlayerId,
      myStars: battle.p2Stars,
      oppStars: battle.p1Stars,
      result: playerResultFor(battle, battle.p2PlayerId),
    },
  ];

  for (const side of sides) {
    await updatePlayerCounter(client, side.playerId, side.result);
    await insertBattleHistory(client, battle, side);
  }

  // 4c. UPDATE battles SET settled_at = NOW()
  await client.query(
    `UPDATE battles SET settled_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [battle.battleId]
  );
}

/**
 * UPDATE players SET wins/losses/draws += 1 (按 result)
 */
async function updatePlayerCounter(
  client: PoolClient,
  playerId: string,
  result: PlayerResult
): Promise<void> {
  const column = result === 'win' ? 'wins' : result === 'loss' ? 'losses' : 'draws';
  await client.query(
    `UPDATE players
     SET ${column} = ${column} + 1, updated_at = NOW()
     WHERE id = $1`,
    [playerId]
  );
}

/**
 * INSERT INTO player_battle_history
 * 平局写 'draw'; 否则沿用 battle.victory_type（'kill_threshold' | 'base_threshold'）。
 */
async function insertBattleHistory(
  client: PoolClient,
  battle: BattleForSettlement,
  side: {
    playerId: string;
    opponentId: string;
    myStars: number;
    oppStars: number;
    result: PlayerResult;
  }
): Promise<void> {
  const victoryType: string =
    side.result === 'draw' ? 'draw' : (battle.victoryType ?? 'kill_threshold');

  await client.query(
    `INSERT INTO player_battle_history
       (player_id, battle_id, result, opponent_player_id, victory_type, my_stars, opponent_stars)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [side.playerId, battle.battleId, side.result, side.opponentId, victoryType, side.myStars, side.oppStars]
  );
}

/**
 * 给定 playerId,判定 win/loss/draw。
 * winnerPlayerId 匹配 → 'win'; 平局 → 'draw'; 否则 'loss'。
 */
function playerResultFor(battle: BattleForSettlement, playerId: string): PlayerResult {
  if (battle.winnerPlayerId === null) return 'draw';
  if (battle.winnerPlayerId === playerId) return 'win';
  return 'loss';
}

/**
 * 读玩家最新 wins/losses/draws（用于响应）
 */
async function loadPlayerStats(playerId: string): Promise<PlayerStats> {
  const row = await queryOne<{ wins: number; losses: number; draws: number }>(
    `SELECT wins, losses, draws FROM players WHERE id = $1`,
    [playerId]
  );
  return {
    wins: row?.wins ?? 0,
    losses: row?.losses ?? 0,
    draws: row?.draws ?? 0,
  };
}

/**
 * 清理 Redis battle:{id}:* 全 key（best-effort）
 * 失败时 console.error，不影响主流程（玩家数据已落库）。
 */
async function cleanupAllBattleRedisKeys(battleId: string): Promise<void> {
  try {
    const keys = await redisClient.keys(REDIS_BATTLE_KEY_PATTERN(battleId));
    if (keys.length > 0) {
      await redisClient.del(keys);
    }
  } catch (err) {
    console.error(
      `[T054] cleanupAllBattleRedisKeys failed: battleId=${battleId}`,
      err
    );
  }
}

/**
 * 推 caller 的 player_id
 */
function yourPlayerId(battle: BattleForSettlement, callerUserId: string): string {
  return battle.p1UserId === callerUserId ? battle.p1PlayerId : battle.p2PlayerId;
}

/**
 * 推 caller 的对手 player_id
 */
function opponentPlayerId(battle: BattleForSettlement, callerUserId: string): string {
  return battle.p1UserId === callerUserId ? battle.p2PlayerId : battle.p1PlayerId;
}

/**
 * 构造 SettlementResponse
 */
function buildResponse(
  battle: BattleForSettlement,
  callerUserId: string,
  yourStats: PlayerStats,
  opponentStats: PlayerStats
): SettlementResponse {
  // 1. yourResult（从 caller 视角）
  const yourPlayer = yourPlayerId(battle, callerUserId);
  const yourResult = playerResultFor(battle, yourPlayer);

  // 2. winner（null 表示平局）
  let winner: WinnerInfo | null = null;
  if (battle.winnerPlayerId !== null) {
    const winnerSide: Side =
      battle.winnerPlayerId === battle.p1PlayerId ? 'p1' : 'p2';
    const winnerUserId =
      winnerSide === 'p1' ? battle.p1UserId : battle.p2UserId;
    winner = { userId: winnerUserId, side: winnerSide };
  }

  // 3. victoryType（保证非 null；平局时为 'draw'）
  const victoryType: VictoryType =
    battle.victoryType ?? (battle.winnerPlayerId === null ? 'draw' : 'kill_threshold');

  // 4. duration（秒，从 matched_at 到 finished_at）
  const matchedAt = battle.matchedAt ?? battle.finishedAt ?? new Date(0);
  const finishedAt = battle.finishedAt ?? new Date(0);
  const durationSec = Math.max(
    0,
    Math.floor((finishedAt.getTime() - matchedAt.getTime()) / 1000)
  );

  return {
    battleId: battle.battleId,
    status: 'finished',
    yourResult,
    winner,
    victoryType,
    p1Stars: battle.p1Stars,
    p2Stars: battle.p2Stars,
    p1UserId: battle.p1UserId,
    p2UserId: battle.p2UserId,
    duration: durationSec,
    startedAt: matchedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    yourStats,
    opponentStats,
  };
}
