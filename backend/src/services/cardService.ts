import { query } from '../config/database';

export interface CardTemplate {
  id: string;
  name: string;
  description: string | null;
  type: 'attack' | 'defense' | 'tactical';
  cost: number;
  effect: Record<string, unknown>;
  profession: string | null; // 'warrior', 'ranger', 'mage', or 'common'
}

// 内存缓存（5分钟过期）
let cardTemplatesCache: {
  data: CardTemplate[];
  timestamp: number;
} | null = null;

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * 从数据库获取所有卡牌模板（带缓存）
 */
export async function getAllCardTemplates(): Promise<CardTemplate[]> {
  const now = Date.now();

  // 检查缓存
  if (cardTemplatesCache && (now - cardTemplatesCache.timestamp) < CACHE_TTL) {
    return cardTemplatesCache.data;
  }

  // 查询数据库
  const result = await query<{
    id: string;
    name: string;
    description: string | null;
    type: 'attack' | 'defense' | 'tactical';
    cost: number;
    effect: Record<string, unknown>;
    profession: string | null;
  }>('SELECT id, name, description, type, cost, effect, profession FROM card_templates ORDER BY name');

  const cardTemplates: CardTemplate[] = result.map(row => ({
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type,
    cost: row.cost,
    effect: row.effect,
    profession: row.profession,
  }));

  // 更新缓存
  cardTemplatesCache = {
    data: cardTemplates,
    timestamp: now,
  };

  return cardTemplates;
}

/**
 * 根据 ID 获取单个卡牌模板
 */
export async function getCardTemplateById(id: string): Promise<CardTemplate | null> {
  const cardTemplates = await getAllCardTemplates();
  return cardTemplates.find(c => c.id === id) || null;
}

/**
 * 根据职业获取卡牌模板
 */
export async function getCardTemplatesByProfession(profession: string): Promise<CardTemplate[]> {
  const cardTemplates = await getAllCardTemplates();
  return cardTemplates.filter(c => c.profession === profession || c.profession === 'common');
}

/**
 * 清除卡牌缓存（用于测试或配置更新时）
 */
export function clearCardTemplatesCache(): void {
  cardTemplatesCache = null;
}
