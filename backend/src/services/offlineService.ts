/**
 * 离线收益计算服务
 * 负责计算玩家离线期间的收益
 */

// 资源产出速率（个/分钟）
const RESOURCE_RATES: Record<string, number> = {
  iron_ore: 1,      // 铁矿石
  coal: 0.5,        // 煤炭
  wood: 1,          // 原木
  sap: 0.5,         // 树液
  herb: 1,          // 止血草
  mushroom: 0.5,    // 荧光菇
};

// 最大离线时间（分钟）
export const MAX_OFFLINE_MINUTES = 24 * 60; // 24小时

// 仓储上限默认值
export const DEFAULT_WAREHOUSE_LIMIT = 1000;

export interface OfflineEarningsResult {
  offlineTime: number;        // 离线时长（分钟）
  maxOfflineTime: number;     // 最大计入时长
  resources: {                // 各类资源产出
    iron_ore: number;
    coal: number;
    wood: number;
    sap: number;
    herb: number;
    mushroom: number;
  };
  totalResourceCount: number; // 总产出资源数
}

/**
 * 计算可存入仓库的资源数量
 * @param current 当前资源数量
 * @param added 新增资源数量
 * @param limit 仓储上限
 * @returns 实际可存入的数量
 */
export function calculateStoredAmount(current: number, added: number, limit: number): number {
  if (added <= 0) return 0;
  const remaining = limit - current;
  return Math.min(added, Math.max(0, remaining));
}

/**
 * 计算离线收益
 * @param lastOfflineTime 玩家上次离线时间
 * @returns 离线收益结果
 */
export function calculateOfflineEarnings(lastOfflineTime: Date | null): OfflineEarningsResult {
  const now = new Date();

  // 如果没有离线时间记录，返回0
  if (!lastOfflineTime) {
    return {
      offlineTime: 0,
      maxOfflineTime: 0,
      resources: {
        iron_ore: 0,
        coal: 0,
        wood: 0,
        sap: 0,
        herb: 0,
        mushroom: 0,
      },
      totalResourceCount: 0,
    };
  }

  // 计算离线时长（分钟）
  const offlineTimeMs = now.getTime() - lastOfflineTime.getTime();
  const offlineTime = Math.floor(offlineTimeMs / (1000 * 60));

  // 限制最大离线时间
  const effectiveOfflineTime = Math.min(offlineTime, MAX_OFFLINE_MINUTES);

  // 计算各类资源产出
  const resources: Record<string, number> = {};
  let totalResourceCount = 0;

  for (const [resource, rate] of Object.entries(RESOURCE_RATES)) {
    const earned = Math.floor(effectiveOfflineTime * rate);
    resources[resource] = earned;
    totalResourceCount += earned;
  }

  return {
    offlineTime,
    maxOfflineTime: effectiveOfflineTime,
    resources: resources as OfflineEarningsResult['resources'],
    totalResourceCount,
  };
}

/**
 * 计算应用仓储上限后的实际存入数量
 * @param earnings 离线收益
 * @param currentResources 当前资源
 * @param warehouseLimits 仓储上限
 * @returns 实际可存入的资源数量
 */
export function applyWarehouseLimits(
  earnings: OfflineEarningsResult,
  currentResources: Record<string, number>,
  warehouseLimits: Record<string, number>
): {
  stored: Record<string, number>;
  overflowed: Record<string, number>;
} {
  const stored: Record<string, number> = {};
  const overflowed: Record<string, number> = {};
  const resourceLimit = warehouseLimits.resource || DEFAULT_WAREHOUSE_LIMIT;

  for (const [key, earned] of Object.entries(earnings.resources)) {
    const current = currentResources[key] || 0;
    const limit = resourceLimit;

    const storable = calculateStoredAmount(current, earned, limit);
    stored[key] = storable;
    overflowed[key] = earned - storable;
  }

  return { stored, overflowed };
}
