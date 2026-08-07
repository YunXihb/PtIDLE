import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import {
  startGathering,
  getGatheringStatus,
  completeGathering,
  cancelGathering,
  getGatheringEfficiency,
  SkillType,
} from '../services/gatheringService';
import { ok, fail } from '../utils/http';

interface StartGatheringBody {
  skillType: SkillType;
  characterId?: string;
}

/**
 * POST /api/gathering/start
 * 开始采集任务
 */
export async function startGatheringHandler(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      fail(res, 401, 'Unauthorized');
      return;
    }

    const { skillType, characterId } = req.body as StartGatheringBody;

    // 验证技能类型
    if (!['mining', 'woodcutting', 'herbalism'].includes(skillType)) {
      fail(res, 400, 'Invalid skill type');
      return;
    }

    const task = await startGathering(userId, skillType, characterId);

    if (!task) {
      fail(res, 404, 'Player not found');
      return;
    }

    ok(res, task, 201);
  } catch (error) {
    console.error('Error starting gathering:', error);

    // 用错误码匹配（T-FIX：替代脆弱的 `.includes('中文')` 匹配）
    const isAlreadyActive =
      error instanceof Error &&
      (error as Error & { code?: string }).code === 'GATHERING_ALREADY_ACTIVE';

    if (isAlreadyActive) {
      fail(res, 400, 'Already has active gathering task');
      return;
    }

    fail(res, 500, 'Internal server error');
  }
}

/**
 * GET /api/gathering/status
 * 查询当前采集状态
 */
export async function getGatheringStatusHandler(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      fail(res, 401, 'Unauthorized');
      return;
    }

    const status = await getGatheringStatus(userId);

    if (!status) {
      // 无活跃任务：data:null + message（测试断言 body.message，保留）
      res.json({
        success: true,
        data: null,
        message: 'No active gathering task',
      });
      return;
    }

    ok(res, status);
  } catch (error) {
    console.error('Error getting gathering status:', error);
    fail(res, 500, 'Internal server error');
  }
}

/**
 * POST /api/gathering/complete
 * 手动完成采集任务（通常由定时任务调用）
 */
export async function completeGatheringHandler(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      fail(res, 401, 'Unauthorized');
      return;
    }

    const completedTask = await completeGathering(userId);

    if (!completedTask) {
      fail(res, 400, 'No active gathering task or task not yet completed');
      return;
    }

    ok(res, completedTask);
  } catch (error) {
    console.error('Error completing gathering:', error);
    fail(res, 500, 'Internal server error');
  }
}

/**
 * POST /api/gathering/cancel
 * 取消采集任务
 */
export async function cancelGatheringHandler(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      fail(res, 401, 'Unauthorized');
      return;
    }

    const cancelled = await cancelGathering(userId);

    if (!cancelled) {
      fail(res, 400, 'No active gathering task to cancel');
      return;
    }

    ok(res, null);
  } catch (error) {
    console.error('Error cancelling gathering:', error);
    fail(res, 500, 'Internal server error');
  }
}

/**
 * GET /api/gathering/efficiency
 * 获取采集效率信息（包含装备加成）
 */
export async function getGatheringEfficiencyHandler(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      fail(res, 401, 'Unauthorized');
      return;
    }

    const result = await getGatheringEfficiency(userId);

    if (!result.success) {
      fail(res, 404, result.error!);
      return;
    }

    ok(res, {
      efficiency: result.efficiency,
      totalBonus: result.totalBonus,
    });
  } catch (error) {
    console.error('Error getting gathering efficiency:', error);
    fail(res, 500, 'Internal server error');
  }
}
