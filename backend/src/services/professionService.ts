import { query } from '../config/database';
import { createCache } from '../utils/cache';

export interface Profession {
  id: string;
  name: string;
  base_health: number;
  base_movement: number;
  base_energy: number;
  description: string | null;
}

// 内存缓存（5分钟过期，共享工具）
const professionsCache = createCache<Profession[]>(5 * 60 * 1000);

/**
 * 从数据库获取所有职业（带缓存）
 */
export async function getAllProfessions(): Promise<Profession[]> {
  return professionsCache.getOrLoad(async () => {
    const result = await query<{
      id: string;
      name: string;
      base_health: number;
      base_movement: number;
      base_energy: number;
      description: string | null;
    }>('SELECT id, name, base_health, base_movement, base_energy, description FROM professions ORDER BY name');

    return result.map(row => ({
      id: row.id,
      name: row.name,
      base_health: row.base_health,
      base_movement: row.base_movement,
      base_energy: row.base_energy,
      description: row.description,
    }));
  });
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
  professionsCache.clear();
}
