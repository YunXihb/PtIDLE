import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    username: string;
  };
}

export function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  // 从 Authorization header 获取 token
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }

  const token = authHeader.substring(7); // 移除 'Bearer ' 前缀

  try {
    const secret = process.env.JWT_SECRET || 'your_jwt_secret_change_in_production';
    const decoded = jwt.verify(token, secret) as { userId: string; username: string };

    // 将用户信息附加到请求对象
    req.user = {
      userId: decoded.userId,
      username: decoded.username
    };

    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
}
