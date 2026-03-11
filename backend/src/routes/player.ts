import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();

// 示例受保护路由：获取玩家信息
router.get('/profile', authMiddleware, (req: AuthRequest, res) => {
  res.json({
    userId: req.user?.userId,
    username: req.user?.username,
    message: 'This is a protected route'
  });
});

export default router;
