import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import {
  startGathering,
  getGatheringStatus,
  completeGathering,
  cancelGathering,
  getGatheringEfficiency,
  SkillType,
} from '../services/gatheringService';

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
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { skillType, characterId } = req.body as StartGatheringBody;

    // 验证技能类型
    if (!['mining', 'woodcutting', 'herbalism'].includes(skillType)) {
      res.status(400).json({
        error: 'Invalid skill type',
        message: 'Skill type must be mining, woodcutting, or herbalism',
      });
      return;
    }

    const task = await startGathering(userId, skillType, characterId);

    if (!task) {
      res.status(404).json({ error: 'Player not found' });
      return;
    }

    res.status(201).json({
      success: true,
      data: task,
    });
  } catch (error) {
    console.error('Error starting gathering:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    if (errorMessage.includes('已有进行中的采集任务')) {
      res.status(400).json({ error: 'Already has active gathering task' });
      return;
    }

    res.status(500).json({ error: 'Internal server error' });
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
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const status = await getGatheringStatus(userId);

    if (!status) {
      res.json({
        success: true,
        data: null,
        message: 'No active gathering task',
      });
      return;
    }

    res.json({
      success: true,
      data: status,
    });
  } catch (error) {
    console.error('Error getting gathering status:', error);
    res.status(500).json({ error: 'Internal server error' });
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
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const completedTask = await completeGathering(userId);

    if (!completedTask) {
      res.status(400).json({
        error: 'No active gathering task or task not yet completed',
      });
      return;
    }

    res.json({
      success: true,
      data: completedTask,
    });
  } catch (error) {
    console.error('Error completing gathering:', error);
    res.status(500).json({ error: 'Internal server error' });
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
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const cancelled = await cancelGathering(userId);

    if (!cancelled) {
      res.status(400).json({
        error: 'No active gathering task to cancel',
      });
      return;
    }

    res.json({
      success: true,
      message: 'Gathering task cancelled',
    });
  } catch (error) {
    console.error('Error cancelling gathering:', error);
    res.status(500).json({ error: 'Internal server error' });
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
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const result = await getGatheringEfficiency(userId);

    if (!result.success) {
      res.status(404).json({ error: result.error });
      return;
    }

    res.json({
      success: true,
      data: {
        efficiency: result.efficiency,
        totalBonus: result.totalBonus,
      },
    });
  } catch (error) {
    console.error('Error getting gathering efficiency:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
