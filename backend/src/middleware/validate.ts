import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';
import { ApiError } from '../utils/ApiError';

/**
 * zod 请求校验中间件。
 *
 * - 校验失败 -> `next(ApiError(400, 首条 issue 消息))`，由全局错误中间件统一返回
 *   `{ success: false, error }`，错误消息由 schema 的自定义 message 决定。
 * - 校验通过 -> 用解析后的值（含 default / 类型转换）替换 `req[source]`，
 *   后续处理器可直接解构使用。
 *
 * @param schema zod schema
 * @param source 校验来源，默认 'body'
 */
export function validate<T>(
  schema: ZodSchema<T>,
  source: 'body' | 'query' | 'params' = 'body'
) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const first = result.error.issues[0];
      next(new ApiError(400, first?.message || 'Validation failed'));
      return;
    }
    // 用解析后的值替换（含默认值/转换），后续处理器读到的是已校验数据
    Object.assign(req, { [source]: result.data });
    next();
  };
}
