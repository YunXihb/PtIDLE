// ========================================
// 状态效果服务 (Status Effect Service) - T039
// ========================================
// 通用状态效果框架：warrior 护盾 / 嘲讽，后续扩展 stun/blind/silence
// 存储：Redis LIST（每场战斗一个 key，每个角色一个 sub-key）
// Key: `battle:{battleId}:effects:{characterId}`
// Value: LIST of JSON-stringified StatusEffect
//
// 不引入缓存（status effect 频次低，生命周期 = 战斗 session）

import { randomUUID } from 'crypto';
import { redisClient } from '../config/redis';

// ========================================
// 类型定义
// ========================================

export type StatusEffectType =
  | 'shield'        // 护盾（warrior 攻击累计）
  | 'taunt'         // 嘲讽（warrior 挑战卡）
  | 'damage_boost'  // 攻击累计增伤（ranger 机制 1）
  | 'stun'          // 眩晕（T040+ 扩展）
  | 'blind'         // 致盲（T040+ 扩展）
  | 'silence'       // 沉默（T040+ 扩展）
  | 'burn'          // 灼烧（T040+ 扩展）
  | 'regen';        // 持续回血（T040+ 扩展）

export interface StatusEffect {
  type: StatusEffectType;
  value?: number;          // shield amount, taunt range 等数值
  duration_rounds: number; // 持续 N 个 battle round
  source_id?: string;      // 来源 (taunt 的来源战士)
  target_id?: string;      // 影响目标（taunt 强制目标 → 攻击 warrior）
  expire_round: number;    // 过期 battle round 号
  created_round: number;   // 创建时的 round 号
  effect_id: string;       // UUID, 用于精确 remove
}

/**
 * 获取状态效果 Redis key
 */
function getEffectsKey(battleId: string, characterId: string): string {
  return `battle:${battleId}:effects:${characterId}`;
}

// ========================================
// 公共 API
// ========================================

/**
 * 应用状态效果（RPUSH 追加）
 * @param battleId 对战 ID
 * @param characterId 棋子 ID
 * @param effect 不含 effect_id / created_round / expire_round 的 effect 描述
 * @returns 完整创建的 StatusEffect（含 effect_id）
 */
export async function applyEffect(
  battleId: string,
  characterId: string,
  effect: Omit<StatusEffect, 'effect_id' | 'created_round' | 'expire_round'> & { currentRound: number }
): Promise<StatusEffect> {
  const fullEffect: StatusEffect = {
    type: effect.type,
    value: effect.value,
    duration_rounds: effect.duration_rounds,
    source_id: effect.source_id,
    target_id: effect.target_id,
    created_round: effect.currentRound,
    expire_round: effect.currentRound + effect.duration_rounds,
    effect_id: randomUUID(),
  };

  const key = getEffectsKey(battleId, characterId);
  await redisClient.rPush(key, JSON.stringify(fullEffect));

  return fullEffect;
}

/**
 * 移除指定 effect（按 effect_id 精确移除）
 * @returns 是否真的删除了一条（false = 该 effect 不存在）
 */
export async function removeEffect(
  battleId: string,
  characterId: string,
  effectId: string
): Promise<boolean> {
  const key = getEffectsKey(battleId, characterId);
  const all = await redisClient.lRange(key, 0, -1);
  for (const raw of all) {
    try {
      const parsed = JSON.parse(raw) as StatusEffect;
      if (parsed.effect_id === effectId) {
        const removed = await redisClient.lRem(key, 0, raw);
        return removed > 0;
      }
    } catch {
      // 损坏 JSON 跳过
    }
  }
  return false;
}

/**
 * 按类型移除所有同类型 effect
 */
export async function removeEffectsByType(
  battleId: string,
  characterId: string,
  type: StatusEffectType
): Promise<number> {
  const key = getEffectsKey(battleId, characterId);
  const all = await redisClient.lRange(key, 0, -1);
  let removed = 0;
  for (const raw of all) {
    try {
      const parsed = JSON.parse(raw) as StatusEffect;
      if (parsed.type === type) {
        const count = await redisClient.lRem(key, 0, raw);
        removed += count;
      }
    } catch {
      // 损坏 JSON 跳过
    }
  }
  return removed;
}

/**
 * 读取当前生效的 effect（过滤 expire_round > currentRound）
 * 损坏 JSON 静默过滤
 */
export async function getActiveEffects(
  battleId: string,
  characterId: string,
  currentRound: number
): Promise<StatusEffect[]> {
  const key = getEffectsKey(battleId, characterId);
  const all = await redisClient.lRange(key, 0, -1);
  const result: StatusEffect[] = [];
  for (const raw of all) {
    try {
      const parsed = JSON.parse(raw) as StatusEffect;
      // expire_round > currentRound 表示尚未过期
      // currentRound 本身仍生效（cur 仍在持续范围内）
      if (parsed.expire_round > currentRound) {
        result.push(parsed);
      }
    } catch {
      // 损坏 JSON 静默过滤
    }
  }
  return result;
}

/**
 * 推进到指定 round，清理过期 effect
 * @returns 被清理的 effect 列表
 */
export async function tickEffects(
  battleId: string,
  characterId: string,
  currentRound: number
): Promise<StatusEffect[]> {
  const key = getEffectsKey(battleId, characterId);
  const all = await redisClient.lRange(key, 0, -1);
  const expired: StatusEffect[] = [];
  for (const raw of all) {
    try {
      const parsed = JSON.parse(raw) as StatusEffect;
      if (parsed.expire_round <= currentRound) {
        const count = await redisClient.lRem(key, 0, raw);
        if (count > 0) {
          expired.push(parsed);
        }
      }
    } catch {
      // 损坏 JSON 一并清理
      await redisClient.lRem(key, 0, raw);
    }
  }
  return expired;
}

/**
 * 清空所有 effect（战斗结束时）
 */
export async function clearEffects(
  battleId: string,
  characterId: string
): Promise<void> {
  const key = getEffectsKey(battleId, characterId);
  await redisClient.del(key);
}

/**
 * 累加当前 active shield 的总护盾值
 */
export async function sumActiveShield(
  battleId: string,
  characterId: string,
  currentRound: number
): Promise<number> {
  const effects = await getActiveEffects(battleId, characterId, currentRound);
  return effects
    .filter(e => e.type === 'shield')
    .reduce((sum, e) => sum + (e.value ?? 0), 0);
}
