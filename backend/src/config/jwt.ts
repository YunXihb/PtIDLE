import dotenv from 'dotenv';

dotenv.config();

/**
 * JWT 配置集中点
 *
 * 所有 JWT 签名 / 验证入口（authService.ts / middleware/auth.ts / socket/authMiddleware.ts）
 * 共用同一秘钥常量,避免生产代码散落 `process.env.JWT_SECRET || '...'` 表达式。
 *
 * ⚠️ 安全:
 *   - 生产环境（NODE_ENV=production）必须显式设置 JWT_SECRET，否则启动抛错
 *     （防止使用公开已知 fallback 导致任意用户 token 伪造 / 账号接管）。
 *   - 开发/测试环境使用 fallback 便于本地跑通。
 */
function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.length > 0) {
    return secret;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set in production');
  }
  return 'your_jwt_secret_change_in_production';
}

export const JWT_SECRET = resolveJwtSecret();

export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
