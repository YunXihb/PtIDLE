import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import {
  joinMatchmakingHandler,
  getMatchmakingStatusHandler,
  leaveMatchmakingHandler,
} from '../controllers/matchmakingController';

const router = Router();

// 所有匹配路由都需要认证
router.use(authMiddleware);

// POST /api/match/queue - 加入匹配队列
router.post('/queue', async (req: AuthRequest, res) => {
  await joinMatchmakingHandler(req, res);
});

// GET /api/match/queue - 查询当前匹配队列状态
router.get('/queue', async (req: AuthRequest, res) => {
  await getMatchmakingStatusHandler(req, res);
});

// DELETE /api/match/queue - 取消匹配
router.delete('/queue', async (req: AuthRequest, res) => {
  await leaveMatchmakingHandler(req, res);
});

export default router;
