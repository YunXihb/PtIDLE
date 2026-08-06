import { redisClient } from '../config/redis';
import { query, queryOne, execute } from '../config/database';
import { redisKey } from '../utils/redisKeys';

// ========================================
// 类型定义
// ========================================

/**
 * 战斗阶段枚举
 * - idle: 战斗已创建，等待激活
 * - draw: 当前激活单位正在抽牌 (T037 处理)
 * - move: 当前激活单位可以移动
 * - play: 当前激活单位可以打牌
 * - end_step: 当前单位回合结束，等待切换
 * - end_round: 本轮所有单位行动完毕，等待进入下一轮
 * - finished: 战斗已结束
 */
export type BattlePhase =
  | 'idle'
  | 'draw'
  | 'move'
  | 'play'
  | 'end_step'
  | 'end_round'
  | 'finished';

/**
 * 战斗会话状态（Redis 临时状态）
 */
export interface BattleSessionState {
  battleId: string;
  currentRound: number;
  currentStep: number;
  currentPhase: BattlePhase;
  currentActorId: string | null;
  activationOrder: string[]; // 蛇形激活顺序（character_id 列表）
  player1Chars: string[];
  player2Chars: string[];
  updatedAt: string; // ISO timestamp
}

/**
 * 公共 API 响应（getCurrentState）
 */
export interface BattleSessionView extends BattleSessionState {
  totalSteps: number; // 本轮总步数（activationOrder.length）
  nextActorId: string | null; // 下一步激活的棋子（end_step 时为下一个；end_round 时为下一轮首步）
  isLastStepInRound: boolean;
}

// ========================================
// Redis 键
// ========================================

/**
 * Redis 战斗会话状态 key
 */
function getSessionKey(battleId: string): string {
  return redisKey.session(battleId);
}

// ========================================
// 蛇形激活顺序构造
// ========================================

/**
 * 构造蛇形激活顺序（3v3 简化为 ABABAB 6 步，每步 1 个单位）
 *
 * 算法：对 2N 步（0 到 2N-1）依次添加，偶数索引取 p1，奇数索引取 p2。
 * - 1v1: [p1[0], p2[0]]
 * - 2v2: [p1[0], p2[0], p1[1], p2[1]]
 * - 3v3: [p1[0], p2[0], p1[1], p2[1], p1[2], p2[2]]  (ABABAB 6 步)
 * - 4v4: [p1[0], p2[0], p1[1], p2[1], p1[2], p2[2], p1[3], p2[3]]
 *
 * 注意：5v5 项目计划使用块状激活模式 (A-1, B-2, A-2, B-2, A-2, B-1)，
 * 该模式与本算法的 1 单位/步策略不同，留待未来扩展。
 */
export function buildSnakeOrder(
  p1Chars: string[],
  p2Chars: string[]
): string[] {
  const n = Math.max(p1Chars.length, p2Chars.length);
  const order: string[] = [];
  let p1Idx = 0;
  let p2Idx = 0;

  for (let i = 0; i < 2 * n; i++) {
    if (i % 2 === 0) {
      if (p1Idx < p1Chars.length) {
        order.push(p1Chars[p1Idx++]);
      }
    } else {
      if (p2Idx < p2Chars.length) {
        order.push(p2Chars[p2Idx++]);
      }
    }
  }

  return order;
}

// ========================================
// 内部辅助：加载/保存 Redis 状态
// ========================================

/**
 * 从 Redis 加载会话状态
 */
async function loadSessionState(
  battleId: string
): Promise<BattleSessionState | null> {
  const data = await redisClient.get(getSessionKey(battleId));
  if (!data) {
    return null;
  }
  try {
    return JSON.parse(data) as BattleSessionState;
  } catch {
    return null;
  }
}

/**
 * 保存会话状态到 Redis
 */
async function saveSessionState(state: BattleSessionState): Promise<void> {
  state.updatedAt = new Date().toISOString();
  await redisClient.set(getSessionKey(state.battleId), JSON.stringify(state));
}

/**
 * 同步会话状态到 PostgreSQL（持久化）
 * - 用于：initializeSession, endCurrentRound, 战斗结束时
 */
async function persistSessionToDb(state: BattleSessionState): Promise<void> {
  await execute(
    `UPDATE battles
     SET current_round = $2,
         current_step = $3,
         current_actor_id = $4,
         current_phase = $5,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [
      state.battleId,
      state.currentRound,
      state.currentStep,
      state.currentActorId,
      state.currentPhase,
    ]
  );
}

/**
 * 校验当前阶段是否在合法集中
 */
function assertPhase(
  state: BattleSessionState,
  allowed: BattlePhase[]
): { ok: true } | { ok: false; error: string } {
  if (!allowed.includes(state.currentPhase)) {
    return {
      ok: false,
      error: `Invalid phase: expected one of [${allowed.join(', ')}], got '${state.currentPhase}'`,
    };
  }
  return { ok: true };
}

// ========================================
// 公共 API
// ========================================

/**
 * 1. 初始化战斗会话
 * - 创建 Redis 临时状态
 * - 生成蛇形激活顺序
 * - 设置初始 actor 为 activationOrder[0]，phase = idle
 * - 持久化到 PostgreSQL
 */
export async function initializeSession(
  battleId: string,
  player1Chars: string[],
  player2Chars: string[]
): Promise<{ success: boolean; state?: BattleSessionState; error?: string }> {
  if (!player1Chars.length || !player2Chars.length) {
    return { success: false, error: 'Each side must have at least 1 character' };
  }

  const activationOrder = buildSnakeOrder(player1Chars, player2Chars);
  if (activationOrder.length === 0) {
    return { success: false, error: 'Failed to build activation order' };
  }

  const state: BattleSessionState = {
    battleId,
    currentRound: 1,
    currentStep: 0,
    currentPhase: 'idle',
    currentActorId: activationOrder[0],
    activationOrder,
    player1Chars: [...player1Chars],
    player2Chars: [...player2Chars],
    updatedAt: new Date().toISOString(),
  };

  try {
    await saveSessionState(state);
    await persistSessionToDb(state);
    return { success: true, state };
  } catch (err) {
    return {
      success: false,
      error: `Failed to initialize session: ${(err as Error).message}`,
    };
  }
}

/**
 * 2. 获取当前战斗会话状态
 */
export async function getCurrentState(
  battleId: string
): Promise<BattleSessionView | null> {
  const state = await loadSessionState(battleId);
  if (!state) {
    return null;
  }

  const totalSteps = state.activationOrder.length;
  const isLastStepInRound = state.currentStep === totalSteps - 1;

  // 下一步激活的棋子
  let nextActorId: string | null = null;
  if (state.currentPhase === 'end_step' && !isLastStepInRound) {
    nextActorId = state.activationOrder[state.currentStep + 1];
  } else if (state.currentPhase === 'end_round') {
    nextActorId = state.activationOrder[0]; // 下一轮首步
  }

  return {
    ...state,
    totalSteps,
    nextActorId,
    isLastStepInRound,
  };
}

/**
 * 3. 激活当前单位
 * - 仅在 idle 阶段可调用
 * - 转换到 draw 阶段
 * - 抽牌逻辑（T037）会在 draw 阶段执行
 */
export async function activateCurrentUnit(
  battleId: string
): Promise<{ success: boolean; state?: BattleSessionState; error?: string }> {
  const state = await loadSessionState(battleId);
  if (!state) {
    return { success: false, error: 'Session not found' };
  }

  const phaseCheck = assertPhase(state, ['idle']);
  if (!phaseCheck.ok) {
    return { success: false, error: phaseCheck.error };
  }

  if (!state.currentActorId) {
    return { success: false, error: 'No current actor' };
  }

  state.currentPhase = 'draw';
  await saveSessionState(state);
  return { success: true, state };
}

/**
 * 4. 完成抽牌阶段
 * - draw → move
 * - 实际抽牌逻辑（T037）会在调用此函数前完成
 */
export async function completeDrawPhase(
  battleId: string
): Promise<{ success: boolean; state?: BattleSessionState; error?: string }> {
  const state = await loadSessionState(battleId);
  if (!state) {
    return { success: false, error: 'Session not found' };
  }

  const phaseCheck = assertPhase(state, ['draw']);
  if (!phaseCheck.ok) {
    return { success: false, error: phaseCheck.error };
  }

  state.currentPhase = 'move';
  await saveSessionState(state);
  return { success: true, state };
}

/**
 * 5. 完成移动阶段
 * - move → play
 */
export async function completeMovePhase(
  battleId: string
): Promise<{ success: boolean; state?: BattleSessionState; error?: string }> {
  const state = await loadSessionState(battleId);
  if (!state) {
    return { success: false, error: 'Session not found' };
  }

  const phaseCheck = assertPhase(state, ['move']);
  if (!phaseCheck.ok) {
    return { success: false, error: phaseCheck.error };
  }

  state.currentPhase = 'play';
  await saveSessionState(state);
  return { success: true, state };
}

/**
 * 6. 完成打牌阶段
 * - play → end_step
 * - 实际打牌逻辑（已由 T034/T035 validateMove/validateAttack 校验）会在调用此函数前完成
 */
export async function completePlayPhase(
  battleId: string
): Promise<{ success: boolean; state?: BattleSessionState; error?: string }> {
  const state = await loadSessionState(battleId);
  if (!state) {
    return { success: false, error: 'Session not found' };
  }

  const phaseCheck = assertPhase(state, ['play']);
  if (!phaseCheck.ok) {
    return { success: false, error: phaseCheck.error };
  }

  state.currentPhase = 'end_step';
  await saveSessionState(state);
  return { success: true, state };
}

/**
 * 7. 结束当前步
 * - 仅在 end_step 阶段可调用
 * - 如果不是本轮最后一步：step+1，actor 切换为下一位，phase 重置为 idle
 * - 如果是本轮最后一步：phase = end_round（等待 endCurrentRound 显式切换）
 */
export async function endCurrentStep(
  battleId: string
): Promise<{ success: boolean; state?: BattleSessionState; error?: string }> {
  const state = await loadSessionState(battleId);
  if (!state) {
    return { success: false, error: 'Session not found' };
  }

  const phaseCheck = assertPhase(state, ['end_step']);
  if (!phaseCheck.ok) {
    return { success: false, error: phaseCheck.error };
  }

  const totalSteps = state.activationOrder.length;
  if (state.currentStep < totalSteps - 1) {
    state.currentStep += 1;
    state.currentActorId = state.activationOrder[state.currentStep];
    state.currentPhase = 'idle';
  } else {
    state.currentPhase = 'end_round';
  }

  await saveSessionState(state);
  return { success: true, state };
}

/**
 * 8. 结束当前轮
 * - 仅在 end_round 阶段可调用
 * - round+1，step 重置为 0，actor = activationOrder[0]，phase 重置为 idle
 * - 持久化到 PostgreSQL
 */
export async function endCurrentRound(
  battleId: string
): Promise<{ success: boolean; state?: BattleSessionState; error?: string }> {
  const state = await loadSessionState(battleId);
  if (!state) {
    return { success: false, error: 'Session not found' };
  }

  const phaseCheck = assertPhase(state, ['end_round']);
  if (!phaseCheck.ok) {
    return { success: false, error: phaseCheck.error };
  }

  state.currentRound += 1;
  state.currentStep = 0;
  state.currentActorId = state.activationOrder[0];
  state.currentPhase = 'idle';

  await saveSessionState(state);
  await persistSessionToDb(state);
  return { success: true, state };
}

/**
 * 9. 标记战斗结束（附加 API，配套 T036 使用）
 * - 任意阶段可调用（用于战斗结束判定 T052）
 * - phase = finished，actor 置 null
 * - 持久化到 PostgreSQL
 */
export async function finishSession(
  battleId: string
): Promise<{ success: boolean; state?: BattleSessionState; error?: string }> {
  const state = await loadSessionState(battleId);
  if (!state) {
    return { success: false, error: 'Session not found' };
  }

  state.currentPhase = 'finished';
  state.currentActorId = null;
  await saveSessionState(state);
  await persistSessionToDb(state);
  return { success: true, state };
}

/**
 * 删除会话（清理 Redis 状态，主要用于测试或重置对战）
 */
export async function deleteSession(battleId: string): Promise<void> {
  await redisClient.del(getSessionKey(battleId));
}

/**
 * 读取运行时会话状态（Redis 主存，含完整 activationOrder）
 *
 * 注意：这是战斗编排层（battleActionService / broadcaster）的**唯一**状态读取入口。
 * Redis 是运行时主存（每步 phase 切换只写 Redis），PostgreSQL 仅作审计/恢复。
 * 旧实现 getDbSessionState 读 DB 导致 phase 滞后，已废弃。
 */
export async function getSessionState(
  battleId: string
): Promise<BattleSessionState | null> {
  return loadSessionState(battleId);
}

/**
 * 内部辅助：查询 DB 同步状态（仅用于测试和调试，不用于运行时）
 * @deprecated 运行时请用 getSessionState（读 Redis 主存）
 */
export async function getDbSessionState(
  battleId: string
): Promise<{
  currentRound: number;
  currentStep: number;
  currentActorId: string | null;
  currentPhase: string;
} | null> {
  const row = await queryOne<{
    current_round: number;
    current_step: number;
    current_actor_id: string | null;
    current_phase: string;
  }>(
    `SELECT current_round, current_step, current_actor_id, current_phase
     FROM battles WHERE id = $1`,
    [battleId]
  );

  if (!row) return null;

  return {
    currentRound: row.current_round,
    currentStep: row.current_step,
    currentActorId: row.current_actor_id,
    currentPhase: row.current_phase,
  };
}

// Re-export query for tests that want to verify DB state
export { query };
