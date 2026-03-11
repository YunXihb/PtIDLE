import { Router } from 'express';
import { register, handleLogin } from '../controllers/authController';

const router = Router();

router.post('/register', register);
router.post('/login', handleLogin);

export default router;
