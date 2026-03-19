import { query } from '../config/database';

export interface CardTemplate {
  id: string;
  name: string;
  description: string | null;
  type: 'attack' | 'defense' | 'tactical';
  cost: number;
  effect: Record<string, unknown>;
  profession: string | null; // 'warrior', 'ranger', 'mage', or 'common'
  template_no: number;        // 卡牌模板固定编码
  max_quantity: number;       // 单组卡牌数量上限，默认5
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
    template_no: number;
    max_quantity: number;
  }>('SELECT id, name, description, type, cost, effect, profession, template_no, max_quantity FROM card_templates ORDER BY template_no');

  const cardTemplates: CardTemplate[] = result.map(row => ({
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type,
    cost: row.cost,
    effect: row.effect,
    profession: row.profession,
    template_no: row.template_no,
    max_quantity: row.max_quantity,
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

// ========================================
// 玩家卡牌查询（player_cards 表）
// ========================================

export interface PlayerCard {
  id: string;
  player_id: string;
  card_template_id: string | null;
  template_no: number;        // 卡牌模板固定编码（No.1, No.2...）
  card_sequence: number;      // 该玩家拥有该种卡牌的序号
  name: string;
  type: 'attack' | 'defense' | 'tactical';
  cost: number;
  effect: Record<string, unknown>;
  quantity: number;
  created_at: Date;
}

export interface PlayerCardsResult {
  cards: PlayerCard[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface GetPlayerCardsOptions {
  playerId: string;
  page?: number;
  pageSize?: number;
}

/**
 * 根据玩家 ID 获取该玩家拥有的所有卡牌（支持分页）
 * 按 template_no 和 card_sequence 自动排列
 */
export async function getPlayerCards(options: GetPlayerCardsOptions): Promise<PlayerCardsResult> {
  const { playerId, page = 1, pageSize = 50 } = options;

  // 验证参数
  const validPage = Math.max(1, page);
  const validPageSize = Math.min(Math.max(1, pageSize), 100); // 限制最大100
  const offset = (validPage - 1) * validPageSize;

  try {
    // 查询总数
    const countResult = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM player_cards WHERE player_id = $1',
      [playerId]
    );
    const total = parseInt(countResult[0]?.count || '0', 10);

    // 查询卡牌列表（按 template_no 和 card_sequence 排序）
    const result = await query<{
      id: string;
      player_id: string;
      card_template_id: string | null;
      template_no: number;
      card_sequence: number;
      name: string;
      type: 'attack' | 'defense' | 'tactical';
      cost: number;
      effect: Record<string, unknown>;
      quantity: number;
      created_at: Date;
    }>(
      `SELECT pc.id, pc.player_id, pc.card_template_id,
              COALESCE(ct.template_no, 0) as template_no,
              COALESCE(pc.card_sequence, 0) as card_sequence,
              pc.name, pc.type, pc.cost, pc.effect, pc.quantity, pc.created_at
       FROM player_cards pc
       LEFT JOIN card_templates ct ON pc.card_template_id = ct.id
       WHERE pc.player_id = $1
       ORDER BY template_no ASC, card_sequence ASC
       LIMIT $2 OFFSET $3`,
      [playerId, validPageSize, offset]
    );

    const cards: PlayerCard[] = result.map(row => ({
      id: row.id,
      player_id: row.player_id,
      card_template_id: row.card_template_id,
      template_no: row.template_no,
      card_sequence: row.card_sequence,
      name: row.name,
      type: row.type,
      cost: row.cost,
      effect: row.effect,
      quantity: row.quantity,
      created_at: row.created_at,
    }));

    return {
      cards,
      total,
      page: validPage,
      pageSize: validPageSize,
      totalPages: Math.ceil(total / validPageSize),
    };
  } catch (error) {
    console.error('Error fetching player cards:', error);
    throw error;
  }
}
