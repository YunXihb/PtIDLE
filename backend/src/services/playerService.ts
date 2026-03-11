import { query, execute } from '../config/database';
import { v4 as uuidv4 } from 'uuid';

interface Profession {
  name: string;
  base_health: number;
  base_movement: number;
  base_energy: number;
}

// 职业配置
const PROFESSION_CONFIG: Record<string, Omit<Profession, 'name'>> = {
  warrior: { base_health: 20, base_movement: 2, base_energy: 3 },
  ranger: { base_health: 15, base_movement: 3, base_energy: 3 },
  mage: { base_health: 12, base_movement: 2, base_energy: 3 },
};

/**
 * 初始化玩家数据
 * 在用户注册成功后调用，创建玩家记录和初始棋子
 * @param userId 用户 ID
 */
export async function initializePlayer(userId: string): Promise<void> {
  // 1. 创建 players 记录
  const playerId = uuidv4();
  const now = new Date();

  await execute(
    `INSERT INTO players (id, user_id, resources, materials, production_gear, warehouse_limits, idle_queue, last_offline, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      playerId,
      userId,
      JSON.stringify({ iron_ore: 0, coal: 0, wood: 0, sap: 0, herb: 0, mushroom: 0 }),
      JSON.stringify({ iron_ingot: 0, plank: 0, herb_powder: 0 }),
      JSON.stringify({}),
      JSON.stringify({ resource: 1000, material: 500, gear: 50 }),
      JSON.stringify([]),
      now,
      now,
      now,
    ]
  );

  // 2. 创建 3 个初始棋子（战士、弓手、法师）
  const professions: Array<keyof typeof PROFESSION_CONFIG> = ['warrior', 'ranger', 'mage'];
  const names = ['棋子1', '棋子2', '棋子3'];

  for (let i = 0; i < professions.length; i++) {
    const profession = professions[i];
    const config = PROFESSION_CONFIG[profession];

    await execute(
      `INSERT INTO characters (id, player_id, name, profession, health, max_health, movement, energy, max_energy, position_x, position_y, is_alive, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        uuidv4(),
        playerId,
        names[i],
        profession,
        config.base_health,
        config.base_health,
        config.base_movement,
        config.base_energy,
        config.base_energy,
        null,
        null,
        true,
        now,
        now,
      ]
    );
  }
}

/**
 * 根据 userId 获取玩家 ID
 * @param userId 用户 ID
 * @returns 玩家 ID
 */
export async function getPlayerIdByUserId(userId: string): Promise<string | null> {
  const result = await query<{ id: string }>(
    'SELECT id FROM players WHERE user_id = $1',
    [userId]
  );

  return result.length > 0 ? result[0].id : null;
}
