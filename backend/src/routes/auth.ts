import { Router } from 'express';
import { register, handleLogin } from '../controllers/authController';
import { rateLimit } from '../middleware/rateLimit';

const router = Router();

// 登录/注册加 Redis 限流（防暴力破解/批量注册）：每 IP 每 60s 最多 20 次
router.post('/register', rateLimit('register', 60, 20), register);
router.post('/login', rateLimit('login', 60, 20), handleLogin);

export default router;
