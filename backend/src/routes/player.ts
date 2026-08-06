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

const router = Router();

// 获取玩家完整信息
router.get('/profile', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const profile = await getPlayerProfile(userId);

    if (!profile) {
      res.status(404).json({ error: 'Player not found' });
      return;
    }

    res.json(profile);
  } catch (error) {
    console.error('Error fetching player profile:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 离线收益结算
router.post('/offline-claim', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // 1-5. 原子领取（单事务 + 行锁）：读玩家 → 算收益 → 合并资源 + 更新 last_offline
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
      res.status(404).json({ error: 'Player not found' });
      return;
    }

    // 6. 返回收益详情
    res.json({
      success: true,
      data: {
        offlineTime: outcome.offlineTime,
        earned: outcome.earned,
        stored: outcome.stored,
        overflowed: outcome.overflowed,
        lastOffline: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Error claiming offline earnings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
