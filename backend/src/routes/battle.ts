// ========================================
// T054 对战结算路由
// ========================================
// POST /api/battle/result - 触发结算（任一方玩家）
//
// 所有路由均需 JWT 认证。

import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { settleBattleHandler } from '../controllers/battleController';

const router = Router();

// 所有战斗路由都需要认证
router.use(authMiddleware);

// POST /api/battle/result - 对战结算
router.post('/result', async (req: AuthRequest, res) => {
  await settleBattleHandler(req, res);
});

export default router;
