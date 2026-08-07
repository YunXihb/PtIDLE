import { query, execute, withTransaction } from '../config/database';
import type { PoolClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';

interface PlayerProfile {
  id: string;
  user_id: string;
  username: string;
  resources: Record<string, number>;
  materials: Record<string, number>;
  production_gear: Record<string, any>;
  warehouse_limits: Record<string, number>;
  idle_queue: any[];
  last_offline: Date | null;
  characters: Array<{
    id: string;
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
  }>;
}

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
 *
 * @param userId 用户 ID
 * @param client 可选事务客户端；传入则所有写入走该连接（与调用方共用同一事务），
 *               不传则各自独立 execute（向后兼容旧调用与单元测试）
 */
export async function initializePlayer(userId: string, client?: PoolClient): Promise<void> {
  // 统一写入入口：有 client 走事务连接，无 client 走池化 execute
  const run = async (text: string, params: any[]): Promise<void> => {
    if (client) {
      await client.query(text, params);
    } else {
      await execute(text, params);
    }
  };

  // 1. 创建 players 记录
  const playerId = uuidv4();
  const now = new Date();

  await run(
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

    await run(
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

/**
 * 更新玩家资源
 * @param userId 用户 ID
 * @param resourcesToAdd 要添加的资源（将合并到现有资源）
 * @returns 更新后的资源
 */
export async function updateResources(
  userId: string,
  resourcesToAdd: Record<string, number>
): Promise<Record<string, number> | null> {
  // 1. 获取当前玩家资源
  const playerResult = await query<{ resources: Record<string, number> }>(
    'SELECT resources FROM players WHERE user_id = $1',
    [userId]
  );

  if (playerResult.length === 0) {
    return null;
  }

  const currentResources = playerResult[0].resources || {};

  // 2. 合并资源
  const updatedResources: Record<string, number> = { ...currentResources };
  for (const [key, value] of Object.entries(resourcesToAdd)) {
    updatedResources[key] = (updatedResources[key] || 0) + value;
  }

  // 3. 更新数据库
  await execute(
    'UPDATE players SET resources = $1, updated_at = NOW() WHERE user_id = $2',
    [JSON.stringify(updatedResources), userId]
  );

  return updatedResources;
}

/**
 * 更新玩家离线时间
 * @param userId 用户 ID
 */
export async function updateLastOffline(userId: string): Promise<void> {
  await execute(
    'UPDATE players SET last_offline = NOW(), updated_at = NOW() WHERE user_id = $1',
    [userId]
  );
}

/**
 * 原子领取离线收益（单事务 + 行锁，防重复领取）
 *
 * 并发两个 offline-claim 请求时，第二个会等待第一个 COMMIT，
 * 之后读到已更新的 last_offline → 离线时间为 0 → 不再重复发奖。
 *
 * @param userId 用户 ID
 * @param calculate 收益计算函数（读 last_offline + resources，返回收益与上限应用结果）
 * @returns 领取结果；玩家不存在返回 null
 */
export async function claimOfflineEarnings(
  userId: string,
  calculate: (base: {
    last_offline: Date | null;
    resources: Record<string, number>;
    warehouse_limits: Record<string, number>;
  }) => {
    offlineTime: number;
    earned: Record<string, number>;
    stored: Record<string, number>;
    overflowed: Record<string, number>;
  }
): Promise<{
  offlineTime: number;
  earned: Record<string, number>;
  stored: Record<string, number>;
  overflowed: Record<string, number>;
} | null> {
  return withTransaction(async (client) => {
    // 1. 行锁读玩家当前状态
    const result = await client.query<{
      resources: Record<string, number>;
      warehouse_limits: Record<string, number>;
      last_offline: Date | null;
    }>(
      'SELECT resources, warehouse_limits, last_offline FROM players WHERE user_id = $1 FOR UPDATE',
      [userId]
    );
    if (result.rows.length === 0) {
      return null;
    }
    const base = result.rows[0];

    // 2. 计算收益（基于行锁内最新的 last_offline）
    const outcome = calculate({
      last_offline: base.last_offline,
      resources: base.resources || {},
      warehouse_limits: base.warehouse_limits || {},
    });

    // 3. 合并资源 + 更新 last_offline（同事务）
    const updatedResources: Record<string, number> = { ...(base.resources || {}) };
    for (const [key, value] of Object.entries(outcome.stored)) {
      updatedResources[key] = (updatedResources[key] || 0) + value;
    }
    await client.query(
      'UPDATE players SET resources = $1, last_offline = NOW(), updated_at = NOW() WHERE user_id = $2',
      [JSON.stringify(updatedResources), userId]
    );

    return outcome;
  });
}

/**
 * 获取玩家基础信息（资源、仓储上限、离线时间）
 * @param userId 用户 ID
 */
export async function getPlayerBaseInfo(userId: string): Promise<{
  resources: Record<string, number>;
  warehouse_limits: Record<string, number>;
  last_offline: Date | null;
} | null> {
  const result = await query<{
    resources: Record<string, number>;
    warehouse_limits: Record<string, number>;
    last_offline: Date | null;
  }>(
    'SELECT resources, warehouse_limits, last_offline FROM players WHERE user_id = $1',
    [userId]
  );

  return result.length > 0 ? result[0] : null;
}

/**
 * 获取玩家完整资料
 * @param userId 用户 ID
 * @returns 玩家完整数据，包含资源、材料、棋子列表等
 */
export async function getPlayerProfile(userId: string): Promise<PlayerProfile | null> {
  // 1. 查询玩家基本信息
  const playerResult = await query<{
    id: string;
    user_id: string;
    username: string;
    resources: Record<string, number>;
    materials: Record<string, number>;
    production_gear: Record<string, any>;
    warehouse_limits: Record<string, number>;
    idle_queue: any[];
    last_offline: Date | null;
  }>(
    `SELECT p.id, p.user_id, u.username, p.resources, p.materials, p.production_gear,
            p.warehouse_limits, p.idle_queue, p.last_offline
     FROM players p
     JOIN users u ON p.user_id = u.id
     WHERE p.user_id = $1`,
    [userId]
  );

  if (playerResult.length === 0) {
    return null;
  }

  const player = playerResult[0];

  // 2. 查询棋子列表
  const charactersResult = await query<{
    id: string;
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
  }>(
    `SELECT id, name, profession, health, max_health, movement, energy, max_energy,
            position_x, position_y, is_alive
     FROM characters
     WHERE player_id = $1`,
    [player.id]
  );

  // 3. 组装返回数据
  return {
    id: player.id,
    user_id: player.user_id,
    username: player.username,
    resources: player.resources,
    materials: player.materials,
    production_gear: player.production_gear,
    warehouse_limits: player.warehouse_limits,
    idle_queue: player.idle_queue,
    last_offline: player.last_offline,
    characters: charactersResult.map(char => ({
      id: char.id,
      name: char.name,
      profession: char.profession,
      health: char.health,
      max_health: char.max_health,
      movement: char.movement,
      energy: char.energy,
      max_energy: char.max_energy,
      position_x: char.position_x,
      position_y: char.position_y,
      is_alive: char.is_alive,
    })),
  };
}
