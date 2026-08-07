import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/ApiError';
import { ZodError } from 'zod';

/**
 * 全局错误处理中间件（4 参签名被 Express 识别为 error handler）。
 *
 * - ApiError：按其 `status` 返回 `{ success: false, error, ...extra }`
 *   （extra 如 `missing` 供客户端定位缺料）
 * - ZodError：400 + 首条 issue 消息（防御兜底；validate 中间件已转 ApiError）
 * - 其它未捕获错误：500，生产环境屏蔽内部详情
 *
 * 统一 JSON 错误格式，避免未捕获异常落到 Express 默认 HTML 错误页。
 * index.ts 与各集成测试 app 均挂载此中间件，保证错误响应格式一致。
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  const isProd = process.env.NODE_ENV === 'production';
  console.error('[unhandled]', err);

  if (err instanceof ApiError) {
    res.status(err.status).json({
      success: false,
      error: err.message,
      ...(err.extra ?? {}),
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: err.issues[0]?.message ?? 'Validation failed',
    });
    return;
  }

  res.status(500).json({
    success: false,
    error: isProd ? 'Internal server error' : err.message || 'Internal server error',
  });
}
