import type { Server as IOServer } from 'socket.io';
import { getDbSessionState, completeMovePhase, completePlayPhase, endCurrentStep, activateCurrentUnit, completeDrawPhase, endCurrentRound } from './battleSessionService';
import type { BattleSessionState } from './battleSessionService';
import {
  listCharactersInBattle,
  validateMovement,
  moveCharacter,
  getCharacterPosition,
  validateAttack,
  validateAOEAttack,
  validateTauntCard,
  getCharacterPiece,
  setCharacterEnergy,
} from './battleService';
import type { AttackValidationResult } from './battleService';
import type { HandCard } from './handService';
import { getActorHand, addToDiscardPile, retainHandOnStepEnd, drawCards } from './handService';
import { tickBurnDamageOnTarget } from './professionMechanicService';
import { broadcastBoardState, broadcastHandState, broadcastCharacterStatus, broadcastSessionState } from '../socket/battleStateBroadcaster';
import { redisClient } from '../config/redis';

/**
 * T049 移动操作同步
 *
 * 业务规则（按 T049 spec §3.2）：
 *   1. session 存在
 *   2. current_phase === 'move'
 *   3. payload.characterId === current_actor_id
 *   4. character.userId === payload.userId（防同房间对手冒充）
 *   5. validateMovement 返回 valid
 *   6. moveCharacter 原子写入成功
 *
 * 成功后副作用（按顺序）：
 *   - broadcastBoardState(io, battleId)
 *   - completeMovePhase(battleId)
 */

export type MoveError =
  | 'not_in_move_phase'
  | 'not_current_actor'
  | 'not_owner'
  | 'invalid_path'
  | 'move_failed';

export type MoveResult =
  | { success: true }
  | { success: false; error: MoveError };

/**
 * 执行一次移动操作的「验证 + 执行 + 广播 + 阶段推进」流水
 *
 * @param io IOServer 实例（用于 broadcastBoardState）
 * @param battleId battle id
 * @param characterId 移动的棋子
 * @param toX 目标 X（0-8）
 * @param toY 目标 Y（0-8）
 * @param userId 发起请求的 user（从 socket.data 拿）
 * @returns MoveResult —— 失败时携带 error 字符串
 *
 * 错误处理：业务失败返回 `{ success: false, error: ... }`；
 * 依赖服务（getDbSessionState 等）抛错 → 向上抛（异常路径）。
 */
export async function executeMove(
  io: IOServer,
  battleId: string,
  characterId: string,
  toX: number,
  toY: number,
  userId: string
): Promise<MoveResult> {
  // 1. 读 session
  const session = await getDbSessionState(battleId);
  if (!session) {
    throw new Error(`executeMove: session not found: ${battleId}`);
  }

  // 2. phase check
  if (session.currentPhase !== 'move') {
    return { success: false, error: 'not_in_move_phase' };
  }

  // 3. actor match
  if (session.currentActorId !== characterId) {
    return { success: false, error: 'not_current_actor' };
  }

  // 4. user 拥有此 character
  const characters = await listCharactersInBattle(battleId);
  const character = characters.find((c) => c.characterId === characterId);
  if (!character || character.userId !== userId) {
    return { success: false, error: 'not_owner' };
  }

  // 5. BFS 路径合法
  const validation = await validateMovement(battleId, characterId, toX, toY);
  if (!validation.valid) {
    return { success: false, error: 'invalid_path' };
  }

  // 6. 取 from 坐标 + 原子移动
  const fromPos = await getCharacterPosition(battleId, characterId);
  if (!fromPos) {
    return { success: false, error: 'move_failed' };
  }
  const moved = await moveCharacter(
    battleId,
    characterId,
    fromPos.x,
    fromPos.y,
    toX,
    toY
  );
  if (!moved) {
    return { success: false, error: 'move_failed' };
  }

  // 7. 广播 + 阶段推进（顺序：先 broadcast 让客户端看到新 board，再推进 phase）
  await broadcastBoardState(io, battleId);
  await completeMovePhase(battleId);

  return { success: true };
}

/**
 * T050 打牌操作同步
 *
 * 业务规则（按 T050 spec §3.2）：
 *   1. session 存在
 *   2. current_phase === 'play'
 *   3. session.current_actor_id === characterId
 *   4. character.userId === userId（防同房间对手冒充）
 *   5. handCard.deck_id 在 actor hand LIST 中
 *   6. card.type 是 'attack'（AOE/单体）或 'tactical'+'taunt'
 *   7. validate* 返回 valid
 *
 * 成功后副作用（按顺序）：
 *   - 读 pieces HASH → currentEnergy
 *   - setCharacterEnergy(attackerId, currentEnergy - energyCost)
 *   - redisClient.lRem(hand LIST, 1, JSON.stringify(handCard))
 *   - addToDiscardPile (if source='deck')
 *   - broadcastHandState(io, battleId, userId, characterId)  // self
 *   - broadcastCharacterStatus(io, battleId, characterId)   // both
 *   - completePlayPhase(battleId)                           // play → end_step
 *   - broadcastBoardState(io, battleId)                     // both, 含 phase
 */

export type PlayCardError =
  | 'not_in_play_phase'
  | 'not_current_actor'
  | 'not_owner'
  | 'card_not_in_hand'
  | 'unsupported_card_type'
  | 'validation_failed'
  | 'energy_deduct_failed'
  | 'side_effect_failed';

export type PlayCardResult =
  | { success: true; validation: AttackValidationResult }
  | { success: false; error: PlayCardError; detail?: string };

/**
 * 执行一次打牌操作的「验证 + 副作用 + 广播 + 阶段推进」流水
 *
 * @param io IOServer 实例（用于 broadcaster）
 * @param battleId battle id
 * @param characterId 打出卡牌的 actor
 * @param handCard 客户端传整张手牌对象（含 deck_id/card_id/type/effect/source/targetId）
 * @param userId 发起请求的 user（从 socket.data 拿）
 * @returns PlayCardResult —— 失败时携带 error 字符串
 *
 * 错误处理：业务失败返回 `{ success: false, error: ... }`；
 * 依赖服务（getDbSessionState 等）抛错 → 向上抛（异常路径）。
 */
export async function executePlayCard(
  io: IOServer,
  battleId: string,
  characterId: string,
  handCard: HandCard,
  userId: string
): Promise<PlayCardResult> {
  // 1. 读 session
  const session = await getDbSessionState(battleId);
  if (!session) {
    throw new Error(`executePlayCard: session not found: ${battleId}`);
  }

  // 2. phase check
  if (session.currentPhase !== 'play') {
    return { success: false, error: 'not_in_play_phase' };
  }

  // 3. actor match
  if (session.currentActorId !== characterId) {
    return { success: false, error: 'not_current_actor' };
  }

  // 4. user 拥有此 character
  const characters = await listCharactersInBattle(battleId);
  const character = characters.find((c) => c.characterId === characterId);
  if (!character || character.userId !== userId) {
    return { success: false, error: 'not_owner' };
  }

  // 5. 手牌归属校验
  const hand = await getActorHand(battleId, characterId);
  if (!hand.some((c) => c.deck_id === handCard.deck_id)) {
    return { success: false, error: 'card_not_in_hand' };
  }

  // 6. card.type dispatch
  let validation: AttackValidationResult;
  if (handCard.type === 'attack' && (handCard.effect as { aoe?: boolean })?.aoe) {
    validation = await validateAOEAttack(battleId, characterId, handCard.card_id, handCard.source);
  } else if (handCard.type === 'attack') {
    validation = await validateAttack(
      battleId,
      characterId,
      handCard.card_id,
      (handCard as HandCard & { targetId?: string }).targetId!,
      session.currentRound,
      handCard.source
    );
  } else if (
    handCard.type === 'tactical' &&
    (handCard.effect as { type?: string })?.type === 'taunt'
  ) {
    validation = await validateTauntCard(
      battleId,
      characterId,
      handCard.card_id,
      (handCard as HandCard & { targetId?: string }).targetId!,
      session.currentRound
    );
  } else {
    return {
      success: false,
      error: 'unsupported_card_type',
      detail: `card type '${handCard.type}' effect '${(handCard.effect as { type?: string })?.type ?? 'unknown'}' not supported in T050`,
    };
  }

  if (!validation.valid) {
    return { success: false, error: 'validation_failed', detail: validation.error };
  }

  // 7. 副作用：扣能量（读 pieces HASH → setCharacterEnergy）
  let currentEnergy = 0;
  try {
    const pieceRaw = await redisClient.hGet(`battle:${battleId}:pieces`, characterId);
    if (pieceRaw) {
      currentEnergy = JSON.parse(pieceRaw).energy ?? 0;
    }
  } catch (err) {
    return { success: false, error: 'energy_deduct_failed', detail: (err as Error).message };
  }

  try {
    await setCharacterEnergy(battleId, characterId, currentEnergy - (validation.energyCost ?? 0));
  } catch (err) {
    return { success: false, error: 'energy_deduct_failed', detail: (err as Error).message };
  }

  // 8. 删手牌
  try {
    await redisClient.lRem(`battle:${battleId}:hand:${characterId}`, 1, JSON.stringify(handCard));
  } catch (err) {
    return { success: false, error: 'side_effect_failed', detail: (err as Error).message };
  }

  // 9. 入弃牌堆（仅 deck 来源）
  try {
    if (handCard.source === 'deck') {
      await addToDiscardPile(battleId, characterId, [handCard]);
    }
  } catch (err) {
    return { success: false, error: 'side_effect_failed', detail: (err as Error).message };
  }

  // 10. 广播
  await broadcastHandState(io, battleId, userId, characterId);
  await broadcastCharacterStatus(io, battleId, characterId);

  // 11. 阶段推进 + 整盘广播
  await completePlayPhase(battleId);
  await broadcastBoardState(io, battleId);

  return { success: true, validation };
}

/**
 * T051 回合切换 orchestrator
 *
 * 业务规则（按 T051 spec §1.2）：
 *   1. session 存在
 *   2. current_phase === 'play' OR 'move'
 *   3. retainHandOnStepEnd 保留 1 张手牌
 *   4. if (isLastStepInRound) → executeRoundEnd
 *   5. endCurrentStep
 *   6. activateCurrentUnit (snake draft)
 *   7. drawCards
 *   8. completeDrawPhase
 *   9. 末尾重读 session
 *  10. broadcastSessionState
 *  11. broadcastBoardState
 */

export type StepEndError =
  | 'not_in_play_or_move_phase'
  | 'not_current_actor'
  | 'retain_failed'
  | 'round_end_failed'
  | 'end_step_failed'
  | 'activate_failed'
  | 'draw_failed'
  | 'complete_phase_failed';

export type StepEndResult =
  | { success: true; state: BattleSessionState }
  | { success: false; error: StepEndError; detail?: string };

export async function executeEndStep(
  io: IOServer,
  battleId: string
): Promise<StepEndResult> {
  // 1. 读 session
  const state = await getDbSessionState(battleId);
  if (!state) {
    throw new Error(`executeEndStep: session not found: ${battleId}`);
  }

  // 2. phase check
  if (state.currentPhase !== 'play' && state.currentPhase !== 'move') {
    return { success: false, error: 'not_in_play_or_move_phase' };
  }

  // 3. retain 手牌（自动保留 hand LIST 第一张，如手牌为空传 null）
  try {
    const hand = await getActorHand(battleId, state.currentActorId!);
    const retainDeckId = hand[0]?.deck_id ?? null;
    const retainResult = await retainHandOnStepEnd(battleId, state.currentActorId!, retainDeckId);
    if (!retainResult.success) {
      return { success: false, error: 'retain_failed', detail: retainResult.error };
    }
  } catch (err) {
    return { success: false, error: 'retain_failed', detail: (err as Error).message };
  }

  // 4. (last step?) executeRoundEnd — TDD STUB for Task 3, Task 4 adds routing

  // 5. endCurrentStep
  try {
    const r = await endCurrentStep(battleId);
    if (!r.success) {
      return { success: false, error: 'end_step_failed', detail: r.error };
    }
  } catch (err) {
    return { success: false, error: 'end_step_failed', detail: (err as Error).message };
  }

  // 6. activateCurrentUnit
  try {
    const r = await activateCurrentUnit(battleId);
    if (!r.success) {
      return { success: false, error: 'activate_failed', detail: r.error };
    }
  } catch (err) {
    return { success: false, error: 'activate_failed', detail: (err as Error).message };
  }

  // 7. drawCards (新 actor)
  const updatedState = await getDbSessionState(battleId);
  if (!updatedState || !updatedState.currentActorId) {
    return { success: false, error: 'draw_failed' };
  }
  try {
    const r = await drawCards(battleId, updatedState.currentActorId);
    if (!r.success) {
      return { success: false, error: 'draw_failed', detail: r.error };
    }
  } catch (err) {
    return { success: false, error: 'draw_failed', detail: (err as Error).message };
  }

  // 8. completeDrawPhase
  try {
    const r = await completeDrawPhase(battleId);
    if (!r.success) {
      return { success: false, error: 'complete_phase_failed', detail: r.error };
    }
  } catch (err) {
    return { success: false, error: 'complete_phase_failed', detail: (err as Error).message };
  }

  // 9. 末尾重读 session
  const finalStateRaw = await getDbSessionState(battleId);
  if (!finalStateRaw) {
    throw new Error(`executeEndStep: final state read failed: ${battleId}`);
  }
  // Cast to BattleSessionState (runtime guarantees full shape; mock tests may return partial)
  const finalState = finalStateRaw as BattleSessionState;

  // 10-11. 广播
  await broadcastSessionState(io, battleId, finalState);
  await broadcastBoardState(io, battleId);

  return { success: true, state: finalState };
}

export async function executeRoundEnd(
  _io: IOServer,
  _battleId: string,
  _stateBefore: BattleSessionState
): Promise<void> {
  // TDD STUB: Task 2 占位。Task 4 替换为完整 5 步实现。
}
