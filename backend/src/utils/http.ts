import { Response } from 'express';

/**
 * 统一成功响应信封：{ success: true, data }
 * @param status HTTP 状态码，默认 200（创建资源传 201）
 */
export function ok<T>(res: Response, data: T, status = 200): void {
  res.status(status).json({ success: true, data });
}

/**
 * 统一失败响应信封：{ success: false, error }
 */
export function fail(res: Response, status: number, error: string): void {
  res.status(status).json({ success: false, error });
}
