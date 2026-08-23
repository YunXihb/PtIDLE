/**
 * 到期扫描器 (Deadline Sweeper) -- T1014
 *
 * 全局 1s interval 扫 Redis ZSET `battle:deadline_index`（score = 到期时间）：
 * - `deploy:{battleId}` 到期 -> startBattle（finalizeDeployment 幂等：
 *   已确认方用玩家配置，未确认/超时方自动配置）
 * - `step:{battleId}` 到期 -> executeEndStep（与手动 skip_play 完全相同路径；
 *   move 阶段未动 = 放弃移动）
 *
 * 与手动操作并发安全（无双触发）：
 * - 布置：finalizeDeployment 写锁 + 幂等；startBattle 有 in-flight 守卫
 *   （sweeper 与双方确认同时触发只跑一次）
 * - 步时：触发前比对 step_deadline 记录与 session 的 step/actor，
 *   手动 skip/play 已推进则记录失配 -> 仅清理不触发
 *
 * 重启恢复：时限全部在 Redis（索引 + 记录 key），nodemon 重启后 sweeper
 * 重新启动继续扫描，不丢时限。
 *
 * 本模块依赖各 battle 服务（deployment/initialization/action/session），
 * 只被 src/index.ts 引用，避免循环依赖。
 */

import type { Server as IOServer } from 'socket.io';
import { redisClient } from '../config/redis';
import { queryOne } from '../config/database';
import { redisKey } from '../utils/redisKeys';
import {
  DEADLINE_RETRY_BACKOFF_MS,
  SWEEP_INTERVAL_MS,
  clearStepDeadline,
  deadlineMember,
  getStepDeadline,
  parseDeadlineMember,
} from './battleDeadlineService';
import { readDeploymentState } from './deploymentService';
import { startBattle } from './battleInitializationService';
import { executeEndStep } from './battleActionService';
import { getSessionState } from './battleSessionService';

// ========================================
// 生命周期
// ========================================

let sweepTimer: ReturnType<typeof setInterval> | null = null;

/** 启动 sweeper（src/index.ts 服务初始化后调用；幂等） */
export function startDeadlineSweeper(io: IOServer): void {
  if (sweepTimer) {
    return;
  }
  sweepTimer = setInterval(() => {
    void sweepDeadlines(io).catch((err) => {
      console.error('[DeadlineSweeper] sweep error:', err);
    });
  }, SWEEP_INTERVAL_MS);
  console.log(`[DeadlineSweeper] started (interval ${SWEEP_INTERVAL_MS}ms)`);
}

/** 停止 sweeper（优雅关闭时调用） */
export function stopDeadlineSweeper(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
    console.log('[DeadlineSweeper] stopped');
  }
}

// ========================================
// 扫描主循环
// ========================================

/** 单轮扫描进行中标记：上一轮未完成时跳过本轮（防堆积） */
let sweeping = false;

/**
 * 执行一轮扫描（导出供测试直接调用）
 * - 取 score <= now 的全部到期 member，逐条隔离处理（单条失败不影响其余）
 */
export async function sweepDeadlines(io: IOServer): Promise<void> {
  if (sweeping) {
    return;
  }
  sweeping = true;
  try {
    const now = Date.now();
    const members = await redisClient.zRangeByScore(redisKey.deadlineIndex(), 0, now);
    for (const member of members) {
      try {
        await dispatchExpiredMember(io, member, now);
      } catch (err) {
        console.error(`[DeadlineSweeper] member '${member}' handling failed:`, err);
      }
    }
  } finally {
    sweeping = false;
  }
}

async function dispatchExpiredMember(
  io: IOServer,
  member: string,
  now: number
): Promise<void> {
  const parsed = parseDeadlineMember(member);
  if (!parsed) {
    // 未知格式（历史残留）-> 清理
    await redisClient.zRem(redisKey.deadlineIndex(), member);
    return;
  }
  if (parsed.type === 'deploy') {
    await handleDeploymentExpiry(io, parsed.battleId, member, now);
  } else {
    await handleStepExpiry(io, parsed.battleId, member, now);
  }
}

// ─── 布置到期 -> 开战 ─────────────────────────────────────

/**
 * 布置 120s 到期处理：
 * 1. 对局已非 pending（已开战/认输结束）-> 索引残留，清理
 * 2. 布置状态已被清理（开战成功但 ZREM 竞态漏删）-> 清理
 * 3. 触发 startBattle：finalize（超时方自动配置）+ 开战
 *    - 成功：cleanupDeployment 已清索引，兜底再 ZREM 一次
 *    - 失败：退避 10s 后重试（finalize 幂等，重试安全）
 */
async function handleDeploymentExpiry(
  io: IOServer,
  battleId: string,
  member: string,
  now: number
): Promise<void> {
  const indexKey = redisKey.deadlineIndex();

  const battle = await queryOne<{ status: string }>(
    `SELECT status FROM battles WHERE id = $1`,
    [battleId]
  );
  if (!battle || battle.status !== 'pending') {
    await redisClient.zRem(indexKey, member);
    return;
  }

  const state = await readDeploymentState(battleId);
  if (!state) {
    // 布置状态已清理（开战成功路径的 cleanup 已执行）
    await redisClient.zRem(indexKey, member);
    return;
  }

  const start = await startBattle(io, battleId);
  if (start.success) {
    // cleanupDeployment 已清索引；并发竞态下兜底再删
    await redisClient.zRem(indexKey, member);
    return;
  }
  if (start.error !== 'start_already_in_progress') {
    console.error(
      `[DeadlineSweeper] deployment expiry startBattle failed (retry in ${
        DEADLINE_RETRY_BACKOFF_MS / 1000
      }s): battleId=${battleId} step=${start.failedStep}:`,
      start.error
    );
  }
  // 退避重试（in-flight 守卫的 busy 属正常并发，静默重试）
  await redisClient.zAdd(indexKey, {
    score: now + DEADLINE_RETRY_BACKOFF_MS,
    value: deadlineMember.deployment(battleId),
  });
}

// ─── 步时到期 -> 推进步骤 ──────────────────────────────────

/**
 * 步时 90s 到期处理：
 * 0. 认领前自检：score 已被新一步激活重置为未来 -> 跳过
 * 1. ZREM 认领（新一步激活会重写同 member，认领后读记录自愈恢复）
 * 2. 记录已清理 -> 结束；记录 deadline 在未来（认领期间被重写）-> 恢复索引
 * 3. session 不存在/已结束 -> 清理（战斗结束，finishSession 漏清兜底）
 * 4. step/actor 与 session 失配（手动 skip/play 已推进）-> 仅清旧记录
 * 5. 匹配 -> executeEndStep（与手动 skip_play 同路径，move 未动 = 放弃移动）
 */
async function handleStepExpiry(
  io: IOServer,
  battleId: string,
  member: string,
  now: number
): Promise<void> {
  const indexKey = redisKey.deadlineIndex();

  // 0. 认领前自检：score 已是未来（新激活重置）-> 跳过
  const score = await redisClient.zScore(indexKey, member);
  if (score === null || score > now) {
    return;
  }
  // 1. 认领
  await redisClient.zRem(indexKey, member);

  // 2. 读步时记录
  const record = await getStepDeadline(battleId);
  if (!record) {
    return; // 已被清理（战斗结束/推进）
  }
  if (Date.parse(record.deadline) > now) {
    // 自愈：认领期间新一步激活重写了记录 -> 恢复索引条目
    await redisClient.zAdd(indexKey, {
      score: Date.parse(record.deadline),
      value: deadlineMember.step(battleId),
    });
    return;
  }

  // 3. 战斗已结束/状态不存在
  const state = await getSessionState(battleId);
  if (!state || state.currentPhase === 'finished') {
    await clearStepDeadline(battleId);
    return;
  }

  // 4. 手动推进已发生（skip/play 触发的激活会重写记录与索引）-> 清旧记录即可
  if (state.currentStep !== record.step || state.currentActorId !== record.actorId) {
    await redisClient.del(redisKey.stepDeadline(battleId));
    return;
  }

  // 5. 步时到点 -> 与手动 skip_play 相同路径推进
  const result = await executeEndStep(io, battleId);
  if (result.success) {
    return; // executeEndStep 内的激活已重写步时记录 + 索引
  }
  // 失败退避重试（下次扫描重比对 step/actor，若已推进则自然清理）
  console.error(
    `[DeadlineSweeper] step expiry executeEndStep failed (retry in ${
      DEADLINE_RETRY_BACKOFF_MS / 1000
    }s): battleId=${battleId}:`,
    result.error
  );
  await redisClient.zAdd(indexKey, {
    score: Date.now() + DEADLINE_RETRY_BACKOFF_MS,
    value: deadlineMember.step(battleId),
  });
}
