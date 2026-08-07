import { z } from 'zod';

/**
 * 制造请求校验（card/gear/consumable 共用）。
 * - recipeId：非空字符串
 * - quantity：正整数，缺省 1
 */
export const craftSchema = z.object({
  recipeId: z
    .string({
      required_error: 'recipeId is required',
      invalid_type_error: 'recipeId is required',
    })
    .min(1, 'recipeId is required'),
  quantity: z
    .number({
      required_error: 'quantity must be a positive integer',
      invalid_type_error: 'quantity must be a positive integer',
    })
    .int('quantity must be a positive integer')
    .positive('quantity must be a positive integer')
    .default(1),
});
