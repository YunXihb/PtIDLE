/**
 * 布置阶段服务 (Deployment Service) -- T1011
 *
 * 双方 auto-join 完成后进入布置阶段（120s，双方并行）：
 * - 选 3 个出战棋子 + 在本方行摆位（P1 限 y=0，P2 限 y=8）+ 每棋子配卡
 * - 可提前「确认完成」锁定；双方均确认或 120s 超时 -> finalizeDeployment
 * - 超时方应用自动配置：出战棋子 = 前 3 个 alive（与旧 initBattleField 同口径），
 *   位置按职业固定（P1 法(0,0)/猎(1,0)/战(2,0)，P2 法(8,8)/猎(7,8)/战(6,8)），
 *   卡组 = character_deck 默认卡组
 * - 已确认方应用玩家配置（对局快照，不修改持久 character_deck）
 *
 * 卡组规则（T1010 设计锁定）：
 * - 同名卡（同 template_no，无模板按 name）≤3 张/棋子
 * - 总张数 ≤12 张/棋子（下限 0：空卡组抽牌走公共池补足，合法策略）
 * - 职业匹配：card_template.profession ∈ {棋子职业, 'common'}（无模板视为 common）
 * - 一张 player_card 实例最多进入一个棋子的卡组（同局内不可重复分配）
 *
 * 状态存储：Redis `battle:{id}:deployment`（JSON）；finalize 结果
 * 追加持久化到 battles.battle_data（审计用）。对手草稿完全不下发。
 *
 * 并发模型：双方并行布置是常态，createDraft/updateDraft/confirm/finalize
 * 均为 load-modify-save，统一经 withWriteLock 串行化（短 TTL 自愈锁），
 * 消除「双方草稿互覆盖」与「confirm 与 finalize 竞态」。
 *
 * result.success 风格（对齐 battleSessionService），业务失败返回 error 字符串。
 */

import { query, queryOne, execute } from '../config/database';
import { redisClient } from '../config/redis';
import { redisKey } from '../utils/redisKeys';
import { getCharacterDeckCards } from './characterService';

// ========================================
// 常量（T1010 设计锁定）
// ========================================

/** 布置阶段时长 */
export const DEPLOYMENT_DURATION_MS = 120 * 1000;

/** 每棋子卡组总张数上限 */
export const DEPLOYMENT_MAX_DECK_SIZE = 12;

/** 每棋子同名卡张数上限 */
export const DEPLOYMENT_MAX_SAME_CARD = 3;

/** 出战棋子数量 */
export const DEPLOYMENT_PIECE_COUNT = 3;

/** 棋盘边长（x 有效范围 0..8） */
export const DEPLOYMENT_BOARD_SIZE = 9;

/** 超时自动放置位置（按职业；ranger=猎人） */
export const AUTO_PLACEMENT: Record<'p1' | 'p2', Record<string, { x: number; y: number }>> = {
  p1: { mage: { x: 0, y: 0 }, ranger: { x: 1, y: 0 }, warrior: { x: 2, y: 0 } },
  p2: { mage: { x: 8, y: 8 }, ranger: { x: 7, y: 8 }, warrior: { x: 6, y: 8 } },
};

/** 写锁参数：TTL 短（操作毫秒级，异常持锁 5s 自愈），抢不到重试 5 次 */
const WRITE_LOCK_TTL_S = 5;
const WRITE_LOCK_RETRY_MS = 50;
const WRITE_LOCK_MAX_ATTEMPTS = 5;

// ========================================
// 类型定义
// ========================================

export type DeploySide = 'p1' | 'p2';

/** 摆位（y 由所属方决定：p1=0 / p2=8，草稿只带 x） */
export interface DeployPlacement {
  characterId: string;
  x: number;
}

/** 玩家布置草稿（客户端全量同步） */
export interface DeployDraft {
  selectedCharacters: string[];           // 恰好 3 个
  placements: DeployPlacement[];          // 恰好 3 个
  decks: Record<string, string[]>;        // characterId -> player_card_id 列表
}

export interface SideDeployment {
  playerId: string;
  confirmed: boolean;
  draft: DeployDraft | null;
}

export interface DeploymentState {
  battleId: string;
  deadline: string; // ISO
  p1: SideDeployment;
  p2: SideDeployment;
  /** finalize 结果（幂等标记；battle 开始后由调用方清理 Redis key） */
  finalized: FinalizedDeployment | null;
}

/** finalize 输出：单棋子完整配置 */
export interface FinalizedPiece {
  characterId: string;
  x: number;
  y: number;
  deckCardIds: string[]; // player_card_id 列表（空数组 = 抽牌走公共池）
}

export interface FinalizedSide {
  pieces: FinalizedPiece[];
}

export interface FinalizedDeployment {
  p1: FinalizedSide;
  p2: FinalizedSide;
}

/** 广播给单端的可视视图（隐藏对手细节） */
export interface DeploymentView {
  phase: 'deployment';
  deadline: string;
  deadlineRemainingMs: number;
  mySide: DeploySide;
  myDraft: DeployDraft | null;
  myConfirmed: boolean;
  opponentConfirmed: boolean;
  finalized: boolean;
}

// ========================================
// 内部辅助
// ========================================

interface BattleContextRow {
  id: string;
  status: string;
  current_phase: string | null;
  player1_id: string;
  player2_id: string;
  p1_user_id: string | null;
  p2_user_id: string | null;
}

/**
 * 读取对局上下文（JOIN 双方 user_id），判定请求方 side
 * 玩家非参与者 / 对局不存在时返回 null
 */
async function loadBattleContext(
  battleId: string,
  userId: string
): Promise<{ row: BattleContextRow; mySide: DeploySide; myPlayerId: string } | null> {
  const row = await queryOne<BattleContextRow>(
    `SELECT b.id, b.status, b.current_phase,
            b.player1_id, b.player2_id,
            p1.user_id AS p1_user_id,
            p2.user_id AS p2_user_id
     FROM battles b
     LEFT JOIN players p1 ON p1.id = b.player1_id
     LEFT JOIN players p2 ON p2.id = b.player2_id
     WHERE b.id = $1`,
    [battleId]
  );
  if (!row) {
    return null;
  }
  if (row.p1_user_id === userId) {
    return { row, mySide: 'p1', myPlayerId: row.player1_id };
  }
  if (row.p2_user_id === userId) {
    return { row, mySide: 'p2', myPlayerId: row.player2_id };
  }
  return null;
}

async function loadState(battleId: string): Promise<DeploymentState | null> {
  const raw = await redisClient.get(redisKey.deployment(battleId));
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as DeploymentState;
  } catch {
    return null;
  }
}

async function saveState(state: DeploymentState): Promise<void> {
  await redisClient.set(redisKey.deployment(state.battleId), JSON.stringify(state));
}

/**
 * 部署状态写锁：所有 load-modify-save 变更（create/update/confirm/finalize）
 * 必须在锁内完成，防止双方并行草稿互覆盖 / confirm 与 finalize 竞态。
 * 锁竞争时短暂重试；仍失败返回 null（调用方转 'busy' 错误）。
 */
async function withWriteLock<T>(
  battleId: string,
  fn: () => Promise<T>
): Promise<T | null> {
  const key = redisKey.deployWriteLock(battleId);
  const token = `${Date.now()}-${Math.random()}`;
  for (let attempt = 0; attempt < WRITE_LOCK_MAX_ATTEMPTS; attempt++) {
    const locked = await redisClient.set(key, token, { NX: true, EX: WRITE_LOCK_TTL_S });
    if (locked) {
      try {
        return await fn();
      } finally {
        await redisClient.del(key).catch(() => undefined);
      }
    }
    await new Promise(r => setTimeout(r, WRITE_LOCK_RETRY_MS));
  }
  return null;
}

// ─── 草稿校验（服务端权威） ──────────────────────────────

interface OwnedCharacterRow {
  id: string;
  profession: string;
}

interface OwnedCardRow {
  id: string;
  name: string;
  profession: string;      // COALESCE 模板职业，无模板 = 'common'
  template_no: number;     // COALESCE 0
}

/**
 * 校验草稿合法性（结构性校验 + DB 归属/职业/库存校验）
 * @returns null = 合法；string[] = 违规明细
 */
async function validateDraft(
  side: DeploySide,
  playerId: string,
  draft: DeployDraft
): Promise<string[] | null> {
  // side 仅用于语义完整性（y 由 side 决定，无需草稿携带）；当前无 side 相关分支
  void side;
  const errors: string[] = [];

  // ── 结构校验（纯内存） ──
  const selected = draft.selectedCharacters ?? [];
  const placements = draft.placements ?? [];
  const decks = draft.decks ?? {};

  if (!Array.isArray(selected) || selected.length !== DEPLOYMENT_PIECE_COUNT) {
    errors.push(`selected_characters_must_be_${DEPLOYMENT_PIECE_COUNT}`);
    return errors;
  }
  if (new Set(selected).size !== selected.length) {
    errors.push('duplicate_character');
    return errors;
  }
  if (!Array.isArray(placements) || placements.length !== DEPLOYMENT_PIECE_COUNT) {
    errors.push(`placements_must_be_${DEPLOYMENT_PIECE_COUNT}`);
    return errors;
  }

  // 每个棋子恰好一个摆位；x 范围合法；不重叠
  const placementByChar = new Map<string, number>();
  const usedX = new Set<number>();
  for (const p of placements) {
    if (!p || typeof p.characterId !== 'string' || !Number.isInteger(p.x)) {
      errors.push('invalid_placement');
      return errors;
    }
    if (p.x < 0 || p.x >= DEPLOYMENT_BOARD_SIZE) {
      errors.push(`placement_x_out_of_range:${p.x}`);
      return errors;
    }
    if (usedX.has(p.x)) {
      errors.push('placement_overlap');
      return errors;
    }
    if (!selected.includes(p.characterId)) {
      errors.push('placement_character_mismatch');
      return errors;
    }
    usedX.add(p.x);
    placementByChar.set(p.characterId, p.x);
  }
  if (placementByChar.size !== DEPLOYMENT_PIECE_COUNT) {
    errors.push('placement_character_mismatch');
    return errors;
  }

  // 卡组：键集合 ⊆ 选中棋子
  const deckEntries = Object.entries(decks);
  const deckChars = new Set(deckEntries.map(([cid]) => cid));
  if (deckChars.size > DEPLOYMENT_PIECE_COUNT) {
    errors.push('too_many_deck_entries');
  }
  for (const cid of deckChars) {
    if (!selected.includes(cid)) {
      errors.push(`deck_character_not_selected:${cid}`);
    }
  }

  // 总量上限 + 跨棋子重复分配检测
  const cardOwner = new Map<string, string>(); // player_card_id -> 已分配棋子
  for (const [cid, cardIds] of deckEntries) {
    if (!Array.isArray(cardIds)) {
      errors.push(`invalid_deck:${cid}`);
      continue;
    }
    if (cardIds.length > DEPLOYMENT_MAX_DECK_SIZE) {
      errors.push(`deck_too_large:${cid}:${cardIds.length}`);
    }
    for (const cardId of cardIds) {
      if (typeof cardId !== 'string') {
        errors.push(`invalid_card_id:${cid}`);
        continue;
      }
      const prev = cardOwner.get(cardId);
      if (prev !== undefined && prev !== cid) {
        errors.push(`card_in_multiple_decks:${cardId}`);
      } else {
        cardOwner.set(cardId, cid);
      }
    }
  }

  // ── DB 校验：棋子归属 + 存活 ──
  const charRows = await query<OwnedCharacterRow>(
    `SELECT id, profession FROM characters
     WHERE player_id = $1 AND is_alive = TRUE AND id = ANY($2::uuid[])`,
    [playerId, selected]
  );
  const ownedChars = new Map(charRows.map(c => [c.id, c.profession]));
  for (const cid of selected) {
    if (!ownedChars.has(cid)) {
      errors.push(`character_not_owned_or_dead:${cid}`);
    }
  }

  // ── DB 校验：卡牌归属 + 职业匹配 + 同名计数 ──
  const allCardIds = [...cardOwner.keys()];
  const cardRows = allCardIds.length
    ? await query<OwnedCardRow>(
        `SELECT pc.id, pc.name,
                COALESCE(ct.profession, 'common') AS profession,
                COALESCE(ct.template_no, 0) AS template_no
         FROM player_cards pc
         LEFT JOIN card_templates ct ON pc.card_template_id = ct.id
         WHERE pc.player_id = $1 AND pc.id = ANY($2::uuid[])`,
        [playerId, allCardIds]
      )
    : [];
  const ownedCards = new Map(cardRows.map(c => [c.id, c]));

  // 每棋子同名卡计数（键 = template_no>0 ? `t${no}` : `n${name}`）
  for (const [cid, cardIds] of deckEntries) {
    const sameCount = new Map<string, number>();
    for (const cardId of cardIds) {
      const card = ownedCards.get(cardId);
      if (!card) {
        errors.push(`card_not_owned:${cardId}`);
        continue;
      }
      const charProfession = ownedChars.get(cid);
      if (charProfession && card.profession !== 'common' && card.profession !== charProfession) {
        errors.push(`card_profession_mismatch:${cardId}`);
      }
      const sameKey = card.template_no > 0 ? `t${card.template_no}` : `n${card.name}`;
      sameCount.set(sameKey, (sameCount.get(sameKey) ?? 0) + 1);
    }
    for (const [key, count] of sameCount) {
      if (count > DEPLOYMENT_MAX_SAME_CARD) {
        errors.push(`same_card_exceeds_${DEPLOYMENT_MAX_SAME_CARD}:${cid}:${key}:${count}`);
      }
    }
  }

  return errors.length ? errors : null;
}

// ─── 超时自动配置（默认值生成） ──────────────────────────

interface DefaultCharRow {
  id: string;
  profession: string;
}

/**
 * 生成一侧的默认配置（超时/未确认方）
 * - 出战棋子：前 3 个 alive（created_at ASC，与旧 loadBattleCharacters 同口径）
 * - 位置：按职业查 AUTO_PLACEMENT；固定位被占（职业重复等）时从固定侧起找空列兜底
 * - 卡组：character_deck 持久默认卡组
 */
export async function buildDefaultSideConfig(
  side: DeploySide,
  playerId: string
): Promise<FinalizedSide> {
  const chars = await query<DefaultCharRow>(
    `SELECT id, profession FROM characters
     WHERE player_id = $1 AND is_alive = TRUE
     ORDER BY created_at ASC LIMIT 3`,
    [playerId]
  );

  const rowY = side === 'p1' ? 0 : 8;
  const usedX = new Set<number>();
  const pieces: FinalizedPiece[] = [];

  for (const c of chars) {
    // 1) 职业固定位；2) 固定位已被占 -> 从固定侧起找空列兜底
    let pos = AUTO_PLACEMENT[side][c.profession];
    if (!pos || usedX.has(pos.x)) {
      const dir = side === 'p1' ? 1 : -1;
      let x = side === 'p1' ? 0 : DEPLOYMENT_BOARD_SIZE - 1;
      while (x >= 0 && x < DEPLOYMENT_BOARD_SIZE && usedX.has(x)) {
        x += dir;
      }
      pos = { x, y: rowY };
    }
    usedX.add(pos.x);

    const deckRows = await getCharacterDeckCards(c.id);
    pieces.push({
      characterId: c.id,
      x: pos.x,
      y: rowY,
      deckCardIds: deckRows.map(r => r.card_id),
    });
  }

  return { pieces };
}

// ========================================
// 公共 API
// ========================================

/**
 * 创建布置阶段（initDeployment 调用，幂等：已存在直接返回现状）
 * - status 须为 pending（布置期沿用 pending，battle 正式开始才置 ongoing）
 * - battles.current_phase 置 'deployment'，deadline = now + 120s
 */
export async function createDeployment(
  battleId: string
): Promise<{ success: boolean; state?: DeploymentState; error?: string }> {
  const result = await withWriteLock(battleId, async () => {
    const battleRow = await queryOne<{ player1_id: string; player2_id: string }>(
      `SELECT player1_id, player2_id FROM battles WHERE id = $1 AND status = 'pending'`,
      [battleId]
    );
    if (!battleRow) {
      return { success: false, error: 'battle_not_pending' };
    }

    const existing = await loadState(battleId);
    if (existing) {
      return { success: true, state: existing };
    }

    const state: DeploymentState = {
      battleId,
      deadline: new Date(Date.now() + DEPLOYMENT_DURATION_MS).toISOString(),
      p1: { playerId: battleRow.player1_id, confirmed: false, draft: null },
      p2: { playerId: battleRow.player2_id, confirmed: false, draft: null },
      finalized: null,
    };
    await saveState(state);

    // DB phase 标记（审计用；运行时以 Redis deployment key 为准）
    await execute(
      `UPDATE battles SET current_phase = 'deployment', updated_at = NOW() WHERE id = $1`,
      [battleId]
    );

    return { success: true, state };
  });
  return result ?? { success: false, error: 'write_lock_busy' };
}

/**
 * 更新草稿（battle:deploy_update）
 * - 已确认方不可再改；超时后拒绝（finalize 由 sweeper/confirm 触发）
 */
export async function updateDraft(
  battleId: string,
  userId: string,
  draft: DeployDraft
): Promise<{ success: boolean; state?: DeploymentState; error?: string; details?: string[] }> {
  const ctx = await loadBattleContext(battleId, userId);
  if (!ctx) {
    return { success: false, error: 'not_participant' };
  }

  // 校验在锁外做（重 DB 查询），锁内重读状态后再落盘，
  // 防止「校验期间对手 confirm/finalize」的 TOCTOU
  const errors = await validateDraft(ctx.mySide, ctx.myPlayerId, draft);
  if (errors) {
    return { success: false, error: 'invalid_draft', details: errors };
  }

  const result = await withWriteLock(battleId, async () => {
    const state = await loadState(battleId);
    if (!state) {
      return { success: false, error: 'deployment_not_found' };
    }
    if (state.finalized) {
      return { success: false, error: 'deployment_finalized' };
    }
    const side = ctx.mySide;
    if (state[side].confirmed) {
      return { success: false, error: 'side_confirmed' };
    }
    if (Date.now() > Date.parse(state.deadline)) {
      return { success: false, error: 'deployment_expired' };
    }
    if (state[side].playerId !== ctx.myPlayerId) {
      return { success: false, error: 'deployment_not_found' }; // 状态与对局行不一致，防御
    }

    state[side].draft = draft;
    await saveState(state);
    return { success: true, state };
  });
  return result ?? { success: false, error: 'write_lock_busy' };
}

/**
 * 确认完成（battle:deploy_confirm）
 * - 要求草稿存在且合法（服务端再校验一次兜底）
 * @returns bothConfirmed：双方均已确认（调用方据此触发 finalize）
 */
export async function confirmDeployment(
  battleId: string,
  userId: string
): Promise<{ success: boolean; state?: DeploymentState; bothConfirmed?: boolean; error?: string; details?: string[] }> {
  const ctx = await loadBattleContext(battleId, userId);
  if (!ctx) {
    return { success: false, error: 'not_participant' };
  }

  const result = await withWriteLock(battleId, async () => {
    const state = await loadState(battleId);
    if (!state) {
      return { success: false, error: 'deployment_not_found' };
    }
    if (state.finalized) {
      return { success: false, error: 'deployment_finalized' };
    }
    const side = ctx.mySide;
    if (state[side].confirmed) {
      return { success: false, error: 'side_confirmed' };
    }
    if (Date.now() > Date.parse(state.deadline)) {
      return { success: false, error: 'deployment_expired' };
    }
    const draft = state[side].draft;
    if (!draft) {
      return { success: false, error: 'no_draft' };
    }

    // 锁内再校验（草稿写入后玩家库存理论上不变，防御性兜底）
    const errors = await validateDraft(side, state[side].playerId, draft);
    if (errors) {
      return { success: false, error: 'invalid_draft', details: errors };
    }

    state[side].confirmed = true;
    await saveState(state);

    const bothConfirmed = state.p1.confirmed && state.p2.confirmed;
    return { success: true, state, bothConfirmed };
  });
  return result ?? { success: false, error: 'write_lock_busy' };
}

/**
 * 终结布置（双方确认或超时触发；幂等）
 *
 * - 已确认方 -> 草稿（若草稿此刻校验失败，回落默认配置，防御性兜底）
 * - 未确认方 -> 默认配置（自动选子 + 职业固定位 + 默认卡组）
 * - 结果写入 state.finalized（幂等标记）+ battles.battle_data（审计）
 * - 写锁内完成（与 updateDraft/confirm 串行化，天然防双算）
 */
export async function finalizeDeployment(
  battleId: string
): Promise<{ success: boolean; finalized?: FinalizedDeployment; error?: string }> {
  const result = await withWriteLock(battleId, async () => {
    const state = await loadState(battleId);
    if (!state) {
      return { success: false, error: 'deployment_not_found' };
    }
    // 幂等：已 finalize 直接返回
    if (state.finalized) {
      return { success: true, finalized: state.finalized };
    }

    const [p1, p2] = await Promise.all([
      resolveSide('p1', state),
      resolveSide('p2', state),
    ]);
    const finalized: FinalizedDeployment = { p1, p2 };

    state.finalized = finalized;
    await saveState(state);

    // 审计持久化：battles.battle_data 合并 { "deployment": {...} }
    try {
      await execute(
        `UPDATE battles
         SET battle_data = COALESCE(battle_data, '{}'::jsonb) || $2::jsonb,
             updated_at = NOW()
         WHERE id = $1`,
        [battleId, JSON.stringify({ deployment: finalized })]
      );
    } catch (err) {
      console.error(`[finalizeDeployment:${battleId}] battle_data persist failed:`, err);
      // 审计写失败不阻塞开战
    }

    return { success: true, finalized };
  });
  return result ?? { success: false, error: 'write_lock_busy' };
}

/** 单侧配置解析：已确认 -> 草稿；未确认 -> 默认配置 */
async function resolveSide(
  side: DeploySide,
  state: DeploymentState
): Promise<FinalizedSide> {
  const sideState = state[side];
  if (sideState.confirmed && sideState.draft) {
    const errors = await validateDraft(side, sideState.playerId, sideState.draft);
    if (!errors) {
      const rowY = side === 'p1' ? 0 : 8;
      return {
        pieces: sideState.draft.selectedCharacters.map(cid => {
          const placement = sideState.draft!.placements.find(p => p.characterId === cid)!;
          return {
            characterId: cid,
            x: placement.x,
            y: rowY,
            deckCardIds: sideState.draft!.decks[cid] ?? [],
          };
        }),
      };
    }
    // 防御性兜底：确认过的草稿此刻校验失败（理论上不可能，数据被外部改动）
    console.error(
      `[finalizeDeployment:${state.battleId}] confirmed draft invalid (${side}), fallback to default:`,
      errors
    );
  }
  return buildDefaultSideConfig(side, sideState.playerId);
}

/**
 * 单端可视视图（battle:deploy_state 广播用）
 * - 只含自己的草稿；对手仅暴露 confirmed 状态
 */
export async function getDeploymentView(
  battleId: string,
  userId: string
): Promise<DeploymentView | null> {
  const ctx = await loadBattleContext(battleId, userId);
  const state = await loadState(battleId);
  if (!ctx || !state) {
    return null;
  }
  const mySide = ctx.mySide;
  const opponentSide: DeploySide = mySide === 'p1' ? 'p2' : 'p1';
  return {
    phase: 'deployment',
    deadline: state.deadline,
    deadlineRemainingMs: Math.max(0, Date.parse(state.deadline) - Date.now()),
    mySide,
    myDraft: state[mySide].draft,
    myConfirmed: state[mySide].confirmed,
    opponentConfirmed: state[opponentSide].confirmed,
    finalized: state.finalized !== null,
  };
}

/**
 * 布置是否已到期且未终结（sweeper 判定用）
 */
export async function isDeploymentExpired(battleId: string): Promise<boolean> {
  const state = await loadState(battleId);
  if (!state || state.finalized) {
    return false; // 不存在或已终结均不需触发
  }
  return Date.now() > Date.parse(state.deadline);
}

/**
 * 清理布置阶段 Redis 状态（battle 正式开始后调用）
 */
export async function cleanupDeployment(battleId: string): Promise<void> {
  await redisClient.del(redisKey.deployment(battleId)).catch(() => undefined);
  await redisClient.del(redisKey.deployWriteLock(battleId)).catch(() => undefined);
}
