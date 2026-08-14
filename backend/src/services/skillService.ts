import { query } from '../config/database';
import { createCache } from '../utils/cache';

export interface GatheringSkill {
  id: string;
  name: string;
  type: 'mining' | 'woodcutting' | 'herbalism';
  yields: Record<string, number>;
  base_yield: number;
}

// 内存缓存（5分钟过期，共享工具）
const skillsCache = createCache<GatheringSkill[]>(5 * 60 * 1000);

/**
 * 从数据库获取所有采集技能（带缓存）
 */
export async function getAllGatheringSkills(): Promise<GatheringSkill[]> {
  return skillsCache.getOrLoad(async () => {
    const result = await query<{
      id: string;
      name: string;
      type: string;
      yields: Record<string, number>;
      base_yield: number;
    }>('SELECT id, name, type, yields, base_yield FROM gathering_skills ORDER BY type');

    return result.map(row => ({
      id: row.id,
      name: row.name,
      type: row.type as 'mining' | 'woodcutting' | 'herbalism',
      yields: row.yields,
      base_yield: row.base_yield,
    }));
  });
}

/**
 * 根据 type 获取单个技能
 */
export async function getGatheringSkillByType(type: string): Promise<GatheringSkill | null> {
  const skills = await getAllGatheringSkills();
  return skills.find(s => s.type === type) || null;
}

/**
 * 清除技能缓存（用于测试或配置更新时）
 */
export function clearSkillsCache(): void {
  skillsCache.clear();
}

/**
 * 获取技能配置（转换为 gatheringService 使用的格式）
 */
export async function getGatheringConfig(): Promise<Record<string, {
  primaryResource: string;
  baseRate: number;
  byproduct: string;
  byproductChance: number;
}>> {
  const skills = await getAllGatheringSkills();

  const config: Record<string, {
    primaryResource: string;
    baseRate: number;
    byproduct: string;
    byproductChance: number;
  }> = {};

  for (const skill of skills) {
    const yields = skill.yields;

    // 主产物 = 产量(rate)最大的资源。不可依赖 JSONB key 顺序,
    // 否则当 DB yields 形如 {"coal":0.3,"iron_ore":1} 时会取 coal 作主产物,
    // 主副颠倒(采矿得煤、伐木得树液)。
    let primaryResource = '';
    let primaryYield = 0;
    for (const [resource, rate] of Object.entries(yields)) {
      if (rate > primaryYield) {
        primaryYield = rate;
        primaryResource = resource;
      }
    }

    // 副产物 = 其余资源中第一个, 概率 = 其产量 / 主产物产量
    let byproduct = '';
    let byproductChance = 0;
    for (const [resource, rate] of Object.entries(yields)) {
      if (resource !== primaryResource) {
        byproduct = resource;
        byproductChance = primaryYield > 0 ? rate / primaryYield : 0;
        break;
      }
    }

    config[skill.type] = {
      primaryResource,
      baseRate: skill.base_yield,
      byproduct,
      byproductChance,
    };
  }

  return config;
}
