import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import {
  getPlayerProfile,
  getPlayerBaseInfo,
  updateResources,
  updateLastOffline,
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

    // 1. 获取玩家基础信息
    const baseInfo = await getPlayerBaseInfo(userId);
    if (!baseInfo) {
      res.status(404).json({ error: 'Player not found' });
      return;
    }

    // 2. 计算离线收益
    const earnings = calculateOfflineEarnings(baseInfo.last_offline);

    // 3. 应用仓储上限
    const { stored, overflowed } = applyWarehouseLimits(
      earnings,
      baseInfo.resources,
      baseInfo.warehouse_limits
    );

    // 4. 更新玩家资源
    await updateResources(userId, stored);

    // 5. 更新离线时间
    await updateLastOffline(userId);

    // 6. 返回收益详情
    res.json({
      success: true,
      data: {
        offlineTime: earnings.offlineTime,
        earned: earnings.resources,
        stored,
        overflowed,
        lastOffline: baseInfo.last_offline,
      },
    });
  } catch (error) {
    console.error('Error claiming offline earnings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
