import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { getPlayerProfile } from '../services/playerService';

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

export default router;
