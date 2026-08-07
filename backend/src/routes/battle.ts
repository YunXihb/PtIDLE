// ========================================
// T054 对战结算路由
// ========================================
// POST /api/battle/result - 触发结算（任一方玩家）
//
// 所有路由均需 JWT 认证。

import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { settleSchema } from '../validations/battle';
import { settleBattleHandler } from '../controllers/battleController';

const router = Router();

// 所有战斗路由都需要认证
router.use(authMiddleware);

// POST /api/battle/result - 对战结算
router.post('/result', validate(settleSchema), (req: Request, res: Response, next: NextFunction) => {
  settleBattleHandler(req as AuthRequest, res, next).catch(next);
});

export default router;
