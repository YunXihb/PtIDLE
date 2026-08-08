// ========================================
// 资源/材料名映射（中文化展示）
// 对齐后端 gathering_skills.yields / players.resources 的 key
// ========================================

export const RESOURCE_NAMES: Record<string, string> = {
  // 采集主产物 / 副产物
  iron_ore: '铁矿石',
  coal: '煤炭',
  wood: '原木',
  sap: '树液',
  herb: '止血草',
  mushroom: '荧光菇',
  // 加工产物
  iron_ingot: '铁锭',
  plank: '木板',
  herb_powder: '草药粉',
};

/**
 * 取资源中文名；未登记的 key 原样返回（兜底，避免空白）。
 */
export function resourceName(key: string): string {
  return RESOURCE_NAMES[key] ?? key;
}
