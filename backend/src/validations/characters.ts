import { z } from 'zod';

/**
 * 创建棋子请求校验。
 * - name：trim 后非空
 * - profession：枚举 warrior/ranger/mage（缺失/非法均返回同一消息）
 */
export const createCharacterSchema = z.object({
  name: z
    .string({
      required_error: 'Character name is required',
      invalid_type_error: 'Character name is required',
    })
    .trim()
    .min(1, 'Character name is required'),
  profession: z.enum(['warrior', 'ranger', 'mage'], {
    errorMap: () => ({ message: 'Invalid profession. Must be warrior, ranger, or mage' }),
  }),
});

/**
 * 更新棋子名称请求校验。
 */
export const updateCharacterNameSchema = z.object({
  name: z
    .string({
      required_error: 'Character name is required',
      invalid_type_error: 'Character name is required',
    })
    .trim()
    .min(1, 'Character name is required'),
});

/**
 * 分配/移除棋子卡牌请求校验。
 * - cardId：非空字符串
 * - action：枚举 assign/remove（缺失/非法均返回同一消息）
 */
export const deckSchema = z.object({
  cardId: z
    .string({
      required_error: 'cardId is required',
      invalid_type_error: 'cardId is required',
    })
    .min(1, 'cardId is required'),
  action: z.enum(['assign', 'remove'], {
    errorMap: () => ({ message: 'action must be "assign" or "remove"' }),
  }),
});
