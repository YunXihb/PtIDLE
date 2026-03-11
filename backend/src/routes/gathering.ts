import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import {
  startGatheringHandler,
  getGatheringStatusHandler,
  completeGatheringHandler,
  cancelGatheringHandler,
} from '../controllers/gatheringController';

const router = Router();

// 所有采集路由都需要认证
router.use(authMiddleware);

// POST /api/gathering/start - 开始采集任务
router.post('/start', async (req: AuthRequest, res) => {
  await startGatheringHandler(req, res);
});

// GET /api/gathering/status - 查询采集状态
router.get('/status', async (req: AuthRequest, res) => {
  await getGatheringStatusHandler(req, res);
});

// POST /api/gathering/complete - 完成采集任务
router.post('/complete', async (req: AuthRequest, res) => {
  await completeGatheringHandler(req, res);
});

// POST /api/gathering/cancel - 取消采集任务
router.post('/cancel', async (req: AuthRequest, res) => {
  await cancelGatheringHandler(req, res);
});

export default router;
