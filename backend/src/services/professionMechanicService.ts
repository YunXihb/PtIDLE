// ========================================
// 职业机制服务 (Profession Mechanic Service) - T039
// ========================================
// 1) 职业卡牌权限校验（deck 分配 + 战斗内打牌）
// 2) Warrior 机制 1：攻击累计护盾（每 2 张攻击卡 → 累计 cost 总和护盾，2 round）
// 3) Warrior 机制 2：嘲讽（写入 statusEffectService，由 battleService.validateAttack 读取）
// 4) Warrior 私有计数器：battle:{id}:warrior_status:{warrior_id}（JSON STRING）
//
// T040/T041 在本文件内加 rangerMechanic / mageMechanic 命名空间

import { redisClient } from '../config/redis';
import { query } from '../config/database';
import {
  applyEffect,
  getActiveEffects,
  removeEffect,
  sumActiveShield,
  StatusEffect,
} from './statusEffectService';

// ========================================
// 公共类型
// ========================================

export type CharacterProfession = 'warrior' | 'ranger' | 'mage';
export type CardProfession = 'warrior' | 'ranger' | 'mage' | 'common';

export interface ProfessionValidationResult {
  valid: boolean;
  error?: string;
}

export interface CharacterProfessionInfo {
  id: string;
  profession: CharacterProfession;
  is_alive: boolean;
  health: number;
  max_health: number;
  position_x: number | null;
  position_y: number | null;
  player_id: string;
}

// ========================================
// 1. 权限 API
// ========================================

/**
 * 职业-卡牌匹配判断
 * - common 卡：所有职业都能用
 * - 专属卡：只有对应职业能用
 * - null/不匹配：返回 false
 */
export function canUseProfession(
  characterProfession: string | null | undefined,
  cardProfession: string | null | undefined
): boolean {
  if (!characterProfession || !cardProfession) {
    return false;
  }
  if (cardProfession === 'common') {
    return true;
  }
  return characterProfession === cardProfession;
}

/**
 * 从 player_cards JOIN card_templates 获取卡牌 profession
 */
export async function getCardProfession(
  playerCardId: string
): Promise<CardProfession | null> {
  const result = await query<{ profession: string | null }>(
    `SELECT ct.profession
     FROM player_cards pc
     LEFT JOIN card_templates ct ON pc.card_template_id = ct.id
     WHERE pc.id = $1`,
    [playerCardId]
  );
  if (!result || result.length === 0 || !result[0].profession) {
    return null;
  }
  return result[0].profession as CardProfession;
}

/**
 * 从 characters 表获取棋子 profession
 */
export async function getCharacterProfession(
  characterId: string
): Promise<CharacterProfession | null> {
  const result = await query<{ profession: string }>(
    'SELECT profession FROM characters WHERE id = $1',
    [characterId]
  );
  if (!result || result.length === 0) {
    return null;
  }
  const p = result[0].profession;
  if (p === 'warrior' || p === 'ranger' || p === 'mage') {
    return p;
  }
  return null;
}

/**
 * 校验牌组分配（assignCardToCharacter 路径）
 * - 角色存在
 * - 角色 profession 与卡牌 profession 匹配
 */
export async function validateCardForDeckAssignment(
  characterId: string,
  playerCardId: string
): Promise<ProfessionValidationResult> {
  const charProf = await getCharacterProfession(characterId);
  if (!charProf) {
    return { valid: true }; // 角色不存在性检查留给调用方
  }
  const cardProf = await getCardProfession(playerCardId);
  if (!cardProf) {
    return { valid: true }; // 卡牌不存在性检查留给调用方
  }
  if (!canUseProfession(charProf, cardProf)) {
    return {
      valid: false,
      error: `Character profession '${charProf}' cannot use card profession '${cardProf}'`,
    };
  }
  return { valid: true };
}

/**
 * 校验战斗内出牌（validateAttack / validateAOEAttack 路径）
 * - 角色存在
 * - 角色 profession 与卡牌 profession 匹配
 */
export async function validateCardForCombat(
  characterId: string,
  playerCardId: string
): Promise<ProfessionValidationResult> {
  return validateCardForDeckAssignment(characterId, playerCardId);
}

// ========================================
// 2. Warrior 私有状态（counter + cost buffer）
// ========================================

interface WarriorStatus {
  attack_counter: number;
  attack_cost_buffer: number[];
}

function getWarriorStatusKey(battleId: string, warriorId: string): string {
  return `battle:${battleId}:warrior_status:${warriorId}`;
}

async function readWarriorStatus(
  battleId: string,
  warriorId: string
): Promise<WarriorStatus> {
  const raw = await redisClient.get(getWarriorStatusKey(battleId, warriorId));
  if (!raw) {
    return { attack_counter: 0, attack_cost_buffer: [] };
  }
  try {
    return JSON.parse(raw) as WarriorStatus;
  } catch {
    return { attack_counter: 0, attack_cost_buffer: [] };
  }
}

async function writeWarriorStatus(
  battleId: string,
  warriorId: string,
  status: WarriorStatus
): Promise<void> {
  await redisClient.set(
    getWarriorStatusKey(battleId, warriorId),
    JSON.stringify(status)
  );
}

// ========================================
// 3. Warrior 机制 1：攻击累计护盾
// ========================================

export interface WarriorAttackCardResult {
  attackCounter: number;
  shieldGained: number;
  totalShield: number;
}

/**
 * warrior 出攻击卡后调用
 * - 累加 attack_counter
 * - 累加 attack_cost_buffer
 * - 触发判断：counter >= 2 → 累加 cost 总和作为 shield effect (duration 2 round)
 * - 触发后重置 counter 和 buffer
 */
export async function onWarriorAttackCardPlayed(
  battleId: string,
  warriorId: string,
  cardCost: number,
  currentRound: number
): Promise<WarriorAttackCardResult> {
  const status = await readWarriorStatus(battleId, warriorId);
  status.attack_counter += 1;
  status.attack_cost_buffer.push(cardCost);

  let shieldGained = 0;
  if (status.attack_counter >= 2) {
    // 取最近 2 张的 cost 之和
    const lastTwo = status.attack_cost_buffer.slice(-2);
    shieldGained = lastTwo.reduce((a, b) => a + b, 0);

    if (shieldGained > 0) {
      await applyEffect(battleId, warriorId, {
        type: 'shield',
        value: shieldGained,
        duration_rounds: 2,
        currentRound,
      });
    }
    // 重置
    status.attack_counter = 0;
    status.attack_cost_buffer = [];
  }

  await writeWarriorStatus(battleId, warriorId, status);

  // 计算总护盾
  const totalShield = await sumActiveShield(battleId, warriorId, currentRound);

  return {
    attackCounter: status.attack_counter,
    shieldGained,
    totalShield,
  };
}

// ========================================
// 4. Warrior 机制 2：嘲讽
// ========================================

export interface WarriorTauntResult {
  success: boolean;
  error?: string;
}

export interface TauntRedirectInfo {
  mustRedirectTo: string | null;
  sourceId: string | null;
}

/**
 * 校验并应用嘲讽
 * - target 必须在 range 内（用 euclidean distance）
 * - target 必须存活 + 是 enemy
 */
export async function applyWarriorTaunt(
  battleId: string,
  warriorId: string,
  targetId: string,
  range: number,
  currentRound: number,
  getPosition: (battleId: string, charId: string) => Promise<{ x: number; y: number } | null>,
  getPiece: (battleId: string, charId: string) => Promise<CharacterProfessionInfo | null>
): Promise<WarriorTauntResult> {
  // 1. 目标存在 + alive
  const target = await getPiece(battleId, targetId);
  if (!target) {
    return { success: false, error: 'Taunt target not found' };
  }
  if (!target.is_alive) {
    return { success: false, error: 'Taunt target is not alive' };
  }

  // 2. 距离检查
  const warriorPos = await getPosition(battleId, warriorId);
  const targetPos = await getPosition(battleId, targetId);
  if (!warriorPos || !targetPos) {
    return { success: false, error: 'Position not found for taunt' };
  }
  const dx = warriorPos.x - targetPos.x;
  const dy = warriorPos.y - targetPos.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > range) {
    return {
      success: false,
      error: `Taunt target out of range (range: ${range}, actual: ${dist.toFixed(2)})`,
    };
  }

  // 3. 写入 taunt effect（target 被嘲讽，必须攻击 warrior）
  // 后者覆盖：先移除同源 taunt（这里简化：每 warrior 一份 taunt）
  await removeTauntFromSource(battleId, targetId, warriorId);
  await applyEffect(battleId, targetId, {
    type: 'taunt',
    value: range,
    duration_rounds: 1,
    source_id: warriorId,
    target_id: warriorId,
    currentRound,
  });

  return { success: true };
}

/**
 * 移除由指定 source 写入的 taunt effect（用于「同源覆盖」语义）
 * 注意：直接读 raw LIST，不计过期（因为 getActiveEffects 会过滤 expire）
 */
async function removeTauntFromSource(
  battleId: string,
  targetId: string,
  sourceId: string
): Promise<void> {
  const key = `battle:${battleId}:effects:${targetId}`;
  const all = await redisClient.lRange(key, 0, -1);
  for (const raw of all) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed.type === 'taunt' && parsed.source_id === sourceId) {
        await redisClient.lRem(key, 0, raw);
      }
    } catch {
      // 损坏 JSON 跳过
    }
  }
}

/**
 * 读取 taunt 重定向信息
 * - 从 target 的 active effects 找 taunt
 * - 若找到，返回 mustRedirectTo = taunt.target_id（即 warrior）
 */
export async function getTauntRedirect(
  battleId: string,
  attackerId: string,
  intendedTargetId: string,
  currentRound: number
): Promise<TauntRedirectInfo> {
  const effects = await getActiveEffects(battleId, intendedTargetId, currentRound);
  const taunt = effects.find(
    (e: StatusEffect) => e.type === 'taunt' && !!e.target_id
  );
  if (taunt && taunt.target_id && taunt.target_id !== attackerId) {
    return {
      mustRedirectTo: taunt.target_id,
      sourceId: taunt.source_id ?? null,
    };
  }
  return { mustRedirectTo: null, sourceId: null };
}
