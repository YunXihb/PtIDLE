import type { Server as IOServer } from 'socket.io';
import { getSessionState, completeMovePhase, completePlayPhase, endCurrentStep, activateCurrentUnit, completeDrawPhase, endCurrentRound } from './battleSessionService';
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
import { getActorHand, addToDiscardPile, retainHandOnStepEnd, drawCards, removeCardFromHand } from './handService';
import { tickBurnDamageOnTarget } from './professionMechanicService';
import { tickEffects } from './statusEffectService';
import { broadcastBoardState, broadcastHandState, broadcastCharacterStatus, broadcastSessionState } from '../socket/battleStateBroadcaster';
import { applyKillStars, applyBaseStars, checkWinCondition, recordVictory } from './battleOutcomeService';
import { consumeDeckCardOnPlay } from './cardConsumptionService';
import { redisClient } from '../config/redis';
import { redisKey } from '../utils/redisKeys';

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
  // 1. 读 session（Redis 主存，含完整 activationOrder）
  const session = await getSessionState(battleId);
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
 * T1018: 出牌时的「对局内消耗」——扣对局牌库 + 记本局消耗清单
 *
 * 与 T053 的差异（T053 的实现恒 ROLLBACK，实际什么都没删）：
 *   - T053 在出牌时实时 DELETE character_deck + player_cards，两条 DELETE 同事务
 *     顺序执行，且第二条的子查询引用了第一条刚删掉的 character_deck 行
 *     → 恒 0 行 → PartialDeleteError → 整体 ROLLBACK（连第一条也被撤销）
 *   - T1012 快照制把 deck_id 语义从 character_deck.id 漂移为 player_cards.id，
 *     而 T053 仍按 character_deck.id 使用 → 第一条就匹配 0 行
 *   - 牌库快照 battle:{id}:deck:{cid} 从写入起就只读不删，「牌库消耗」从未实现
 *
 * 现在的语义（用户 T1018 决策，两级扣减）：
 *   - 对局内：扣对局牌库（Redis 快照）+ 记消耗清单 → 防止同一张牌本局被多次消耗
 *   - 对局外：对局结束时按消耗清单扣 player_cards 库存（cardConsumptionService）
 *
 * best-effort: 不抛错给上层（出牌效果已结算，不能因扣减失败回滚整个操作）
 *
 * @param battleId 对局 id
 * @param characterId 当前 actor characterId
 * @param handCard 客户端传的手牌对象 (含 card_id / deck_id / source)
 * @returns { consumed: boolean, reason?: string }
 */
async function consumePlayerCard(
  battleId: string,
  characterId: string,
  handCard: HandCard
): Promise<{ consumed: boolean; reason?: string }> {
  try {
    const result = await consumeDeckCardOnPlay(
      battleId,
      characterId,
      handCard.card_id,
      handCard.deck_id,
      handCard.source
    );

    if (result.ok) {
      return {
        consumed: true,
        reason: result.deckRemoved ? 'deck_removed' : 'recorded_only',
      };
    }
    if (result.reason === 'public_pool') {
      // 公共池卡：无限复用，不入库存、不扣牌库（specs.md §3.5）
      return { consumed: false, reason: 'public_pool' };
    }
    console.warn(
      `[consumePlayerCard] ${result.reason}: charId=${characterId} ` +
        `deckId=${handCard.deck_id} cardId=${handCard.card_id} ` +
        `detail=${result.detail ?? ''}`
    );
    return { consumed: false, reason: result.reason };
  } catch (err) {
    // best-effort 兜底：出牌效果已结算，扣减失败不能冒泡打断整个操作
    console.error(
      `[consumePlayerCard] failed: charId=${characterId} ` +
        `deckId=${handCard.deck_id} cardId=${handCard.card_id} ` +
        `error=${(err as Error).message}`
    );
    return { consumed: false, reason: 'error' };
  }
}

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
  // 1. 读 session（Redis 主存，含完整 activationOrder）
  const session = await getSessionState(battleId);
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
    validation = await validateAOEAttack(
      battleId,
      characterId,
      handCard.card_id,
      handCard.source,
      session.currentRound
    );
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
    const pieceRaw = await redisClient.hGet(redisKey.pieces(battleId), characterId);
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

  // 8. 删手牌（STRING JSON 数组 → 读-过滤-覆盖写，不能 lRem）
  try {
    const remaining = await removeCardFromHand(battleId, characterId, handCard.deck_id);
    if (remaining === null) {
      return { success: false, error: 'side_effect_failed', detail: 'card not in hand' };
    }
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

  // 9.5 ★ T1018: 对局内消耗（扣对局牌库 + 记本局消耗清单，best-effort，失败不返错）
  //     库存（player_cards）的扣减延后到对局结束时统一执行，见 cardConsumptionService
  await consumePlayerCard(battleId, characterId, handCard);

  // 10. 广播
  await broadcastHandState(io, battleId, userId, characterId);
  await broadcastCharacterStatus(io, battleId, characterId);

  // 11-12. T051 wire-up: 阶段推进统一交给 executeEndStep
  //   executeEndStep 内部负责 completePlayPhase(play→end_step) → retain → endCurrentStep → activate → draw
  //   移除 executePlayCard 内独立 completePlayPhase，避免与 executeEndStep 双重推进 / phase 校验冲突
  //   失败由 socketServer 兜底（log + 不 emit，因为 T050 本无成功 emit）
  await executeEndStep(io, battleId);

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
  battleId: string,
  userId?: string
): Promise<StepEndResult> {
  // 0. ★ T052: 捕获 preStepAliveMap（applyKillStars 步骤 12 比对用）
  //    必须在任何可能改变 is_alive 的副作用之前完成快照
  const characters = await listCharactersInBattle(battleId);
  const preStepAliveMap: Record<string, boolean> = {};
  if (characters.length > 0) {
    const piecesRaw = await redisClient.hGetAll(redisKey.pieces(battleId));
    for (const c of characters) {
      const raw = piecesRaw[c.characterId];
      if (raw) {
        preStepAliveMap[c.characterId] = JSON.parse(raw).is_alive === true;
      }
    }
  }

  // 1. 读 session（Redis 主存，含完整 activationOrder）
  const state = await getSessionState(battleId);
  if (!state) {
    throw new Error(`executeEndStep: session not found: ${battleId}`);
  }

  // 2. phase check
  if (state.currentPhase !== 'play' && state.currentPhase !== 'move') {
    return { success: false, error: 'not_in_play_or_move_phase' };
  }

  // 2.25 actor 归属校验（T-FIX: 防止对手替当前 actor 跳过回合）
  //    仅当调用方传了 userId（skip_play 路径）时校验；executePlayCard 级联调用不传
  if (userId) {
    if (!state.currentActorId) {
      return { success: false, error: 'not_current_actor' };
    }
    const chars = characters.find((c) => c.characterId === state.currentActorId);
    if (!chars || chars.userId !== userId) {
      return { success: false, error: 'not_current_actor' };
    }
  }

  // 2.5 统一阶段：move/play → end_step
  //    - 若当前在 move 阶段（skip 路径直接触发）：先 completeMovePhase → play
  //    - 再 completePlayPhase → end_step（确保 endCurrentStep 的 assertPhase('end_step') 通过）
  if (state.currentPhase === 'move') {
    try {
      const m = await completeMovePhase(battleId);
      if (!m.success) {
        return { success: false, error: 'complete_phase_failed', detail: m.error };
      }
    } catch (err) {
      return { success: false, error: 'complete_phase_failed', detail: (err as Error).message };
    }
  }
  try {
    const p = await completePlayPhase(battleId);
    if (!p.success) {
      return { success: false, error: 'complete_phase_failed', detail: p.error };
    }
  } catch (err) {
    return { success: false, error: 'complete_phase_failed', detail: (err as Error).message };
  }

  // 3. retain 手牌（自动保留，如手牌为空传 null）
  //    ★ T1014 修正: 公共池卡不可保留（retainHandOnStepEnd 路径 3 会失败），
  //    优先保留首张非公共池卡；全是公共池/空手牌 -> null（全弃）。
  //    旧实现盲取 hand[0]，纯公共池手牌（空卡组棋子常态）下 skip/超时推进必失败
  try {
    const hand = await getActorHand(battleId, state.currentActorId!);
    const retainable = hand.find((c) => c.source !== 'public_pool');
    const retainDeckId = retainable?.deck_id ?? null;
    const retainResult = await retainHandOnStepEnd(battleId, state.currentActorId!, retainDeckId);
    if (!retainResult.success) {
      return { success: false, error: 'retain_failed', detail: retainResult.error };
    }
  } catch (err) {
    return { success: false, error: 'retain_failed', detail: (err as Error).message };
  }

  // 4. 判断是否本轮最后一步（动态取 activationOrder.length，替代硬编码 5）
  const totalSteps = state.activationOrder?.length ?? 6;
  const isLastStepInRound = state.currentStep >= totalSteps - 1;

  // 5. endCurrentStep（end_step → 非最后一步 idle+actor 切换 / 最后一步 end_round）
  let stepEndedRound = false;
  try {
    const r = await endCurrentStep(battleId);
    if (!r.success) {
      return { success: false, error: 'end_step_failed', detail: r.error };
    }
    // endCurrentStep 命中最后一步时 phase → end_round
    stepEndedRound = r.state?.currentPhase === 'end_round';
  } catch (err) {
    return { success: false, error: 'end_step_failed', detail: (err as Error).message };
  }

  // 6. 若本轮结束 → executeRoundEnd（burn tick + endCurrentRound + 据点 star）
  if (stepEndedRound || isLastStepInRound) {
    try {
      await executeRoundEnd(io, battleId, state as BattleSessionState);
    } catch (err) {
      return { success: false, error: 'round_end_failed', detail: (err as Error).message };
    }
    // executeRoundEnd 已广播新 round 的 session + board；此处直接返回
    // （executeRoundEnd 内部做 endCurrentRound + 广播，无需再走 activate/draw）
    const newState = await getSessionState(battleId);
    if (!newState) {
      throw new Error(`executeEndStep: post-round state read failed: ${battleId}`);
    }
    return { success: true, state: newState };
  }

  // 6.5 activateCurrentUnit（idle → draw）
  try {
    const r = await activateCurrentUnit(battleId);
    if (!r.success) {
      return { success: false, error: 'activate_failed', detail: r.error };
    }
  } catch (err) {
    return { success: false, error: 'activate_failed', detail: (err as Error).message };
  }

  // 7. drawCards (新 actor)
  const updatedState = await getSessionState(battleId);
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

  // 8. completeDrawPhase（draw → move）
  try {
    const r = await completeDrawPhase(battleId);
    if (!r.success) {
      return { success: false, error: 'complete_phase_failed', detail: r.error };
    }
  } catch (err) {
    return { success: false, error: 'complete_phase_failed', detail: (err as Error).message };
  }

  // 9. 末尾重读 session
  const finalState = await getSessionState(battleId);
  if (!finalState) {
    throw new Error(`executeEndStep: final state read failed: ${battleId}`);
  }

  // 10-11. 广播
  await broadcastSessionState(io, battleId, finalState);
  await broadcastBoardState(io, battleId);

  // 12. ★ T052 wire-up: applyKillStars → checkWinCondition → recordVictory (win/draw)
  await applyKillStars(battleId, preStepAliveMap);
  const winResult = await checkWinCondition(battleId);
  if (winResult.status === 'win' || winResult.status === 'draw') {
    await recordVictory(io, battleId, winResult, 'kill');
  }

  return { success: true, state: finalState };
}

export async function executeRoundEnd(
  io: IOServer,
  battleId: string,
  stateBefore: BattleSessionState
): Promise<void> {
  // 1. 给所有 6 角色结算 burn 伤害（并行，独立查询）
  const characters = await listCharactersInBattle(battleId);
  await Promise.all(
    characters.map((c) =>
      tickBurnDamageOnTarget(battleId, c.characterId, stateBefore.currentRound)
    )
  );

  // 2. tick 所有 effect（每个角色一次，顺序执行 — tickEffects 改 state）
  for (const c of characters) {
    await tickEffects(battleId, c.characterId, stateBefore.currentRound);
  }

  // 3. endCurrentRound
  const r = await endCurrentRound(battleId);
  if (!r.success) {
    throw new Error(`executeRoundEnd: endCurrentRound failed: ${r.error ?? 'unknown'}`);
  }

  // 4-5. 重读 + 广播
  const newState = await getSessionState(battleId);
  if (!newState) {
    throw new Error(`executeRoundEnd: state read failed: ${battleId}`);
  }
  await broadcastSessionState(io, battleId, newState);
  await broadcastBoardState(io, battleId);

  // 6. ★ T052 wire-up: applyBaseStars → checkWinCondition → recordVictory (win/draw)
  await applyBaseStars(battleId);
  const winResult = await checkWinCondition(battleId);
  if (winResult.status === 'win' || winResult.status === 'draw') {
    await recordVictory(io, battleId, winResult, 'base');
  }

  // 7. ★ T-FIX(战棋死锁): 无胜负时激活新回合首 actor (idle -> 抽牌 -> move)
  //    endCurrentRound 把 phase 重置为 idle 后若无人推进，新回合第 0 步会永远停在
  //    「待机」；executeEndStep 对最后一步提前 return，激活只能在这里做
  if (winResult.status !== 'win' && winResult.status !== 'draw') {
    await activateActorForStep(io, battleId, { draw: true });
  }
}

/**
 * T-FIX(战棋死锁): 激活当前步骤的 actor (idle -> draw -> move) + 广播
 *
 * 两个调用点：
 *   - initBattleField 步骤 6.5：战斗开始首步激活（draw=false，初始手牌已由 init 步骤 4 发放）
 *   - executeRoundEnd 步骤 7：新回合首步激活（draw=true，跨回合需要给新 actor 发手牌）
 *
 * @param options.draw 是否为新 actor 抽牌（drawCards 覆盖式写手牌，重复抽会顶掉已有手牌）
 * @throws 任一阶段推进失败时抛错（调用方自行决定回滚/记录）
 */
export async function activateActorForStep(
  io: IOServer,
  battleId: string,
  options: { draw?: boolean } = {}
): Promise<void> {
  // 1. idle -> draw
  const r = await activateCurrentUnit(battleId);
  if (!r.success) {
    throw new Error(`activateActorForStep: activate failed: ${r.error ?? 'unknown'}`);
  }

  // 2. 抽牌（仅回合切换路径）
  if (options.draw && r.state?.currentActorId) {
    const d = await drawCards(battleId, r.state.currentActorId);
    if (!d.success) {
      throw new Error(`activateActorForStep: draw failed: ${d.error ?? 'unknown'}`);
    }
  }

  // 3. draw -> move
  const c = await completeDrawPhase(battleId);
  if (!c.success) {
    throw new Error(`activateActorForStep: completeDrawPhase failed: ${c.error ?? 'unknown'}`);
  }

  // 4. 广播（c.state 缺失时重读一次 session 兜底）
  const finalState = c.state ?? await getSessionState(battleId);
  if (!finalState) {
    throw new Error('activateActorForStep: final state read failed');
  }
  await broadcastSessionState(io, battleId, finalState);
  await broadcastBoardState(io, battleId);
}
