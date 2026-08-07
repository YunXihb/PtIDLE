import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import {
  getPlayerProfile,
  claimOfflineEarnings,
} from '../services/playerService';
import {
  calculateOfflineEarnings,
  applyWarehouseLimits,
} from '../services/offlineService';
import { ok, fail } from '../utils/http';

const router = Router();

// 获取玩家完整信息
router.get('/profile', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      fail(res, 401, 'Unauthorized');
      return;
    }

    const profile = await getPlayerProfile(userId);

    if (!profile) {
      fail(res, 404, 'Player not found');
      return;
    }

    ok(res, profile);
  } catch (error) {
    next(error);
  }
});

// 离线收益结算
router.post('/offline-claim', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      fail(res, 401, 'Unauthorized');
      return;
    }

    // 1-5. 原子领取（单事务 + 行锁）：读玩家 -> 算收益 -> 合并资源 + 更新 last_offline
    const outcome = await claimOfflineEarnings(userId, (base) => {
      const earnings = calculateOfflineEarnings(base.last_offline);
      const { stored, overflowed } = applyWarehouseLimits(
        earnings,
        base.resources,
        base.warehouse_limits
      );
      return {
        offlineTime: earnings.offlineTime,
        earned: earnings.resources,
        stored,
        overflowed,
      };
    });

    if (!outcome) {
      fail(res, 404, 'Player not found');
      return;
    }

    // 6. 返回收益详情
    ok(res, {
      offlineTime: outcome.offlineTime,
      earned: outcome.earned,
      stored: outcome.stored,
      overflowed: outcome.overflowed,
      lastOffline: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
