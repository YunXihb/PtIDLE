import { z } from 'zod';

/**
 * 对战结算请求校验。
 * - battleId：非空字符串（缺失/非字符串/空串均返回 'battleId is required (string)'）
 */
export const settleSchema = z.object({
  battleId: z
    .string({
      required_error: 'battleId is required (string)',
      invalid_type_error: 'battleId is required (string)',
    })
    .min(1, 'battleId is required (string)'),
});
