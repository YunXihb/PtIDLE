import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { enqueueMatchmaking } from '../services/matchmakingService';

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
