import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import {
  enqueueMatchmaking,
  getMatchmakingStatus,
  leaveMatchmaking,
} from '../services/matchmakingService';

/**
 * POST /api/match/queue
 * 加入匹配队列
 *
 * T042 范围：仅入队。不做 3v3 校验、撮合、battle 行创建（见 matchmakingService.ts 顶部说明）。
 */
export async function joinMatchmakingHandler(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const entry = await enqueueMatchmaking(userId);

    res.status(201).json({
      success: true,
      data: entry,
    });
  } catch (error) {
    console.error('Error joining matchmaking queue:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    if (errorMessage.includes('已在匹配队列中')) {
      res.status(400).json({ error: 'Already in matchmaking queue' });
      return;
    }

    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/match/queue
 * 查询当前匹配队列状态
 *
 * T043 范围：仅查询，不做撮合、battle 行创建。
 * 语义：「查询我的队列状态」始终是合法操作 —— 在队列返回 200 + status，不在队列返回 200 + null。
 */
export async function getMatchmakingStatusHandler(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const status = await getMatchmakingStatus(userId);

    res.status(200).json({
      success: true,
      data: status,
    });
  } catch (error) {
    console.error('Error fetching matchmaking status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * DELETE /api/match/queue
 * 取消匹配，离开队列
 *
 * T043 范围：仅离开队列 + 释放锁，不做撮合、battle 行创建、超时强制取消。
 * 对称 T042 语义：玩家不在队列时返回 400 + Error('不在匹配队列中')。
 */
export async function leaveMatchmakingHandler(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const entry = await leaveMatchmaking(userId);

    res.status(200).json({
      success: true,
      data: entry,
    });
  } catch (error) {
    console.error('Error leaving matchmaking queue:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    if (errorMessage.includes('不在匹配队列中')) {
      res.status(400).json({ error: 'Not in matchmaking queue' });
      return;
    }

    res.status(500).json({ error: 'Internal server error' });
  }
}
