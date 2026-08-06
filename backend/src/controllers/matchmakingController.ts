import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import {
  enqueueMatchmaking,
  getMatchmakingStatus,
  leaveMatchmaking,
  tryMatch,
  getUserPendingBattle,
  MatchQueueStatus,
} from '../services/matchmakingService';
import { getIO } from '../socket/socketServer';
import { userRoom } from '../socket/battleRoom';

/**
 * POST /api/match/queue
 * 加入匹配队列，并同步尝试撮合。
 *
 * T044 范围：
 *   - 入队（enqueueMatchmaking）
 *   - 撮合（tryMatch）
 *   - 任一 alive < 3 → 400
 *   - 撮合成功 → 201 + { matched: true, data: { battleId, opponentUserId, ...entry } }
 *   - 撮合失败 → 201 + { matched: false, data: entry }
 *   - 重复入队 → 400 'Already in matchmaking queue'
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
    const result = await tryMatch(userId);

    if (result.matched) {
      // T046: 撮合成功 → 通过 WS 推 `battle:matched` 给双方（个人 room 通道）
      // picked 收到 opponentUserId = self (trigger),trigger 收到 opponentUserId = picked
      // 注:若对方未连接 WS,emit 静默失败,对方仍可走 REST 409 LOSER 兜底发现
      try {
        const io = getIO();
        io.to(userRoom(result.opponentUserId)).emit('battle:matched', {
          battleId: result.battleId,
          opponentUserId: userId,
        });
        io.to(userRoom(userId)).emit('battle:matched', {
          battleId: result.battleId,
          opponentUserId: result.opponentUserId,
        });
      } catch (err) {
        // io 未初始化或 emit 失败 → 仅记录,不阻塞 REST 响应
        console.error('[matchmaking] Failed to emit battle:matched:', err);
      }

      res.status(201).json({
        success: true,
        matched: true,
        data: {
          battleId: result.battleId,
          opponentUserId: result.opponentUserId,
          userId: entry.userId,
          enqueuedAt: entry.enqueuedAt,
        },
      });
      return;
    }

    // 撮合失败
    if (result.rejectionReason === 'self_not_eligible') {
      // self 不合格（alive<3）→ self 已从 queue 中清理
      res.status(400).json({
        error: 'Not enough alive characters (need ≥3)',
      });
      return;
    }

    // 其他失败原因（lock_failed / no_candidate / opponent_not_eligible）→ 仍在队列中
    res.status(201).json({
      success: true,
      matched: false,
      data: {
        userId: entry.userId,
        enqueuedAt: entry.enqueuedAt,
      },
    });
  } catch (error) {
    console.error('Error joining matchmaking queue:', error);

    // 用错误码匹配（T-FIX：替代脆弱的 `.includes('中文')` 匹配）
    const isAlreadyInQueue =
      error instanceof Error &&
      (error as Error & { code?: string }).code === 'ALREADY_IN_QUEUE';

    if (isAlreadyInQueue) {
      res.status(400).json({ error: 'Already in matchmaking queue' });
      return;
    }

    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/match/queue
 * 查询当前匹配状态（含 LOSER 兜底）。
 *
 * T044 范围：
 *   - 在队列 → 200 + { data: { inQueue: true, ...status } }
 *   - 不在队列但有 pending battle（LOSER 视角） → 200 + { data: { inQueue: false, matched: true, battleId, matchedAt } }
 *   - 真不在 → 200 + { data: { inQueue: false, matched: false } }
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

    if (status) {
      const data: MatchQueueStatus & { inQueue: true } = {
        ...status,
        inQueue: true,
      };
      res.status(200).json({
        success: true,
        data,
      });
      return;
    }

    // 不在队列 → 查 LOSER 兜底
    const pendingBattle = await getUserPendingBattle(userId);
    if (pendingBattle) {
      res.status(200).json({
        success: true,
        data: {
          inQueue: false,
          matched: true,
          battleId: pendingBattle.id,
          matchedAt: new Date(pendingBattle.matched_at).getTime(),
        },
      });
      return;
    }

    // 真不在
    res.status(200).json({
      success: true,
      data: {
        inQueue: false,
        matched: false,
      },
    });
  } catch (error) {
    console.error('Error fetching matchmaking status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * DELETE /api/match/queue
 * 取消匹配 / 处理 LOSER 试图取消的 409。
 *
 * T044 范围：
 *   - 在队列 → 200 + { status: 'left', ...entry }
 *   - 不在队列但有 pending battle（LOSER 视角） → 409 + { error: 'already_matched', data: { battleId } }
 *   - 真不在 → 400 'Not in matchmaking queue'
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
      status: 'left',
      data: entry,
    });
  } catch (error) {
    console.error('Error leaving matchmaking queue:', error);

    // 用错误码匹配（T-FIX：替代脆弱的 `.includes('中文')` 匹配）
    const isNotInQueue =
      error instanceof Error &&
      (error as Error & { code?: string }).code === 'NOT_IN_QUEUE';

    if (isNotInQueue) {
      // 不在队列 → 走 LOSER 兜底
      try {
        const userId = req.user?.userId;
        if (userId) {
          const pendingBattle = await getUserPendingBattle(userId);
          if (pendingBattle) {
            res.status(409).json({
              error: 'already_matched',
              data: {
                battleId: pendingBattle.id,
              },
            });
            return;
          }
        }
      } catch (innerErr) {
        console.error('Error checking pending battle on DELETE:', innerErr);
      }

      res.status(400).json({ error: 'Not in matchmaking queue' });
      return;
    }

    res.status(500).json({ error: 'Internal server error' });
  }
}
