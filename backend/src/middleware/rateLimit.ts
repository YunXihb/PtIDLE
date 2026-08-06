import { Request, Response, NextFunction } from 'express';
import { redisClient } from '../config/redis';

/**
 * 登录/注册等敏感端点的 Redis 限流中间件
 *
 * 按「IP + 端点」分桶，窗口内超阈值返回 429。
 * Redis 不可用时降级放行（fail-open，避免阻塞正常请求）。
 *
 * 用法：
 *   router.post('/login', rateLimit('login', 60, 20), handler)
 *
 * @param bucket 桶名（端点标识）
 * @param windowSeconds 窗口秒数
 * @param max 窗口内最大次数
 */
export function rateLimit(
  bucket: string,
  windowSeconds: number = 60,
  max: number = 20
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // 取客户端 IP（Express 默认 req.ip；若经代理需配置 trust proxy）
    const ip = req.ip || 'unknown';
    const key = `rl:http:${bucket}:${ip}`;

    try {
      const result = (await redisClient.eval(
        RL_INCR_LUA,
        { keys: [key], arguments: [String(windowSeconds)] }
      )) as number;
      if (Number(result) > max) {
        res.status(429).json({ error: 'Too many requests, please try again later' });
        return;
      }
      next();
    } catch (err) {
      console.error(`[rateLimit] Redis error (degrade-allow):`, err);
      next();
    }
  };
}

// 原子 INCR + EXPIRE（首次设置 TTL）
const RL_INCR_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return current
`;
