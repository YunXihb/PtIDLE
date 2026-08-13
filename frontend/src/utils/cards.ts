// ========================================
// 卡牌展示辅助（中文化摘要 + 类型元数据）
// 对齐后端 card_templates.effect (JSONB) 的运行时结构
// 后端 7+1 张卡 effect:
//   轻击 {damage:2} / 重击 {damage:4} / 精准射击 {damage:3,range:3} / 火球术 {damage:3,aoe:true}
//   防御 {shield:3} / 治疗 {heal:3} / 移动 {movement:1}
//   挑战 {type:'taunt',range:3,duration:1,target:'single_enemy'}
// HandCard 运行时不带 description, 故由 effect 派生摘要
// ========================================
import type { CardType } from '@/types';

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
