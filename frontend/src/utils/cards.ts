// ========================================
// 卡牌展示辅助（中文化摘要 + 类型元数据）
// 对齐后端 card_templates.effect (JSONB) 的运行时结构
// 后端 7+1 张卡 effect:
//   轻击 {damage:2} / 重击 {damage:4} / 精准射击 {damage:3,range:3} / 火球术 {damage:3,aoe:true}
//   防御 {shield:3} / 治疗 {heal:3} / 移动 {movement:1}
//   挑战 {type:'taunt',range:3,duration:1,target:'single_enemy'}
// HandCard 运行时不带 description, 故由 effect 派生摘要
// ========================================
import type { CardType, HandCard, CharacterStatus } from '@/types';

export const CARD_TYPE_META: Record<CardType, { label: string; color: string }> = {
  attack: { label: '攻击', color: 'var(--danger)' },
  defense: { label: '防御', color: 'var(--accent)' },
  tactical: { label: '战术', color: 'var(--success)' },
};

/**
 * 把卡牌 effect (JSONB) 解析成中文摘要，用于手牌/卡牌展示。
 * 未识别结构兜底返回 JSON 字符串，避免空白。
 */
export function effectSummary(effect: Record<string, unknown>): string {
  const e = effect as {
    damage?: number;
    aoe?: boolean;
    range?: number;
    shield?: number;
    heal?: number;
    movement?: number;
    type?: string;
    duration?: number;
    target?: string;
  };

  // 嘲讽（战术卡，effect.type='taunt'）
  if (e.type === 'taunt') {
    const range = e.range ? ` (射程 ${e.range})` : '';
    return `嘲讽敌方${range}`;
  }

  // 伤害（攻击卡）
  if (typeof e.damage === 'number') {
    if (e.aoe) return `造成 ${e.damage} 范围伤害`;
    if (e.range) return `造成 ${e.damage} 伤害 (射程 ${e.range})`;
    return `造成 ${e.damage} 伤害`;
  }

  // 护盾（防御卡）
  if (typeof e.shield === 'number') return `获得 ${e.shield} 护盾`;

  // 治疗（战术卡）
  if (typeof e.heal === 'number') return `恢复 ${e.heal} 生命`;

  // 移动（战术卡）
  if (typeof e.movement === 'number') return `移动 ${e.movement} 格`;

  // 兜底
  return JSON.stringify(effect);
}

// ========================================
// 打牌交互辅助 (T072)
// 后端 executePlayCard dispatch (battleActionService T050):
//   attack + effect.aoe  -> validateAOEAttack (无需目标, 自动命中射程内全部敌方)
//   attack (无 aoe)      -> validateAttack    (需 targetId)
//   tactical + taunt     -> validateTauntCard (需 targetId, warrior 专用)
//   其余 (defense/heal/movement) -> unsupported_card_type (T050 暂不支持)
// 射程规则 (对齐 validateAttack / validateTauntCard):
//   近战(无 range 或 range===1): 欧氏距离 <= 1.5
//   远程: 欧氏距离 <= effect.range
//   嘲讽: 欧氏距离 <= effect.range ?? 3
// 客户端范围仅 UX 提示, 服务端再校验, 不匹配回 battle:play_card:error 优雅降级
// (嘲讽强制目标等边界由服务端 getTauntRedirect 强制, 客户端不建模)
// ========================================

/** 是否需要选择目标 (单体攻击 / 嘲讽) */
export function cardNeedsTarget(card: HandCard): boolean {
  if (card.type === 'attack' && !(card.effect as { aoe?: boolean }).aoe) return true;
  if (card.type === 'tactical' && (card.effect as { type?: string }).type === 'taunt') return true;
  return false;
}

/** 是否为 AOE 攻击 (无需选目标, 自动命中射程内全部敌方) */
export function cardIsAOE(card: HandCard): boolean {
  return card.type === 'attack' && !!(card.effect as { aoe?: boolean }).aoe;
}

/** 后端 T050 是否支持此卡 (attack 单体/AOE + tactical 嘲讽); defense/heal/movement 暂不支持 */
export function cardSupported(card: HandCard): boolean {
  return cardNeedsTarget(card) || cardIsAOE(card);
}

/**
 * 计算打牌可选目标 (仅 needsTarget 卡: 单体攻击 / 嘲讽)。
 * 规则: 敌方(非己方) + 存活 + 在射程内。
 * @returns 可目标 characterId 列表
 */
export function computeCardTargets(
  actor: CharacterStatus,
  characters: CharacterStatus[],
  ownIds: string[],
  card: HandCard
): string[] {
  if (!actor.position) return [];
  const isTaunt = card.type === 'tactical' && (card.effect as { type?: string }).type === 'taunt';
  const effRange = (card.effect as { range?: number }).range;
  // 近战(攻击卡无 range 或 range===1) -> 1.5; 嘲讽 -> range ?? 3; 远程 -> range
  const isMelee = !isTaunt && (!effRange || effRange === 1);
  const maxDist = isMelee ? 1.5 : (effRange ?? 3);

  const targets: string[] = [];
  for (const c of characters) {
    if (ownIds.includes(c.characterId)) continue; // 仅敌方
    if (!c.isAlive) continue;
    if (!c.position) continue;
    const d = Math.hypot(actor.position.x - c.position.x, actor.position.y - c.position.y);
    if (d <= maxDist) targets.push(c.characterId);
  }
  return targets;
}
