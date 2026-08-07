import { z } from 'zod';

/**
 * 注册请求校验。
 * - username：trim 后非空
 * - password：≥6 字符（缺失/过短均返回同一消息，与 authService 行为一致）
 */
export const registerSchema = z.object({
  username: z
    .string({
      required_error: 'Username is required',
      invalid_type_error: 'Username is required',
    })
    .trim()
    .min(1, 'Username is required'),
  password: z
    .string({
      required_error: 'Password must be at least 6 characters',
      invalid_type_error: 'Password must be at least 6 characters',
    })
    .min(6, 'Password must be at least 6 characters'),
});

/**
 * 登录请求校验。username/password 非空（username 在此 trim，login 内部也会 trim）。
 */
export const loginSchema = z.object({
  username: z
    .string({
      required_error: 'Username is required',
      invalid_type_error: 'Username is required',
    })
    .trim()
    .min(1, 'Username is required'),
  password: z
    .string({
      required_error: 'Password is required',
      invalid_type_error: 'Password is required',
    })
    .min(1, 'Password is required'),
});
