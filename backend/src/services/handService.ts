import { redisClient } from '../config/redis';
import { getCharacterDeckCards } from './characterService';
import { drawFromPublicPool } from './publicPoolService';

// ========================================
// 类型定义
// ========================================

/**
 * 手牌卡牌来源（T1001）
 * - 'deck': 来自棋子的 character_deck（玩家私有）
 * - 'public_pool': 来自战棋公共池（无限复用，不消耗）
 */
export type HandCardSource = 'deck' | 'public_pool';

/**
 * 手牌卡牌结构（战棋运行时使用的精简卡牌信息）
 * - deck_id: character_deck.id 或 `pool:<template_no>` (T1001 公共池虚拟 ID)
 * - card_id: player_card.id（deck 来源）或 card_template.id（public_pool 来源）
 * - name / type / cost / effect: 卡牌模板数据
 * - template_no: 卡牌种类编号（用于 UI 排序）
 * - source: 卡牌来源（'deck' | 'public_pool'，T1001）
 */
export interface HandCard {
  deck_id: string;
  card_id: string;
  name: string;
  type: 'attack' | 'defense' | 'tactical';
  cost: number;
  effect: Record<string, unknown>;
  template_no: number;
  source: HandCardSource;
}

/**
 * 抽牌结果
 * - drawn_count: **新抽到的牌数**（不含从上回合保留的牌）
 * - retained_from_previous: 上回合保留下来、被合并进本次手牌顶部的牌
 */
export interface DrawCardsResult {
  success: boolean;
  cards?: HandCard[];
  drawn_count: number;
  deck_size: number;
  retained_from_previous?: HandCard;
  error?: string;
}

/**
 * 回合结束保留手牌的结果
 * - retained: 单张保留的牌（null 表示未保留任何牌）
 * - discarded: 进入弃牌堆的牌列表
 * - error: 当 retainDeckId 未在手牌中命中时给出说明
 */
export interface RetainHandResult {
  success: boolean;
  retained: HandCard | null;
  discarded: HandCard[];
  error?: string;
}

// ========================================
// Redis 键
// ========================================

/**
 * Redis 手牌存储 key（当前回合的手牌，STRING 类型，JSON array）
 */
function getHandKey(battleId: string, characterId: string): string {
  return `battle:${battleId}:hand:${characterId}`;
}

/**
 * Redis 跨回合保留牌 key（最多 1 张，STRING 类型，JSON single HandCard）
 */
function getRetainedKey(battleId: string, characterId: string): string {
  return `battle:${battleId}:retained:${characterId}`;
}

/**
 * Redis 弃牌堆 key（LIST 类型，每个元素为 JSON-stringified HandCard，RPUSH 追加）
 */
function getDiscardKey(battleId: string, characterId: string): string {
  return `battle:${battleId}:discard:${characterId}`;
}

// ========================================
// 内部辅助
// ========================================

/**
 * 校验 count 参数：必须是非负整数
 */
function isValidCount(count: number): boolean {
  return Number.isInteger(count) && count >= 0;
}

/**
 * Fisher-Yates 洗牌（原地打乱数组）
 * 使用 crypto-strength 随机数（Math.random 在测试中可控性较差，但本服务为后端逻辑，
 * 实际不影响安全；T037 范围内使用 Math.random 即可，后续可替换为 randomInt 工具）
 */
function shuffleArray<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * 将 character_deck 行映射为 HandCard（去除私有字段，限定 type 联合类型）
 * T1001：source 默认为 'deck'
 */
function toHandCard(row: {
  deck_id: string;
  card_id: string;
  name: string;
  type: string;
  cost: number;
  effect: Record<string, unknown>;
  template_no: number;
}): HandCard {
  return {
    deck_id: row.deck_id,
    card_id: row.card_id,
    name: row.name,
    type: row.type as HandCard['type'],
    cost: row.cost,
    effect: row.effect,
    template_no: row.template_no,
    source: 'deck',
  };
}

/**
 * 内部：读取并消费上回合保留的牌（读到即 DEL）
 * - retained key 不存在 → 返回 null（drawCards 行为完全不变）
 * - 损坏 JSON → 静默忽略 + DEL 清坏数据 → 返回 null
 */
async function consumeRetainedCard(
  battleId: string,
  characterId: string
): Promise<HandCard | null> {
  const key = getRetainedKey(battleId, characterId);
  const data = await redisClient.get(key);
  if (!data) {
    return null;
  }
  await redisClient.del(key);
  try {
    const parsed = JSON.parse(data) as HandCard;
    if (parsed && typeof parsed === 'object' && typeof parsed.deck_id === 'string') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

// ========================================
// 公共 API
// ========================================

/**
 * 1. 抽牌：从棋子的 character_deck 随机抽取 N 张卡牌，存入该棋子本回合的"手牌"
 *
 * 流程（T1001 公共池补足版）：
 * 1. 校验 count 为非负整数
 * 2. 消费上回合保留的牌（如有 retained key 则读取并 DEL）
 * 3. 查询该棋子的完整牌库
 * 4. 实际抽取 = min(count, deckSize)
 * 5. 洗牌 + 取前 N 张 → 映射为 HandCard（source='deck'）
 * 6. 缺额 = count - actualFromDeck → 从公共池补足（source='public_pool'）
 * 7. 公共池抽到的轻击算入 drawn_count（计入本回合抽到的手牌数）
 * 8. 最终手牌 = retained ? [retained, ...drawn] : drawn
 * 9. 写入 Redis 手牌 key
 *
 * @param battleId 战斗 ID
 * @param characterId 棋子 ID
 * @param count 抽取数量（默认 3）
 */
export async function drawCards(
  battleId: string,
  characterId: string,
  count: number = 3
): Promise<DrawCardsResult> {
  if (!isValidCount(count)) {
    return {
      success: false,
      drawn_count: 0,
      deck_size: 0,
      error: 'count must be a non-negative integer',
    };
  }

  // 1. 消费上回合保留的牌（T038 接入）
  const retainedCard = await consumeRetainedCard(battleId, characterId);

  // 2. 查询牌库
  const deckRows = await getCharacterDeckCards(characterId);
  const deckSize = deckRows.length;

  // 3. 牌库为空：整 count 张从公共池补
  if (deckSize === 0) {
    const publicCards = await drawFromPublicPool(count);
    const handCards: HandCard[] = retainedCard
      ? [retainedCard, ...publicCards]
      : publicCards;
    await redisClient.set(
      getHandKey(battleId, characterId),
      JSON.stringify(handCards)
    );
    const result: DrawCardsResult = {
      success: true,
      cards: handCards,
      drawn_count: publicCards.length,
      deck_size: 0,
    };
    if (retainedCard) {
      result.retained_from_previous = retainedCard;
    }
    return result;
  }

  // 4. 洗牌 + 抽取（deck 来源）
  const shuffled = shuffleArray([...deckRows]);
  const actualFromDeck = Math.min(count, deckSize);
  const deckCards: HandCard[] = shuffled.slice(0, actualFromDeck).map(toHandCard);

  // 5. T1001 公共池补足：牌库 < count 时从公共池补
  const needFromPool = count - actualFromDeck;
  const publicCards: HandCard[] = needFromPool > 0
    ? await drawFromPublicPool(needFromPool)
    : [];
  const drawnCards: HandCard[] = [...deckCards, ...publicCards];

  // 6. 合并 retained（保留牌排在手牌顶部）
  const handCards: HandCard[] = retainedCard
    ? [retainedCard, ...drawnCards]
    : drawnCards;

  // 7. 写入 Redis（每次 draw 覆盖手牌）
  await redisClient.set(
    getHandKey(battleId, characterId),
    JSON.stringify(handCards)
  );

  // drawn_count = deck + public_pool（不含 retained）
  const totalDrawn = actualFromDeck + publicCards.length;
  const result: DrawCardsResult = {
    success: true,
    cards: handCards,
    drawn_count: totalDrawn,
    deck_size: deckSize,
  };
  if (retainedCard) {
    result.retained_from_previous = retainedCard;
  }
  return result;
}

/**
 * 2. 读取当前手牌
 * - 无手牌时返回空数组
 * - Redis 数据损坏时（JSON 解析失败）返回空数组
 */
export async function getActorHand(
  battleId: string,
  characterId: string
): Promise<HandCard[]> {
  const data = await redisClient.get(getHandKey(battleId, characterId));
  if (!data) {
    return [];
  }
  try {
    const parsed = JSON.parse(data) as HandCard[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * 3. 清空手牌（回合结束 / 重置对战时使用）
 */
export async function clearActorHand(
  battleId: string,
  characterId: string
): Promise<void> {
  await redisClient.del(getHandKey(battleId, characterId));
}

// ========================================
// T038：手牌保留 + 弃牌堆
// ========================================

/**
 * 4. 追加多张牌到弃牌堆（LIST 尾部 RPUSH）
 * - 空数组直接返回，不发 Redis 命令
 */
export async function addToDiscardPile(
  battleId: string,
  characterId: string,
  cards: HandCard[]
): Promise<void> {
  if (!cards || cards.length === 0) {
    return;
  }
  const key = getDiscardKey(battleId, characterId);
  const payloads = cards.map((c) => JSON.stringify(c));
  await redisClient.rPush(key, payloads);
}

/**
 * 5. 读取弃牌堆全量内容
 * - 不存在 → 返回 []
 * - 损坏 JSON 条目静默过滤
 */
export async function getDiscardPile(
  battleId: string,
  characterId: string
): Promise<HandCard[]> {
  const key = getDiscardKey(battleId, characterId);
  const raw = await redisClient.lRange(key, 0, -1);
  if (!raw || raw.length === 0) {
    return [];
  }
  const cards: HandCard[] = [];
  for (const item of raw) {
    try {
      const parsed = JSON.parse(item) as HandCard;
      if (parsed && typeof parsed === 'object' && typeof parsed.deck_id === 'string') {
        cards.push(parsed);
      }
    } catch {
      // 忽略损坏条目
    }
  }
  return cards;
}

/**
 * 6. 清空弃牌堆（重置对战 / 战斗结束时使用）
 */
export async function clearDiscardPile(
  battleId: string,
  characterId: string
): Promise<void> {
  await redisClient.del(getDiscardKey(battleId, characterId));
}

/**
 * 7. 回合结束保留手牌
 *
 * 四种路径：
 * - retainDeckId === null → 全部手牌入弃牌堆，清空手牌，retained:null
 * - retainDeckId 命中手牌某张（deck 来源）→ 写 retained key + 其余入弃牌堆 + 清手牌
 * - retainDeckId 命中手牌某张（public_pool 来源，T1001）→ 强制全弃 + error
 *   （公共池卡不可保留 → 拒绝该保留请求，安全降级牌不丢）
 * - retainDeckId 不在手牌中 → 全部入弃牌堆（安全降级，牌不丢）+ 返回 error
 *
 * 空手牌时 no-op，返回 `{ success:true, retained:null, discarded:[] }`。
 *
 * @param battleId 战斗 ID
 * @param characterId 棋子 ID
 * @param retainDeckId 要保留的牌的 deck_id；null 表示不保留任何牌
 */
export async function retainHandOnStepEnd(
  battleId: string,
  characterId: string,
  retainDeckId: string | null
): Promise<RetainHandResult> {
  const hand = await getActorHand(battleId, characterId);

  // 空手牌 → no-op
  if (hand.length === 0) {
    return { success: true, retained: null, discarded: [] };
  }

  // 路径 1：retainDeckId=null，全部弃牌
  if (retainDeckId === null) {
    await addToDiscardPile(battleId, characterId, hand);
    await clearActorHand(battleId, characterId);
    return { success: true, retained: null, discarded: hand };
  }

  // 路径 2/3/4：尝试命中 retainDeckId
  const idx = hand.findIndex((c) => c.deck_id === retainDeckId);

  // 路径 4：未命中 → 全部弃牌 + error
  if (idx === -1) {
    await addToDiscardPile(battleId, characterId, hand);
    await clearActorHand(battleId, characterId);
    return {
      success: false,
      retained: null,
      discarded: hand,
      error: 'retainDeckId not found in hand',
    };
  }

  const retainedCard = hand[idx];

  // 路径 3：命中但为公共池卡 → 强制全弃 + error
  if (retainedCard.source === 'public_pool') {
    await addToDiscardPile(battleId, characterId, hand);
    await clearActorHand(battleId, characterId);
    return {
      success: false,
      retained: null,
      discarded: hand,
      error: 'public pool cards cannot be retained',
    };
  }

  // 路径 2：命中（deck 来源）→ 保留 + 其余入弃牌堆
  const discarded = hand.filter((_, i) => i !== idx);

  await redisClient.set(
    getRetainedKey(battleId, characterId),
    JSON.stringify(retainedCard)
  );
  await addToDiscardPile(battleId, characterId, discarded);
  await clearActorHand(battleId, characterId);

  return { success: true, retained: retainedCard, discarded };
}
