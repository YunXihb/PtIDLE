/**
 * T048 战场初始化 Orchestrator（T1012 扩展为布置阶段两段式）
 *
 * 【T1012 流程】
 *   initDeployment（双方 join 完成 -> 布置阶段 120s）
 *     1. initializeBoard
 *     2. createDeployment（Redis 部署状态 + battles.current_phase='deployment'）
 *     3. broadcastDeploymentState × 2（battle:deploy_state）
 *   startBattle（双方确认或超时 finalize 后）
 *     1. finalizeDeployment（幂等）+ persistDeckSnapshots（对局卡组快照）
 *     2. initBattleField(io, battleId, deployedPieces)（下方原有步骤 2-7，
 *        棋子按布置配置放置，初始手牌从快照抽）
 *     3. cleanupDeployment
 *
 * initBattleField 保留无参调用（deployedPieces 缺省 = 旧默认位置/默认卡组），
 * 供旧链路与测试使用。
 */

import type { Server as IOServer } from 'socket.io';
import * as battleService from './battleService';
import * as handService from './handService';
import * as battleSessionService from './battleSessionService';
import { execute, query, queryOne } from '../config/database';
import { redisClient } from '../config/redis';
import { broadcastFullState, broadcastDeploymentState } from '../socket/battleStateBroadcaster';
import { activateActorForStep } from './battleActionService';
import { redisKey } from '../utils/redisKeys';
import {
  createDeployment,
  finalizeDeployment,
  persistDeckSnapshots,
  cleanupDeployment,
  FinalizedDeployment,
} from './deploymentService';

// ─── 公共类型 ──────────────────────────────────────────────
export type InitResult =
  | { success: true; startedAt: Date; actorId: string }
  | { success: false; failedStep: number; error: string };

interface CharacterRow {
  id: string;
  player_id: string;
  user_id: string;       // JOIN users 拿到的字段，用于 broadcastFullState
  name: string;
  profession: string;
  health: number;
  max_health: number;
  movement: number;
  energy: number;
  max_energy: number;
  is_alive: boolean;
}

// ─── 3v3 默认位置常量（硬编码）──────────────────────────
const DEFAULT_P1_POSITIONS_3V3: Array<{ x: number; y: number }> = [
  { x: 6, y: 0 }, { x: 7, y: 0 }, { x: 8, y: 0 },
];
const DEFAULT_P2_POSITIONS_3V3: Array<{ x: number; y: number }> = [
  { x: 0, y: 8 }, { x: 1, y: 8 }, { x: 2, y: 8 },
];

// ─── 主入口 ────────────────────────────────────────────────

/**
 * initBattleField（T1012 起支持布置配置）
 * @param deployedPieces 布置 finalize 结果；缺省 = 旧默认位置 + 默认卡组（快照不存在时 drawCards 回落 character_deck）
 */
export async function initBattleField(
  io: IOServer,
  battleId: string,
  deployedPieces?: FinalizedDeployment
): Promise<InitResult> {
  let lastStep = 0;

  try {
    // ── 步骤 1: 棋盘初始化 ─────────────────────────────────
    lastStep = 1;
    await battleService.initializeBoard(battleId);

    // ── 步骤 2: 6 个棋子放置（布置配置或默认位置） ─────────
    lastStep = 2;
    const { p1Chars, p2Chars } = await loadBattleCharacters(battleId, deployedPieces);
    if (p1Chars.length < 3 || p2Chars.length < 3) {
      return {
        success: false,
        failedStep: 2,
        error: `Insufficient characters: p1=${p1Chars.length}, p2=${p2Chars.length}`,
      };
    }
    const p1Positions = positionList(deployedPieces?.p1.pieces, p1Chars, DEFAULT_P1_POSITIONS_3V3);
    const p2Positions = positionList(deployedPieces?.p2.pieces, p2Chars, DEFAULT_P2_POSITIONS_3V3);
    for (let i = 0; i < 3; i++) {
      await battleService.placeCharacter(battleId, p1Chars[i].id, p1Positions[i].x, p1Positions[i].y);
      await battleService.placeCharacter(battleId, p2Chars[i].id, p2Positions[i].x, p2Positions[i].y);
    }

    // ── 步骤 3: 设置初始能量（满能量 3 点） ────────────────
    lastStep = 3;
    for (const c of [...p1Chars, ...p2Chars]) {
      await battleService.setCharacterEnergy(battleId, c.id, 3);
    }

    // ── 步骤 4: 6 个棋子各抽 3 张初始手牌 ─────────────────
    lastStep = 4;
    for (const c of [...p1Chars, ...p2Chars]) {
      await handService.drawCards(battleId, c.id, 3);
    }

    // ── 步骤 5: 初始化状态机（蛇形顺序） ──────────────────
    lastStep = 5;
    const p1Ids = p1Chars.map(c => c.id);
    const p2Ids = p2Chars.map(c => c.id);
    await battleSessionService.initializeSession(battleId, p1Ids, p2Ids);

    // ── 步骤 5.5: ★ T052: 初始化胜利进度相关键 ────────────
    await redisClient.set(redisKey.stars(battleId, 'p1'), '0');
    await redisClient.set(redisKey.stars(battleId, 'p2'), '0');
    await redisClient.set(redisKey.alive(battleId, 'p1'), '3');
    await redisClient.set(redisKey.alive(battleId, 'p2'), '3');
    await redisClient.set(
      redisKey.bases(battleId),
      JSON.stringify({ '2,2': 'neutral', '6,6': 'neutral' })
    );

    // ── 步骤 6: 持久化 battles 行（pending → ongoing） ──────
    lastStep = 6;
    const order = battleSessionService.buildSnakeOrder(p1Ids, p2Ids);
    const startedAt = new Date();
    // ★ T-FIX(开局卡死): execute() 返回受影响行数。query() 只返回 rows 数组，
    //   rowCount 恒为 undefined -> 旧检查恒判"未更新" -> init 在此提前 return，
    //   步骤 6.5 永不执行，对局卡在 ongoing + idle。
    const updatedCount = await execute(
      `UPDATE battles
       SET status='ongoing', started_at=$1, current_actor_id=$2,
           current_phase='idle', current_round=1, current_step=0,
           updated_at=NOW()
       WHERE id=$3 AND status='pending'`,
      [startedAt, order[0], battleId]
    );
    if (updatedCount !== 1) {
      return { success: false, failedStep: 6, error: 'battle_row_not_updated' };
    }

    // ── 步骤 6.5: ★ T-FIX(战棋死锁): 激活首 actor (idle -> draw -> move) ──
    //    init 结束时 phase 必须离开 idle，否则战斗永远卡在「第1回合 步骤0 待机」
    //    （activateCurrentUnit 唯一的其他调用点 executeEndStep 要求入口 phase 为 move/play）
    //    不抽牌：步骤 4 已给 6 个棋子各发 3 张初始手牌，drawCards 是覆盖式写
    lastStep = 7;
    await activateActorForStep(io, battleId);

    // ── 步骤 7: 广播全量状态给双端 ─────────────────────────
    lastStep = 7;
    try {
      await broadcastFullState(io, battleId, p1Chars[0].user_id);
      await broadcastFullState(io, battleId, p2Chars[0].user_id);
    } catch (broadcastErr) {
      console.error(`[initBattleField:${battleId}] broadcast failed:`, broadcastErr);
    }

    return { success: true, startedAt, actorId: order[0] };

  } catch (err) {
    await cleanupPartialInit(battleId, lastStep).catch(cleanupErr => {
      console.error(`[initBattleField:${battleId}] cleanup also failed:`, cleanupErr);
    });
    return { success: false, failedStep: lastStep, error: (err as Error).message };
  }
}

// ─── 反向清理 ──────────────────────────────────────────────
export async function cleanupPartialInit(battleId: string, lastSuccessfulStep: number): Promise<void> {
  try {
    // 步骤 6+ 失败 → 回滚 battles 行
    if (lastSuccessfulStep >= 6) {
      await query(
        `UPDATE battles SET status='pending', started_at=NULL,
             current_actor_id=NULL, current_phase=NULL,
             current_round=1, current_step=0
         WHERE id=$1 AND status='ongoing'`,
        [battleId]
      );
    }

    // 步骤 5+ 失败 → DEL session
    if (lastSuccessfulStep >= 5) {
      await redisClient.del(redisKey.session(battleId));
      // ★ T052: 同时 DEL 胜利进度相关键
      await redisClient.del(redisKey.stars(battleId, 'p1'));
      await redisClient.del(redisKey.stars(battleId, 'p2'));
      await redisClient.del(redisKey.alive(battleId, 'p1'));
      await redisClient.del(redisKey.alive(battleId, 'p2'));
      await redisClient.del(redisKey.bases(battleId));
    }

    // 步骤 4+ 失败 → DEL 6 个 hand/retained/discard
    if (lastSuccessfulStep >= 4) {
      const { p1Chars, p2Chars } = await loadBattleCharacters(battleId).catch(() => ({
        p1Chars: [] as CharacterRow[],
        p2Chars: [] as CharacterRow[],
      }));
      for (const c of [...p1Chars, ...p2Chars]) {
        await redisClient.del(redisKey.hand(battleId, c.id));
        await redisClient.del(redisKey.retained(battleId, c.id));
        await redisClient.del(redisKey.discard(battleId, c.id));
      }
    }

    // 步骤 2+ 失败 → DEL pieces + positions
    if (lastSuccessfulStep >= 2) {
      await redisClient.del(redisKey.pieces(battleId));
      await redisClient.del(redisKey.positions(battleId));
    } else if (lastSuccessfulStep === 1) {
      // 步骤 1 失败 → 仅 positions 初始化但为空
      await redisClient.del(redisKey.positions(battleId));
    }
  } catch (err) {
    console.error(`[cleanupPartialInit:${battleId}] cleanup error:`, err);
    // 不 rethrow，best-effort
  }
}

// ─── 内部辅助：取前 3 个 alive 棋子 + 绑定 battle_id ──────
async function loadBattleCharacters(
  battleId: string,
  deployedPieces?: FinalizedDeployment
): Promise<{
  p1Chars: CharacterRow[];
  p2Chars: CharacterRow[];
}> {
  const battleRow = await queryOne<{ player1_id: string; player2_id: string }>(
    `SELECT player1_id, player2_id FROM battles WHERE id=$1`,
    [battleId]
  );
  if (!battleRow) {
    throw new Error(`Battle ${battleId} not found`);
  }

  // T1012: 有布置配置 -> 按配置的 characterId 顺序取棋子（玩家选子+出场顺序）
  const p1Ids = deployedPieces?.p1.pieces.map(p => p.characterId);
  const p2Ids = deployedPieces?.p2.pieces.map(p => p.characterId);

  const p1Chars = await loadSideCharacters(battleRow.player1_id, p1Ids);
  const p2Chars = await loadSideCharacters(battleRow.player2_id, p2Ids);
  // 绑定 battle_id（步骤 6 之前完成）
  const allIds = [...p1Chars, ...p2Chars].map(c => c.id);
  if (allIds.length > 0) {
    await query(
      `UPDATE characters SET battle_id=$1 WHERE id = ANY($2::uuid[])`,
      [battleId, allIds]
    );
  }
  return { p1Chars, p2Chars };
}

/**
 * 取一侧出战棋子
 * - ids 给定（布置配置）：按 id 批量取 alive 棋子，结果**按配置顺序**排列
 * - ids 缺省（旧流程）：前 3 个 alive（created_at ASC）
 */
async function loadSideCharacters(
  playerId: string,
  ids?: string[]
): Promise<CharacterRow[]> {
  if (!ids) {
    return query<CharacterRow>(
      `SELECT c.id, c.player_id, u.id AS user_id, c.name, c.profession,
              c.health, c.max_health, c.movement, c.energy, c.max_energy, c.is_alive
       FROM characters c
       JOIN players p ON p.id = c.player_id
       JOIN users u ON u.id = p.user_id
       WHERE c.player_id=$1 AND c.is_alive=TRUE
       ORDER BY c.created_at ASC LIMIT 3`,
      [playerId]
    );
  }
  const rows = await query<CharacterRow>(
    `SELECT c.id, c.player_id, u.id AS user_id, c.name, c.profession,
            c.health, c.max_health, c.movement, c.energy, c.max_energy, c.is_alive
     FROM characters c
     JOIN players p ON p.id = c.player_id
     JOIN users u ON u.id = p.user_id
     WHERE c.player_id=$1 AND c.is_alive=TRUE AND c.id = ANY($2::uuid[])`,
    [playerId, ids]
  );
  // 按配置顺序排列（查询不保序）
  const byId = new Map(rows.map(c => [c.id, c]));
  return ids.map(id => byId.get(id)).filter((c): c is CharacterRow => c !== undefined);
}

/**
 * 摆位列表：布置配置存在 -> 用配置位置；否则默认位置
 * （配置 pieces 与 pChars 等长同序，均由 loadBattleCharacters 按配置产出）
 */
function positionList(
  pieces: FinalizedDeployment['p1']['pieces'] | undefined,
  chars: CharacterRow[],
  defaults: Array<{ x: number; y: number }>
): Array<{ x: number; y: number }> {
  if (!pieces || pieces.length !== chars.length) {
    return defaults;
  }
  return chars.map((c, i) => {
    const piece = pieces.find(p => p.characterId === c.id);
    return piece ? { x: piece.x, y: piece.y } : defaults[i];
  });
}

// ─── T1012: 布置阶段入口 ───────────────────────────────────

/**
 * 进入布置阶段（tryInitBattleField 在双方 join 后调用，替代直接 initBattleField）
 * - status 须为 pending；createDeployment 幂等
 * - 广播 battle:deploy_state 给双方（各自视角，对手细节隐藏）
 */
export async function initDeployment(
  io: IOServer,
  battleId: string
): Promise<{ success: boolean; error?: string }> {
  // 步骤 1: 棋盘初始化（清旧数据，与旧流程步骤 1 一致）
  await battleService.initializeBoard(battleId);

  // 步骤 2: 创建部署状态（120s 时限；幂等）
  const r = await createDeployment(battleId);
  if (!r.success) {
    return { success: false, error: r.error };
  }

  // 步骤 3: 广播部署状态给双方
  await broadcastDeploymentState(io, battleId);

  return { success: true };
}

/**
 * 布置终结后正式开战（双方确认或 120s 超时触发；幂等）
 * - finalizeDeployment -> persistDeckSnapshots -> initBattleField(deployedPieces)
 * - 成功后清理布置 Redis 状态
 * @returns InitResult 与旧 initBattleField 相同
 */
export async function startBattle(
  io: IOServer,
  battleId: string
): Promise<InitResult> {
  // 0. finalize（幂等：双方确认 / sweeper 超时并发触发只算一次）
  const fin = await finalizeDeployment(battleId);
  if (!fin.success || !fin.finalized) {
    return { success: false, failedStep: 0, error: `finalize: ${fin.error ?? 'unknown'}` };
  }

  // 0.5 卡组快照落 Redis（必须在 initBattleField 步骤 4 抽牌之前）
  await persistDeckSnapshots(battleId, fin.finalized);

  // 1. 原有初始化流程（步骤 1-7，棋子按布置配置放置）
  const result = await initBattleField(io, battleId, fin.finalized);
  if (!result.success) {
    return result;
  }

  // 2. 清理布置状态（finalize 结果已审计落 battles.battle_data）
  await cleanupDeployment(battleId);

  return result;
}
