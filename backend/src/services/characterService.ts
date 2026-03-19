import { query, execute } from '../config/database';
import { v4 as uuidv4 } from 'uuid';
import { getPlayerIdByUserId } from './playerService';
import { getProfessionByName, Profession } from './professionService';

export interface Character {
  id: string;
  player_id: string;
  name: string;
  profession: string;
  health: number;
  max_health: number;
  movement: number;
  energy: number;
  max_energy: number;
  position_x: number | null;
  position_y: number | null;
  is_alive: boolean;
  created_at: Date;
}

export interface CreateCharacterResult {
  success: boolean;
  character?: Character;
  error?: string;
}

/**
 * 创建新棋子
 * @param userId 用户 ID
 * @param name 棋子名称
 * @param professionName 职业名称 (warrior, ranger, mage)
 */
export async function createCharacter(
  userId: string,
  name: string,
  professionName: string
): Promise<CreateCharacterResult> {
  // 1. 验证职业
  const profession: Profession | null = await getProfessionByName(professionName);
  if (!profession) {
    return { success: false, error: 'Invalid profession' };
  }

  // 2. 获取玩家 ID
  const playerId = await getPlayerIdByUserId(userId);
  if (!playerId) {
    return { success: false, error: 'Player not found' };
  }

  // 3. 验证棋子数量（最大 9 个）
  const existingCharacters = await query<{ count: number }>(
    'SELECT COUNT(*) as count FROM characters WHERE player_id = $1',
    [playerId]
  );

  if (existingCharacters.length > 0 && existingCharacters[0].count >= 9) {
    return { success: false, error: 'Maximum character limit reached (9)' };
  }

  // 4. 创建棋子
  const characterId = uuidv4();
  const now = new Date();

  await execute(
    `INSERT INTO characters (id, player_id, name, profession, health, max_health, movement, energy, max_energy, position_x, position_y, is_alive, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      characterId,
      playerId,
      name,
      profession.name,
      profession.base_health,
      profession.base_health,
      profession.base_movement,
      profession.base_energy,
      profession.base_energy,
      null,
      null,
      true,
      now,
      now,
    ]
  );

  const character: Character = {
    id: characterId,
    player_id: playerId,
    name,
    profession: profession.name,
    health: profession.base_health,
    max_health: profession.base_health,
    movement: profession.base_movement,
    energy: profession.base_energy,
    max_energy: profession.base_energy,
    position_x: null,
    position_y: null,
    is_alive: true,
    created_at: now,
  };

  return { success: true, character };
}

export interface UpdateCharacterNameResult {
  success: boolean;
  character?: Character;
  error?: string;
}

/**
 * 更新棋子名称
 * @param userId 用户 ID
 * @param characterId 棋子 ID
 * @param newName 新名称
 */
export async function updateCharacterName(
  userId: string,
  characterId: string,
  newName: string
): Promise<UpdateCharacterNameResult> {
  // 1. 获取玩家 ID
  const playerId = await getPlayerIdByUserId(userId);
  if (!playerId) {
    return { success: false, error: 'Player not found' };
  }

  // 2. 验证棋子存在且属于该玩家
  const characters = await query<Character>(
    'SELECT * FROM characters WHERE id = $1 AND player_id = $2',
    [characterId, playerId]
  );

  if (characters.length === 0) {
    return { success: false, error: 'Character not found' };
  }

  // 3. 更新棋子名称
  const now = new Date();
  await execute(
    'UPDATE characters SET name = $1, updated_at = $2 WHERE id = $3',
    [newName, now, characterId]
  );

  // 4. 返回更新后的棋子
  const updatedCharacter: Character = {
    ...characters[0],
    name: newName,
  };

  return { success: true, character: updatedCharacter };
}

/**
 * 获取玩家的所有棋子
 * @param userId 用户 ID
 */
export async function getCharactersByUserId(userId: string): Promise<Character[]> {
  const playerId = await getPlayerIdByUserId(userId);
  if (!playerId) {
    return [];
  }

  const result = await query<Character>(
    `SELECT id, player_id, name, profession, health, max_health, movement, energy, max_energy,
            position_x, position_y, is_alive, created_at
     FROM characters
     WHERE player_id = $1
     ORDER BY created_at`,
    [playerId]
  );

  return result;
}

// ========================================
// 棋子牌库分配
// ========================================

// 棋子卡牌上限：预设5张 + 灵活5张 = 最多10张
const CHARACTER_DECK_MAX_SIZE = 10;

export interface AssignCardResult {
  success: boolean;
  character_deck_id?: string;
  error?: string;
}

/**
 * 将卡牌分配到棋子牌库
 * @param userId 用户 ID
 * @param characterId 棋子 ID
 * @param cardId 玩家卡牌 ID
 */
export async function assignCardToCharacter(
  userId: string,
  characterId: string,
  cardId: string
): Promise<AssignCardResult> {
  try {
    // 1. 获取玩家 ID
    const playerId = await getPlayerIdByUserId(userId);
    if (!playerId) {
      return { success: false, error: 'Player not found' };
    }

    // 2. 验证棋子存在且属于该玩家
    const characters = await query<Character>(
      'SELECT * FROM characters WHERE id = $1 AND player_id = $2',
      [characterId, playerId]
    );

    if (characters.length === 0) {
      return { success: false, error: 'Character not found' };
    }

    // 3. 验证卡牌存在且属于该玩家
    const cards = await query<{ id: string }>(
      'SELECT id FROM player_cards WHERE id = $1 AND player_id = $2',
      [cardId, playerId]
    );

    if (cards.length === 0) {
      return { success: false, error: 'Card not found' };
    }

    // 4. 检查该卡牌是否已经分配给该棋子
    const existingAssignment = await query<{ id: string }>(
      'SELECT id FROM character_deck WHERE character_id = $1 AND player_card_id = $2',
      [characterId, cardId]
    );

    if (existingAssignment.length > 0) {
      return { success: false, error: 'Card already assigned to this character' };
    }

    // 5. 检查棋子牌库是否已满（≤10张）
    const deckCount = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM character_deck WHERE character_id = $1',
      [characterId]
    );

    const currentCount = parseInt(deckCount[0]?.count || '0', 10);
    if (currentCount >= CHARACTER_DECK_MAX_SIZE) {
      return { success: false, error: `Character deck is full (max ${CHARACTER_DECK_MAX_SIZE} cards)` };
    }

    // 6. 分配卡牌到棋子牌库
    const deckId = uuidv4();
    await execute(
      `INSERT INTO character_deck (id, character_id, player_card_id, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [deckId, characterId, cardId]
    );

    return { success: true, character_deck_id: deckId };
  } catch (error) {
    console.error('Error assigning card to character:', error);
    throw error;
  }
}

/**
 * 从棋子牌库移除卡牌
 * @param userId 用户 ID
 * @param characterId 棋子 ID
 * @param cardId 玩家卡牌 ID
 */
export async function removeCardFromCharacter(
  userId: string,
  characterId: string,
  cardId: string
): Promise<AssignCardResult> {
  try {
    // 1. 获取玩家 ID
    const playerId = await getPlayerIdByUserId(userId);
    if (!playerId) {
      return { success: false, error: 'Player not found' };
    }

    // 2. 验证棋子存在且属于该玩家
    const characters = await query<Character>(
      'SELECT * FROM characters WHERE id = $1 AND player_id = $2',
      [characterId, playerId]
    );

    if (characters.length === 0) {
      return { success: false, error: 'Character not found' };
    }

    // 3. 验证卡牌存在且属于该玩家
    const cards = await query<{ id: string }>(
      'SELECT id FROM player_cards WHERE id = $1 AND player_id = $2',
      [cardId, playerId]
    );

    if (cards.length === 0) {
      return { success: false, error: 'Card not found' };
    }

    // 4. 从牌库移除卡牌
    const result = await execute(
      'DELETE FROM character_deck WHERE character_id = $1 AND player_card_id = $2',
      [characterId, cardId]
    );

    if (result === 0) {
      return { success: false, error: 'Card not found in character deck' };
    }

    return { success: true };
  } catch (error) {
    console.error('Error removing card from character:', error);
    throw error;
  }
}

/**
 * 获取棋子的牌库卡牌列表
 * @param characterId 棋子 ID
 */
export async function getCharacterDeckCards(characterId: string) {
  const result = await query<{
    deck_id: string;
    card_id: string;
    name: string;
    type: string;
    cost: number;
    effect: Record<string, unknown>;
    template_no: number;
    card_sequence: number;
    assigned_at: Date;
  }>(
    `SELECT cd.id as deck_id, pc.id as card_id, pc.name, pc.type, pc.cost, pc.effect,
            COALESCE(ct.template_no, 0) as template_no,
            COALESCE(pc.card_sequence, 0) as card_sequence,
            cd.created_at as assigned_at
     FROM character_deck cd
     JOIN player_cards pc ON cd.player_card_id = pc.id
     LEFT JOIN card_templates ct ON pc.card_template_id = ct.id
     WHERE cd.character_id = $1
     ORDER BY ct.template_no ASC, pc.card_sequence ASC`,
    [characterId]
  );

  return result;
}

/**
 * 获取棋子的牌库卡牌数量
 * @param characterId 棋子 ID
 */
export async function getCharacterDeckCount(characterId: string): Promise<number> {
  const result = await query<{ count: string }>(
    'SELECT COUNT(*) as count FROM character_deck WHERE character_id = $1',
    [characterId]
  );
  return parseInt(result[0]?.count || '0', 10);
}
