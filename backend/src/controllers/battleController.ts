// ========================================
// T054 对战结算 Controller
// ========================================
// 路由: POST /api/battle/result
//   - 任一方玩家触发即可（不需要双方都调）
//   - 幂等：第二次调用跳过玩家数据写入,只返回已存数据
//   - 错误码: 401 / 400 / 403 / 404 / 409

import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { settleBattle } from '../services/battleSettlementService';

/**
 * POST /api/battle/result
 *
 * T054: 对战结算 API
 *
 * Request body:
 *   { battleId: string }
 *
 * Response 200:
 *   { success: true, data: SettlementResponse }
 *
 * Errors:
 *   - 401: 未认证（authMiddleware 已拦截）
 *   - 400: 缺 battleId / 类型错
 *   - 403: 调用者既不是 player1 也不是 player2
 *   - 404: battle 不存在
 *   - 409: battle 状态非 finished（pending/ongoing 都算「还没判完」）
 */
export async function settleBattleHandler(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      // authMiddleware 通常已拦截,这里是防御性兜底
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { battleId } = req.body ?? {};

    // 400: 缺 battleId / 类型错
    if (typeof battleId !== 'string' || battleId.length === 0) {
      res.status(400).json({ error: 'battleId is required (string)' });
      return;
    }

    const result = await settleBattle(battleId, userId);

    if (result.ok === false) {
      // result is { ok: false; error: 'battle_not_found' | 'not_participant' | 'battle_not_finished' }
      switch (result.error) {
        case 'battle_not_found':
          res.status(404).json({ error: 'Battle not found' });
          return;
        case 'not_participant':
          res.status(403).json({ error: 'Not a participant of this battle' });
          return;
        case 'battle_not_finished':
          res.status(409).json({ error: 'Battle is not finished yet' });
          return;
        default: {
          // Exhaustiveness: if a new variant is added, TS fails here at compile time.
          const _exhaustive: never = result.error;
          throw new Error(`Unhandled settlement error: ${String(_exhaustive)}`);
        }
      }
    }

    // result.ok === true: TS narrows via the early-return switch above
    res.status(200).json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    console.error('[T054] settleBattleHandler unexpected error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
