import dotenv from 'dotenv';

dotenv.config();

/**
 * JWT 配置集中点
 *
 * 所有 JWT 签名 / 验证入口（authService.ts / middleware/auth.ts / socket/authMiddleware.ts）
 * 共用同一秘钥常量,避免生产代码散落 `process.env.JWT_SECRET || '...'` 表达式。
 *
 * ⚠️ 安全警告:fallback 字符串仅用于本地开发。生产部署必须显式设置
 *    `JWT_SECRET` 环境变量,且该 fallback 不应出现在生产日志 / 报错中。
 */
export const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_change_in_production';

export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
