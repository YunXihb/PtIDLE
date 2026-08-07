import { z } from 'zod';

/**
 * 开始采集任务请求校验。
 * - skillType：枚举 mining/woodcutting/herbalism（缺失/非法均返回 'Invalid skill type'）
 * - characterId：可选
 */
export const startGatheringSchema = z.object({
  skillType: z.enum(['mining', 'woodcutting', 'herbalism'], {
    errorMap: () => ({ message: 'Invalid skill type' }),
  }),
  characterId: z.string().optional(),
});
