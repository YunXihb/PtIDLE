import { query } from '../config/database';

export interface Profession {
  id: string;
  name: string;
  base_health: number;
  base_movement: number;
  base_energy: number;
  description: string | null;
}

// 内存缓存（5分钟过期）
let professionsCache: {
  data: Profession[];
  timestamp: number;
} | null = null;

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * 从数据库获取所有职业（带缓存）
 */
export async function getAllProfessions(): Promise<Profession[]> {
  const now = Date.now();

  // 检查缓存
  if (professionsCache && (now - professionsCache.timestamp) < CACHE_TTL) {
    return professionsCache.data;
  }

  // 查询数据库
  const result = await query<{
    id: string;
    name: string;
    base_health: number;
    base_movement: number;
    base_energy: number;
    description: string | null;
  }>('SELECT id, name, base_health, base_movement, base_energy, description FROM professions ORDER BY name');

  const professions: Profession[] = result.map(row => ({
    id: row.id,
    name: row.name,
    base_health: row.base_health,
    base_movement: row.base_movement,
    base_energy: row.base_energy,
    description: row.description,
  }));

  // 更新缓存
  professionsCache = {
    data: professions,
    timestamp: now,
  };

  return professions;
}

/**
 * 根据 name 获取单个职业
 */
export async function getProfessionByName(name: string): Promise<Profession | null> {
  const professions = await getAllProfessions();
  return professions.find(p => p.name === name) || null;
}

/**
 * 清除职业缓存（用于测试或配置更新时）
 */
export function clearProfessionsCache(): void {
  professionsCache = null;
}
