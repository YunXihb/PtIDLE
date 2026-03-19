import { query, execute } from '../config/database';
import { getGatheringConfig, getGatheringSkillByType, clearSkillsCache } from './skillService';
import {
  enqueueGatheringTask,
  removeGatheringTask,
  getDueGatheringTasks,
  acquireGatheringLock,
  releaseGatheringLock,
} from './idleQueueService';

export type SkillType = 'mining' | 'woodcutting' | 'herbalism';

export interface GatheringTask {
  id: string;
  skillType: SkillType;
  characterId?: string;
  startedAt: string;
  duration: number; // in seconds
  status: 'active' | 'completed' | 'cancelled';
  result?: {
    resources: Record<string, number>;
    overflowed: Record<string, number>;
  };
  // 进度信息（仅在查询状态时返回）
  progress?: number;
  elapsedSeconds?: number;
}

// 采集技能配置（从数据库加载）
let GATHERING_CONFIG: Record<SkillType, {
  primaryResource: string;
  baseRate: number; // per minute
  byproduct: string;
  byproductChance: number;
}> | null = null;

/**
 * 初始化采集配置（从数据库加载）
 */
export async function initializeGatheringConfig(): Promise<void> {
  GATHERING_CONFIG = await getGatheringConfig() as Record<SkillType, any>;
}

/**
 * 获取当前配置（自动初始化如果未初始化）
 */
async function getConfig(): Promise<Record<SkillType, {
  primaryResource: string;
  baseRate: number;
  byproduct: string;
  byproductChance: number;
}>> {
  if (!GATHERING_CONFIG) {
    await initializeGatheringConfig();
  }
  return GATHERING_CONFIG!;
}

// 默认采集时长（秒）
const DEFAULT_GATHERING_DURATION = 60; // 1 minute for testing

/**
 * 开始采集任务
 * @param userId 用户ID
 * @param skillType 技能类型
 * @param characterId 角色ID（可选，用于装备加成）
 */
export async function startGathering(
  userId: string,
  skillType: SkillType,
  characterId?: string
): Promise<GatheringTask | null> {
  // 1. 获取玩家当前状态
  const playerResult = await query<{
    id: string;
    resources: Record<string, number>;
    warehouse_limits: Record<string, number>;
    idle_queue: GatheringTask[];
  }>(
    'SELECT id, resources, warehouse_limits, idle_queue FROM players WHERE user_id = $1',
    [userId]
  );

  if (playerResult.length === 0) {
    return null;
  }

  const player = playerResult[0];
  const idleQueue: GatheringTask[] = player.idle_queue || [];

  // 2. 检查是否已有进行中的采集任务
  const activeTask = idleQueue.find(task => task.status === 'active');
  if (activeTask) {
    throw new Error('已有进行中的采集任务');
  }

  // 3. 创建新采集任务
  const config = (await getConfig())[skillType];
  const now = new Date();
  const task: GatheringTask = {
    id: `gathering_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    skillType,
    characterId,
    startedAt: now.toISOString(),
    duration: DEFAULT_GATHERING_DURATION,
    status: 'active',
  };

  // 4. 更新 idle_queue
  idleQueue.push(task);
  await execute(
    'UPDATE players SET idle_queue = $1, updated_at = NOW() WHERE user_id = $2',
    [JSON.stringify(idleQueue), userId]
  );

  // 5. 添加到 Redis 队列
  const completionTime = now.getTime() + (DEFAULT_GATHERING_DURATION * 1000);
  await enqueueGatheringTask(userId, skillType, completionTime);

  return task;
}

/**
 * 获取当前采集状态
 * @param userId 用户ID
 */
export async function getGatheringStatus(
  userId: string
): Promise<GatheringTask | null> {
  const playerResult = await query<{
    idle_queue: GatheringTask[];
  }>(
    'SELECT idle_queue FROM players WHERE user_id = $1',
    [userId]
  );

  if (playerResult.length === 0) {
    return null;
  }

  const idleQueue: GatheringTask[] = playerResult[0].idle_queue || [];
  // 返回最新的活跃任务
  const activeTask = idleQueue.find(task => task.status === 'active');

  if (!activeTask) {
    return null;
  }

  // 计算进度
  const startTime = new Date(activeTask.startedAt).getTime();
  const now = Date.now();
  const elapsedSeconds = Math.floor((now - startTime) / 1000);
  const progress = Math.min(elapsedSeconds / activeTask.duration, 1);

  return {
    ...activeTask,
    progress,
    elapsedSeconds,
  };
}

/**
 * 计算采集产出
 * @param task 采集任务
 * @param productionGear 生产装备加成
 */
async function calculateGatheringYield(
  task: GatheringTask,
  productionGear: Record<string, any>
): Promise<{ resources: Record<string, number>; overflowed: Record<string, number> }> {
  const config = (await getConfig())[task.skillType];

  // 计算采集时长（分钟）
  const durationMinutes = task.duration / 60;

  // 计算装备加成
  let gearBonus = 0;
  const gearKey = `${task.skillType}_bonus`;
  if (productionGear && productionGear[gearKey]) {
    gearBonus = productionGear[gearKey];
  }

  // 基础产出
  const baseYield = config.baseRate * durationMinutes;
  const actualYield = baseYield * (1 + gearBonus);

  const resources: Record<string, number> = {
    [config.primaryResource]: Math.floor(actualYield),
  };

  // 副产物
  if (Math.random() < config.byproductChance) {
    resources[config.byproduct] = Math.floor(actualYield * 0.5);
  }

  return { resources, overflowed: {} };
}

/**
 * 完成采集任务
 * @param userId 用户ID
 */
export async function completeGathering(userId: string): Promise<GatheringTask | null> {
  // 1. 获取玩家数据
  const playerResult = await query<{
    id: string;
    resources: Record<string, number>;
    warehouse_limits: Record<string, number>;
    idle_queue: GatheringTask[];
    production_gear: Record<string, any>;
  }>(
    'SELECT id, resources, warehouse_limits, idle_queue, production_gear FROM players WHERE user_id = $1',
    [userId]
  );

  if (playerResult.length === 0) {
    return null;
  }

  const player = playerResult[0];
  const idleQueue: GatheringTask[] = player.idle_queue || [];

  // 2. 查找活跃任务
  const activeTaskIndex = idleQueue.findIndex(task => task.status === 'active');
  if (activeTaskIndex === -1) {
    return null;
  }

  const activeTask = idleQueue[activeTaskIndex];

  // 3. 检查任务是否已到期
  const startTime = new Date(activeTask.startedAt).getTime();
  const now = Date.now();
  const elapsedSeconds = (now - startTime) / 1000;

  if (elapsedSeconds < activeTask.duration) {
    // 任务尚未完成
    return null;
  }

  // 4. 计算产出
  const { resources: earned, overflowed } = await calculateGatheringYield(
    activeTask,
    player.production_gear || {}
  );

  // 5. 应用仓储上限
  const currentResources = player.resources || {};
  const limits = player.warehouse_limits || { resource: 1000 };

  const stored: Record<string, number> = {};
  const actualOverflowed: Record<string, number> = {};

  for (const [resource, amount] of Object.entries(earned)) {
    const current = currentResources[resource] || 0;
    const limit = limits.resource;
    const maxAdd = Math.max(0, limit - current);
    const actualStored = Math.min(amount, maxAdd);

    stored[resource] = actualStored;
    if (amount > maxAdd) {
      actualOverflowed[resource] = amount - maxAdd;
    }
  }

  // 6. 更新玩家资源
  const updatedResources = { ...currentResources };
  for (const [resource, amount] of Object.entries(stored)) {
    updatedResources[resource] = (updatedResources[resource] || 0) + amount;
  }

  // 7. 更新任务状态为完成
  idleQueue[activeTaskIndex] = {
    ...activeTask,
    status: 'completed',
    result: {
      resources: stored,
      overflowed: actualOverflowed,
    },
  };

  await execute(
    'UPDATE players SET resources = $1, idle_queue = $2, updated_at = NOW() WHERE user_id = $3',
    [JSON.stringify(updatedResources), JSON.stringify(idleQueue), userId]
  );

  return idleQueue[activeTaskIndex];
}

/**
 * 取消采集任务
 * @param userId 用户ID
 */
export async function cancelGathering(userId: string): Promise<boolean> {
  const playerResult = await query<{
    idle_queue: GatheringTask[];
  }>(
    'SELECT idle_queue FROM players WHERE user_id = $1',
    [userId]
  );

  if (playerResult.length === 0) {
    return false;
  }

  const idleQueue: GatheringTask[] = playerResult[0].idle_queue || [];
  const activeTaskIndex = idleQueue.findIndex(task => task.status === 'active');

  if (activeTaskIndex === -1) {
    return false;
  }

  idleQueue[activeTaskIndex].status = 'cancelled';

  await execute(
    'UPDATE players SET idle_queue = $1, updated_at = NOW() WHERE user_id = $2',
    [JSON.stringify(idleQueue), userId]
  );

  // 从 Redis 队列移除
  const cancelledTask = idleQueue[activeTaskIndex];
  await removeGatheringTask(userId, cancelledTask.skillType, new Date(cancelledTask.startedAt).getTime());

  return true;
}

/**
 * 检查并完成到期的采集任务（定时任务调用）
 * @param userId 用户ID
 */
export async function checkAndCompleteGathering(userId: string): Promise<GatheringTask | null> {
  const playerResult = await query<{
    idle_queue: GatheringTask[];
  }>(
    'SELECT idle_queue FROM players WHERE user_id = $1',
    [userId]
  );

  if (playerResult.length === 0) {
    return null;
  }

  const idleQueue: GatheringTask[] = playerResult[0].idle_queue || [];
  const activeTask = idleQueue.find(task => task.status === 'active');

  if (!activeTask) {
    return null;
  }

  const startTime = new Date(activeTask.startedAt).getTime();
  const now = Date.now();
  const elapsedSeconds = (now - startTime) / 1000;

  if (elapsedSeconds >= activeTask.duration) {
    return completeGathering(userId);
  }

  return null;
}

export interface GatheringEfficiency {
  skillType: SkillType;
  baseYield: number; // per minute
  gearBonus: number;
  effectiveYield: number; // per minute (baseYield * (1 + gearBonus))
  primaryResource: string;
  byproduct: string;
  byproductChance: number;
}

export interface GatheringEfficiencyResult {
  success: boolean;
  efficiency: GatheringEfficiency[];
  totalBonus: number;
  error?: string;
}

/**
 * 获取玩家采集效率信息
 * @param userId 用户ID
 */
export async function getGatheringEfficiency(userId: string): Promise<GatheringEfficiencyResult> {
  // 1. 获取玩家生产装备数据
  const playerResult = await query<{
    production_gear: Record<string, number>;
  }>('SELECT production_gear FROM players WHERE user_id = $1', [userId]);

  if (playerResult.length === 0) {
    return { success: false, efficiency: [], totalBonus: 0, error: 'Player not found' };
  }

  const productionGear = playerResult[0].production_gear || {};

  // 2. 获取采集配置
  const config = await getConfig();

  // 3. 计算每个技能的效率
  const efficiency: GatheringEfficiency[] = [];
  let totalBonus = 0;

  for (const skillType of ['mining', 'woodcutting', 'herbalism'] as SkillType[]) {
    const skillConfig = config[skillType];
    const gearBonusKey = `${skillType}_bonus`;
    const gearBonus = productionGear[gearBonusKey] || 0;
    const effectiveYield = skillConfig.baseRate * (1 + gearBonus);

    efficiency.push({
      skillType,
      baseYield: skillConfig.baseRate,
      gearBonus,
      effectiveYield,
      primaryResource: skillConfig.primaryResource,
      byproduct: skillConfig.byproduct,
      byproductChance: skillConfig.byproductChance,
    });

    totalBonus += gearBonus;
  }

  return {
    success: true,
    efficiency,
    totalBonus,
  };
}

/**
 * 处理到期的采集任务（从 Redis 队列）
 * 由定时任务调用，遍历 Redis 队列处理所有到期任务
 * @returns 处理完成的任务数量
 */
export async function processDueGatheringTasks(): Promise<number> {
  const now = Date.now();
  const dueTasks = await getDueGatheringTasks(now);

  let processedCount = 0;

  for (const task of dueTasks) {
    // 尝试获取锁，防止重复处理
    const lockAcquired = await acquireGatheringLock(task.userId);
    if (!lockAcquired) {
      continue;
    }

    try {
      const completedTask = await checkAndCompleteGathering(task.userId);
      if (completedTask) {
        // 任务完成，从 Redis 队列移除
        await removeGatheringTask(task.userId, task.skillType, task.enqueuedAt);
        processedCount++;
        console.log(`[Gathering] Processed task for user ${task.userId}:`, completedTask.result);
      } else {
        // 任务不存在或已取消，从 Redis 队列移除
        await removeGatheringTask(task.userId, task.skillType, task.enqueuedAt);
      }
    } finally {
      // 释放锁
      await releaseGatheringLock(task.userId);
    }
  }

  return processedCount;
}
