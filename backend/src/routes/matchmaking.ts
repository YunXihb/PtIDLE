import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { joinMatchmakingHandler } from '../controllers/matchmakingController';

const router = Router();

// 所有匹配路由都需要认证
router.use(authMiddleware);

// POST /api/match/queue - 加入匹配队列
router.post('/queue', async (req: AuthRequest, res) => {
  await joinMatchmakingHandler(req, res);
});

export default router;
