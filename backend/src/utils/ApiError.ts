/**
 * ApiError - 携带 HTTP 状态码的应用错误。
 *
 * 抛出后由全局错误中间件（index.ts）捕获：
 *   - 按 `status` 返回 `{ success: false, error, ...extra }`
 *   - `code` 为机器可读判别码，仅用于控制器内部区分同类错误（如 LOSER 兜底），
 *     不会进入响应体
 *   - `extra` 附加到响应体（如 `{ missing }` 供客户端定位缺料）
 *
 * 用法：
 *   throw new ApiError(404, 'Player not found');
 *   throw new ApiError(400, 'Insufficient materials', { extra: { missing } });
 *   throw new ApiError(409, 'Already matched', { code: 'ALREADY_MATCHED' });
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly extra?: Record<string, unknown>;

  constructor(
    status: number,
    message: string,
    opts?: { code?: string; extra?: Record<string, unknown> }
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = opts?.code;
    this.extra = opts?.extra;
  }
}

/** 类型守卫：判断未知错误是否为 ApiError。 */
export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}
