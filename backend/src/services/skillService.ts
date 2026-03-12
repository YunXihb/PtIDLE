import { query } from '../config/database';

export interface GatheringSkill {
  id: string;
  name: string;
  type: 'mining' | 'woodcutting' | 'herbalism';
  yields: Record<string, number>;
  base_yield: number;
}

// 内存缓存（5分钟过期）
let skillsCache: {
  data: GatheringSkill[];
  timestamp: number;
} | null = null;

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * 从数据库获取所有采集技能（带缓存）
 */
export async function getAllGatheringSkills(): Promise<GatheringSkill[]> {
  const now = Date.now();

  // 检查缓存
  if (skillsCache && (now - skillsCache.timestamp) < CACHE_TTL) {
    return skillsCache.data;
  }

  // 查询数据库
  const result = await query<{
    id: string;
    name: string;
    type: string;
    yields: Record<string, number>;
    base_yield: number;
  }>('SELECT id, name, type, yields, base_yield FROM gathering_skills ORDER BY type');

  const skills: GatheringSkill[] = result.map(row => ({
    id: row.id,
    name: row.name,
    type: row.type as 'mining' | 'woodcutting' | 'herbalism',
    yields: row.yields,
    base_yield: row.base_yield,
  }));

  // 更新缓存
  skillsCache = {
    data: skills,
    timestamp: now,
  };

  return skills;
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
  skillsCache = null;
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
    const primaryResource = Object.keys(yields)[0];
    const primaryYield = yields[primaryResource];

    // 查找副产物（产量低于主产物的资源）
    let byproduct = '';
    let byproductChance = 0;
    for (const [resource, rate] of Object.entries(yields)) {
      if (resource !== primaryResource) {
        byproduct = resource;
        byproductChance = rate / primaryYield;
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
