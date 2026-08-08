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

    // 单事务 + 行锁：读玩家 -> 校验资源 -> 扣资源 + 加材料产出（防并发把资源扣成负数 / 重复加工）
    // 字段映射：配方 input（coal/iron_ore/wood/herb）是「资源」存于 players.resources；
    //          配方 output（iron_ingot/plank/herb_powder）是「材料」存于 players.materials。
    //   旧实现误把 input 当 materials 校验/扣除 -> 资源永远在 materials 找不到 -> 加工恒失败。
    const result = await withTransaction<{
      playerId: string;
      updatedResources: Record<string, number>;
      updatedMaterials: Record<string, number>;
    }>(async (client) => {
      const playerRes = await client.query<{
        id: string;
        resources: Record<string, number>;
        materials: Record<string, number>;
      }>(
        'SELECT id, resources, materials FROM players WHERE user_id = $1 FOR UPDATE',
        [userId]
      );
      if (playerRes.rows.length === 0) {
        throw new ApiError(404, 'Player not found');
      }
      const player = playerRes.rows[0];

      // 检查输入资源是否足够（input 为资源键，存于 players.resources）
      const currentResources = player.resources || {};
      const inputResources = recipe.input;
      const missingResources: string[] = [];

      for (const [resource, requiredAmount] of Object.entries(inputResources)) {
        const totalRequired = requiredAmount * quantity;
        const currentAmount = currentResources[resource] || 0;
        if (currentAmount < totalRequired) {
          missingResources.push(resource);
        }
      }

      if (missingResources.length > 0) {
        // missing 经 ApiError.extra 附加到响应体，供客户端定位缺料
        throw new ApiError(400, 'Insufficient materials', {
          extra: { missing: missingResources },
        });
      }

      // 扣除输入资源
      const updatedResources = { ...currentResources };
      for (const [resource, requiredAmount] of Object.entries(inputResources)) {
        const totalRequired = requiredAmount * quantity;
        updatedResources[resource] = (updatedResources[resource] || 0) - totalRequired;
      }

      // 添加产出材料（考虑效率）-- output 为材料键，写入 players.materials
      const currentMaterials = player.materials || {};
      const updatedMaterials = { ...currentMaterials };
      const outputMaterials = recipe.output;
      for (const [material, baseAmount] of Object.entries(outputMaterials)) {
        const outputAmount = Math.floor(baseAmount * quantity * recipe.efficiency);
        updatedMaterials[material] = (updatedMaterials[material] || 0) + outputAmount;
      }

      await client.query(
        'UPDATE players SET resources = $1, materials = $2, updated_at = NOW() WHERE user_id = $3',
        [JSON.stringify(updatedResources), JSON.stringify(updatedMaterials), userId]
      );

      return { playerId: player.id, updatedResources, updatedMaterials };
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
      resources: result.updatedResources,
      materials: result.updatedMaterials,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
