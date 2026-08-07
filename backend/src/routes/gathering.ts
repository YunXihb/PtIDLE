import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { startGatheringSchema } from '../validations/gathering';
import {
  startGatheringHandler,
  getGatheringStatusHandler,
  completeGatheringHandler,
  cancelGatheringHandler,
  getGatheringEfficiencyHandler,
} from '../controllers/gatheringController';

const router = Router();

// 所有采集路由都需要认证
router.use(authMiddleware);

// POST /api/gathering/start - 开始采集任务
router.post('/start', validate(startGatheringSchema), (req: Request, res: Response, next: NextFunction) => {
  startGatheringHandler(req as AuthRequest, res, next).catch(next);
});

// GET /api/gathering/status - 查询采集状态
router.get('/status', (req: Request, res: Response, next: NextFunction) => {
  getGatheringStatusHandler(req as AuthRequest, res, next).catch(next);
});

// POST /api/gathering/complete - 完成采集任务
router.post('/complete', (req: Request, res: Response, next: NextFunction) => {
  completeGatheringHandler(req as AuthRequest, res, next).catch(next);
});

// POST /api/gathering/cancel - 取消采集任务
router.post('/cancel', (req: Request, res: Response, next: NextFunction) => {
  cancelGatheringHandler(req as AuthRequest, res, next).catch(next);
});

// GET /api/gathering/efficiency - 获取采集效率信息
router.get('/efficiency', (req: Request, res: Response, next: NextFunction) => {
  getGatheringEfficiencyHandler(req as AuthRequest, res, next).catch(next);
});

export default router;
