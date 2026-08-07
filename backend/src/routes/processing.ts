import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { getAllProcessingRecipes, getProcessingRecipeByType } from '../services/processingService';
import { withTransaction } from '../config/database';
import { ok, fail } from '../utils/http';

const router = Router();

// 获取所有加工配方
router.get('/recipes', async (req, res) => {
  try {
    const recipes = await getAllProcessingRecipes();
    ok(res, recipes);
  } catch (error) {
    console.error('Error fetching processing recipes:', error);
    fail(res, 500, 'Failed to fetch processing recipes');
  }
});

// 获取单个加工配方
router.get('/recipes/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const recipe = await getProcessingRecipeByType(type);

    if (!recipe) {
      fail(res, 404, 'Recipe not found');
      return;
    }

    ok(res, recipe);
  } catch (error) {
    console.error('Error fetching processing recipe:', error);
    fail(res, 500, 'Failed to fetch processing recipe');
  }
});

// 执行加工操作
router.post('/process', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      fail(res, 401, 'Unauthorized');
      return;
    }

    const { recipeType, quantity = 1 } = req.body;

    if (!recipeType) {
      fail(res, 400, 'recipeType is required');
      return;
    }

    if (quantity < 1 || !Number.isInteger(quantity)) {
      fail(res, 400, 'quantity must be a positive integer');
      return;
    }

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
        const err = new Error('Player not found') as Error & { code?: string };
        err.code = 'PLAYER_NOT_FOUND';
        throw err;
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
        const err = new Error('Insufficient materials') as Error & {
          code?: string;
          missing?: string[];
        };
        err.code = 'INSUFFICIENT_MATERIALS';
        err.missing = missingMaterials;
        throw err;
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
    const e = error as Error & { code?: string; missing?: string[] };
    if (e.code === 'INSUFFICIENT_MATERIALS') {
      // 保留 missing 字段供客户端定位缺料（信封 + 额外字段）
      res.status(400).json({ success: false, error: 'Insufficient materials', missing: e.missing });
      return;
    }
    if (e.code === 'PLAYER_NOT_FOUND') {
      fail(res, 404, 'Player not found');
      return;
    }
    console.error('Error processing materials:', error);
    fail(res, 500, 'Failed to process materials');
  }
});

export default router;
