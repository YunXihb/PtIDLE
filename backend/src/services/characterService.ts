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
