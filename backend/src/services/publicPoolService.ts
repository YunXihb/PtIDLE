// ========================================
// 公共池服务 (Public Pool Service) - T1001
// ========================================
// 战棋公共池：内置一套通用基础攻击卡（轻击），无限复用
// 用途：棋子牌库不足 3 张时，drawCards 自动从公共池补足
//
// 设计要点：
// - 公共池卡不入 player_cards，无归属
// - 公共池卡打出后回池（不进入弃牌堆或保留）
// - warrior 攻击累计护盾不计入公共池卡
//
// Redis 不存储公共池卡状态（无限复用 = 无库存）

import { getPublicPoolCards } from './cardService';
import { HandCard } from './handService';

/**
 * 公共池虚拟 deck_id 前缀（与 character_deck.id 区分）
 * 用 `pool:<template_no>` 形式，确保唯一性
 */
function makePublicDeckId(templateNo: number): string {
  return `pool:${templateNo}`;
}

/**
 * 从公共池抽取 N 张「轻击」HandCard
 * - 当前公共池仅 1 张轻击，所以需要 N 张时返回 N 份独立 HandCard
 * - 每张 deck_id 相同（pool:1），但 card_id 也相同
 *   → 客户端在打牌时按 source='public_pool' 路由到 validateAttack 公共池分支
 * - HandCard 缺 type 字段在 toHandCard 路径下补齐（公共池卡已知是 attack）
 *
 * @param need 需要抽的张数
 * @returns 公共池 HandCard 数组（长度 = need）
 */
export async function drawFromPublicPool(need: number): Promise<HandCard[]> {
  if (need <= 0) {
    return [];
  }
  const pool = await getPublicPoolCards();
  if (pool.length === 0) {
    return [];
  }
  // 当前公共池只含「轻击」一种；如果未来扩展多种，需要按 type 或其他策略分配
  const card = pool[0];
  const cards: HandCard[] = [];
  for (let i = 0; i < need; i++) {
    cards.push({
      deck_id: makePublicDeckId(card.template_no),
      card_id: card.id,             // 卡牌模板 ID（无 player_cards 实例）
      name: card.name,
      type: card.type,
      cost: card.cost,
      effect: card.effect,
      template_no: card.template_no,
      source: 'public_pool',
    });
  }
  return cards;
}

/**
 * 判断 deck_id 是否为公共池卡（前端 / 校验用）
 */
export function isPublicPoolDeckId(deckId: string): boolean {
  return deckId.startsWith('pool:');
}
