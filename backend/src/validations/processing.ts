import { z } from 'zod';

/**
 * 加工请求校验。
 * - recipeType：非空字符串
 * - quantity：正整数，缺省 1
 */
export const processSchema = z.object({
  recipeType: z
    .string({
      required_error: 'recipeType is required',
      invalid_type_error: 'recipeType is required',
    })
    .min(1, 'recipeType is required'),
  quantity: z
    .number({
      required_error: 'quantity must be a positive integer',
      invalid_type_error: 'quantity must be a positive integer',
    })
    .int('quantity must be a positive integer')
    .positive('quantity must be a positive integer')
    .default(1),
});
