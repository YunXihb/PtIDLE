import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { getAllProcessingRecipes, getProcessingRecipeByType } from '../services/processingService';
import { withTransaction } from '../config/database';
import { validate } from '../middleware/validate';
import { processSchema } from '../validations/processing';
import { ok, fail } from '../utils/http';
import { ApiError } from '../utils/ApiError';

const router = Router();

// 获取所有加工配方
router.get('/recipes', async (_req, res, next) => {
  try {
    const recipes = await getAllProcessingRecipes();
    ok(res, recipes);
  } catch (error) {
    next(error);
  }
});

// 获取单个加工配方
router.get('/recipes/:type', async (req, res, next) => {
  try {
    const { type } = req.params;
    const recipe = await getProcessingRecipeByType(type);

    if (!recipe) {
      fail(res, 404, 'Recipe not found');
      return;
    }

    ok(res, recipe);
  } catch (error) {
    next(error);
  }
});

// 执行加工操作
router.post('/process', authMiddleware, validate(processSchema), async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      fail(res, 401, 'Unauthorized');
      return;
    }

    const { recipeType, quantity = 1 } = req.body;

    // 获取配方
    const recipe = await getProcessingRecipeByType(recipeType);
    if (!recipe) {
      fail(res, 404, 'Recipe not found');
      return;
    }

    // 单事务 + 行锁：读玩家 -> 校验材料 -> 扣料 + 加产出（防并发把材料扣成负数 / 重复加工）
    const result = await withTransaction<{
      playerId: string;
      updatedMaterials: Record<string, number>;
    }>(async (client) => {
      const playerRes = await client.query<{
        id: string;
        materials: Record<string, number>;
      }>(
        'SELECT id, materials FROM players WHERE user_id = $1 FOR UPDATE',
        [userId]
      );
      if (playerRes.rows.length === 0) {
        throw new ApiError(404, 'Player not found');
      }
      const player = playerRes.rows[0];

      // 检查输入材料是否足够
      const currentMaterials = player.materials || {};
      const inputMaterials = recipe.input;
      const missingMaterials: string[] = [];

      for (const [material, requiredAmount] of Object.entries(inputMaterials)) {
        const totalRequired = requiredAmount * quantity;
        const currentAmount = currentMaterials[material] || 0;
        if (currentAmount < totalRequired) {
          missingMaterials.push(material);
        }
      }

      if (missingMaterials.length > 0) {
        // missing 经 ApiError.extra 附加到响应体，供客户端定位缺料
        throw new ApiError(400, 'Insufficient materials', {
          extra: { missing: missingMaterials },
        });
      }

      // 扣除输入材料
      const updatedMaterials = { ...currentMaterials };
      for (const [material, requiredAmount] of Object.entries(inputMaterials)) {
        const totalRequired = requiredAmount * quantity;
        updatedMaterials[material] = (updatedMaterials[material] || 0) - totalRequired;
      }

      // 添加输出材料（考虑效率）
      const outputMaterials = recipe.output;
      for (const [material, baseAmount] of Object.entries(outputMaterials)) {
        const outputAmount = Math.floor(baseAmount * quantity * recipe.efficiency);
        updatedMaterials[material] = (updatedMaterials[material] || 0) + outputAmount;
      }

      await client.query(
        'UPDATE players SET materials = $1, updated_at = NOW() WHERE user_id = $2',
        [JSON.stringify(updatedMaterials), userId]
      );

      return { playerId: player.id, updatedMaterials };
    });

    ok(res, {
      recipe: recipe.name,
      type: recipe.type,
      quantity,
      input: Object.fromEntries(
        Object.entries(recipe.input).map(([k, v]) => [k, v * quantity])
      ),
      output: Object.fromEntries(
        Object.entries(recipe.output).map(([k, v]) => [k, Math.floor(v * quantity * recipe.efficiency)])
      ),
      materials: result.updatedMaterials,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
