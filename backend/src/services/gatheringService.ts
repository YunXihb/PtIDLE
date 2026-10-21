import { query, execute, withTransaction } from '../config/database';
import { getGatheringConfig, getGatheringSkillByType, clearSkillsCache } from './skillService';
import {
  enqueueGatheringTask,
  removeGatheringTask,
  getDueGatheringTasks,
  acquireGatheringLock,
  releaseGatheringLock,
  isGatheringTaskQueued,
} from './idleQueueService';
import { ApiError } from '../utils/ApiError';

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
  // 轮次：第 1 轮是玩家手动发起的首次采集，之后每轮自动 +1（连续采集）
  round?: number;
  // 入队时间戳：Redis 有序集合 member 的组成部分，
  // 必须与 removeGatheringTask 使用的值一致，否则取消任务时 zRem 匹配不上
  enqueuedAt?: number;
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

// idle_queue 只保留最近这么多条（连续采集时避免无限增长）
const IDLE_QUEUE_KEEP = 2;

// 下一轮允许"回拨"的最大秒数。
// 定时器每 10s 扫一次队列，完成时刻最晚会比计划结束晚约 10s；
// 允许小幅回拨可以把这段延迟还给玩家，但限制回拨幅度以防玩家离线后
// 被一口气补发多轮（刷收益）。
const MAX_BACKDATE_SECONDS = 15;

/**
 * 生成采集任务 id
 */
function newTaskId(): string {
  return `gathering_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 取任务的 Redis 队列键（member 里的 enqueuedAt）。
 * 兼容本功能上线前创建的历史任务：它们没有 enqueuedAt 字段，回退到 startedAt。
 */
function queueKeyOf(task: GatheringTask): number {
  return task.enqueuedAt ?? new Date(task.startedAt).getTime();
}

/**
 * idle_queue 只保留最近 IDLE_QUEUE_KEEP 条
 */
function trimIdleQueue(queue: GatheringTask[]): GatheringTask[] {
  return queue.length > IDLE_QUEUE_KEEP ? queue.slice(-IDLE_QUEUE_KEEP) : queue;
}

/**
 * 确保活跃任务在 Redis 队列中（幂等）。
 * member 由 {userId, skillType, enqueuedAt} 唯一确定，
 * 重复入队只会覆盖同一条，不会产生重复条目。
 */
async function ensureQueued(userId: string, task: GatheringTask): Promise<void> {
  const enqueuedAt = queueKeyOf(task);
  const queued = await isGatheringTaskQueued(userId, task.skillType, enqueuedAt);
  if (queued) {
    return;
  }
  const completionTime = new Date(task.startedAt).getTime() + task.duration * 1000;
  await enqueueGatheringTask(userId, task.skillType, completionTime, enqueuedAt);
}

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
    throw new ApiError(400, 'Already has active gathering task');
  }

  // 3. 创建新采集任务
  const config = (await getConfig())[skillType];
  const now = new Date();
  const task: GatheringTask = {
    id: newTaskId(),
    skillType,
    characterId,
    startedAt: now.toISOString(),
    duration: DEFAULT_GATHERING_DURATION,
    status: 'active',
    round: 1,
    enqueuedAt: Date.now(),
  };

  // 4. 更新 idle_queue（只保留最近两轮，避免连续采集时无限增长）
  const newIdleQueue = trimIdleQueue([...idleQueue, task]);
  await execute(
    'UPDATE players SET idle_queue = $1, updated_at = NOW() WHERE user_id = $2',
    [JSON.stringify(newIdleQueue), userId]
  );

  // 5. 添加到 Redis 队列（enqueuedAt 必须与任务里记录的一致，否则无法正确移除）
  const completionTime = now.getTime() + (DEFAULT_GATHERING_DURATION * 1000);
  await enqueueGatheringTask(userId, skillType, completionTime, task.enqueuedAt);

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

  // Redis 自愈：队列条目丢失（Redis 重启/数据丢失）时补回，
  // 否则定时器看不到任务，连续采集会在这一轮停住。
  await ensureQueued(userId, activeTask);

  // 计算进度
  const startTime = new Date(activeTask.startedAt).getTime();
  const now = Date.now();
  const elapsedExact = (now - startTime) / 1000;
  // elapsedSeconds 取整用于界面显示（"5/60秒"）
  const elapsedSeconds = Math.floor(elapsedExact);
  // progress 保留精确小数：前端据此做本地插值，让进度条连续平滑增长。
  // 若这里取整，前端每次采样只能拿到整秒值，插值锚点会随之跳动（每秒误差 1 秒）。
  const progress = Math.min(elapsedExact / activeTask.duration, 1);

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
 *
 * 连续采集：结算本轮的同时，在同一个事务里创建下一轮 active 任务
 * （同技能、同角色、轮次 +1），事务提交后再把下一轮放进 Redis 队列。
 * 这样无论玩家是否开着页面，采集都会一轮接一轮地跑下去。
 *
 * @param userId 用户ID
 */
export async function completeGathering(userId: string): Promise<GatheringTask | null> {
  // 单事务 + 行锁（SELECT ... FOR UPDATE）保证并发 complete 幂等：
  //   两个并发请求同时进来时，第二个会等第一个 COMMIT，读到已 completed 的任务 → 返回 null
  const outcome = await withTransaction(async (client) => {
    // 1. 行锁读玩家数据
    const playerResult = await client.query<{
      id: string;
      resources: Record<string, number>;
      warehouse_limits: Record<string, number>;
      idle_queue: GatheringTask[];
      production_gear: Record<string, any>;
    }>(
      'SELECT id, resources, warehouse_limits, idle_queue, production_gear FROM players WHERE user_id = $1 FOR UPDATE',
      [userId]
    );

    if (playerResult.rows.length === 0) {
      return null;
    }

    const player = playerResult.rows[0];
    const idleQueue: GatheringTask[] = player.idle_queue || [];

    // 2. 查找活跃任务（行锁下只会有一个请求走到这里）
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

    // 7. 本轮标记完成
    const completedTask: GatheringTask = {
      ...activeTask,
      status: 'completed',
      result: {
        resources: stored,
        overflowed: actualOverflowed,
      },
    };

    // 8. 连续采集：开启下一轮
    //    计划结束时刻 = 本轮开始 + 时长；允许小幅回拨（抵消定时器的扫描延迟），
    //    但回拨幅度受限，避免玩家长时间离线后被一口气补发多轮。
    const scheduledEnd = startTime + activeTask.duration * 1000;
    const nextStart = Math.max(scheduledEnd, now - MAX_BACKDATE_SECONDS * 1000);
    const nextTask: GatheringTask = {
      id: newTaskId(),
      skillType: activeTask.skillType,
      characterId: activeTask.characterId,
      startedAt: new Date(nextStart).toISOString(),
      duration: activeTask.duration,
      status: 'active',
      round: (activeTask.round ?? 1) + 1,
      enqueuedAt: Date.now(),
    };

    // 9. idle_queue 只保留最近两轮（本轮 completed + 下一轮 active）
    const newIdleQueue = trimIdleQueue([
      ...idleQueue.filter((_, index) => index !== activeTaskIndex),
      completedTask,
      nextTask,
    ]);

    await client.query(
      'UPDATE players SET resources = $1, idle_queue = $2, updated_at = NOW() WHERE user_id = $3',
      [JSON.stringify(updatedResources), JSON.stringify(newIdleQueue), userId]
    );

    return { completedTask, nextTask };
  });

  if (!outcome) {
    return null;
  }

  const { completedTask, nextTask } = outcome;

  // 10. 事务提交后再动 Redis（事务内做外部 IO 有回滚风险）
  //     本轮条目出队 + 下一轮入队
  await removeGatheringTask(userId, completedTask.skillType, queueKeyOf(completedTask));
  const nextCompletionTime = new Date(nextTask.startedAt).getTime() + nextTask.duration * 1000;
  await enqueueGatheringTask(userId, nextTask.skillType, nextCompletionTime, nextTask.enqueuedAt);

  return completedTask;
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

  const cancelledTask = idleQueue[activeTaskIndex];
  cancelledTask.status = 'cancelled';

  // 只保留最近两轮
  const newIdleQueue = trimIdleQueue(idleQueue);

  await execute(
    'UPDATE players SET idle_queue = $1, updated_at = NOW() WHERE user_id = $2',
    [JSON.stringify(newIdleQueue), userId]
  );

  // 从 Redis 队列移除
  // 注意：member 里的 enqueuedAt 必须和入队时一致，否则 zRem 匹配不上，
  // 被取消的任务会永远残留在队列里（僵尸条目）。
  await removeGatheringTask(userId, cancelledTask.skillType, queueKeyOf(cancelledTask));

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
