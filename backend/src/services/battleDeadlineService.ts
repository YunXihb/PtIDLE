/**
 * 对局计时服务 (Battle Deadline Service) -- T1014
 *
 * 权威时限只存 Redis（防 nodemon / 部署重启丢失内存定时器）：
 * - 步时：`battle:{id}:step_deadline`（JSON 记录，含 step + actorId）
 * - 全局到期索引：`battle:deadline_index`（ZSET，score = 到期时间 ms）
 *   - member `deploy:{battleId}`：布置阶段 120s 时限（createDeployment 写入）
 *   - member `step:{battleId}`：当前步 90s 时限（activateCurrentUnit 写入）
 *
 * 本模块只提供 arm/clear/read 辅助，不依赖任何 battle 服务（避免循环依赖）；
 * 扫描与触发逻辑见 `deadlineSweeper.ts`（由 src/index.ts 启动）。
 *
 * 所有写操作 best-effort：失败仅记日志不抛出（计时是增强能力，
 * 不能阻塞主流程；sweeper 对索引残留条目有自愈清理）。
 */

import { redisClient } from '../config/redis';
import { redisKey } from '../utils/redisKeys';

// ========================================
// 常量（T1010 设计锁定）
// ========================================

/** 每棋子步时（draw+move+play 全程，不因操作重置） */
export const STEP_DURATION_MS = 90 * 1000;

/** sweeper 扫描间隔 */
export const SWEEP_INTERVAL_MS = 1000;

/** 触发失败后的退避重试间隔（防每秒重试刷屏） */
export const DEADLINE_RETRY_BACKOFF_MS = 10 * 1000;

// ========================================
// 类型定义
// ========================================

/** 步时记录（存 Redis `battle:{id}:step_deadline`） */
export interface StepDeadlineRecord {
  battleId: string;
  step: number;
  actorId: string;
  deadline: string; // ISO
}

/** 到期索引 member 编解码 */
export const deadlineMember = {
  deployment: (battleId: string) => `deploy:${battleId}`,
  step: (battleId: string) => `step:${battleId}`,
};

export function parseDeadlineMember(
  member: string
): { type: 'deploy' | 'step'; battleId: string } | null {
  const idx = member.indexOf(':');
  if (idx <= 0) {
    return null;
  }
  const type = member.slice(0, idx);
  const battleId = member.slice(idx + 1);
  if ((type === 'deploy' || type === 'step') && battleId) {
    return { type, battleId };
  }
  return null;
}

// ========================================
// 步时（step）
// ========================================

/**
 * 武装当前步步时（activateCurrentUnit 激活时调用）
 * @returns 记录（含 deadline），供调用方广播
 */
export async function armStepDeadline(
  battleId: string,
  step: number,
  actorId: string
): Promise<StepDeadlineRecord | null> {
  const deadlineMs = Date.now() + STEP_DURATION_MS;
  const record: StepDeadlineRecord = {
    battleId,
    step,
    actorId,
    deadline: new Date(deadlineMs).toISOString(),
  };
  try {
    await redisClient.set(redisKey.stepDeadline(battleId), JSON.stringify(record));
    await redisClient.zAdd(redisKey.deadlineIndex(), {
      score: deadlineMs,
      value: deadlineMember.step(battleId),
    });
    return record;
  } catch (err) {
    console.error(`[battleDeadlineService] armStepDeadline failed: battleId=${battleId}`, err);
    return null;
  }
}

/**
 * 清除步时（finishSession / deleteSession / 战斗结束时调用）
 */
export async function clearStepDeadline(battleId: string): Promise<void> {
  try {
    await redisClient.del(redisKey.stepDeadline(battleId));
  } catch (err) {
    console.error(`[battleDeadlineService] clearStepDeadline del failed: battleId=${battleId}`, err);
  }
  try {
    await redisClient.zRem(redisKey.deadlineIndex(), deadlineMember.step(battleId));
  } catch (err) {
    console.error(`[battleDeadlineService] clearStepDeadline zRem failed: battleId=${battleId}`, err);
  }
}

/** 读取步时记录（不存在/损坏返回 null） */
export async function getStepDeadline(battleId: string): Promise<StepDeadlineRecord | null> {
  try {
    const raw = await redisClient.get(redisKey.stepDeadline(battleId));
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as StepDeadlineRecord;
  } catch {
    return null;
  }
}

// ========================================
// 布置时限（deployment）
// ========================================

/** 武装布置时限索引（createDeployment 写入状态后调用） */
export async function armDeploymentDeadline(
  battleId: string,
  deadlineMs: number
): Promise<void> {
  try {
    await redisClient.zAdd(redisKey.deadlineIndex(), {
      score: deadlineMs,
      value: deadlineMember.deployment(battleId),
    });
  } catch (err) {
    console.error(`[battleDeadlineService] armDeploymentDeadline failed: battleId=${battleId}`, err);
  }
}

/** 清除布置时限索引（cleanupDeployment 调用） */
export async function clearDeploymentDeadline(battleId: string): Promise<void> {
  try {
    await redisClient.zRem(redisKey.deadlineIndex(), deadlineMember.deployment(battleId));
  } catch (err) {
    console.error(`[battleDeadlineService] clearDeploymentDeadline failed: battleId=${battleId}`, err);
  }
}
