import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { getAllProcessingRecipes, getProcessingRecipeByType } from '../services/processingService';
import { getPlayerProfile } from '../services/playerService';
import { execute } from '../config/database';

const router = Router();

// 获取所有加工配方
router.get('/recipes', async (req, res) => {
  try {
    const recipes = await getAllProcessingRecipes();
    res.json({ success: true, data: recipes });
  } catch (error) {
    console.error('Error fetching processing recipes:', error);
    res.status(500).json({ error: 'Failed to fetch processing recipes' });
  }
});

// 获取单个加工配方
router.get('/recipes/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const recipe = await getProcessingRecipeByType(type);

    if (!recipe) {
      res.status(404).json({ error: 'Recipe not found' });
      return;
    }

    res.json({ success: true, data: recipe });
  } catch (error) {
    console.error('Error fetching processing recipe:', error);
    res.status(500).json({ error: 'Failed to fetch processing recipe' });
  }
});

// 执行加工操作
router.post('/process', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { recipeType, quantity = 1 } = req.body;

    if (!recipeType) {
      res.status(400).json({ error: 'recipeType is required' });
      return;
    }

    if (quantity < 1 || !Number.isInteger(quantity)) {
      res.status(400).json({ error: 'quantity must be a positive integer' });
      return;
    }

    // 获取配方
    const recipe = await getProcessingRecipeByType(recipeType);
    if (!recipe) {
      res.status(404).json({ error: 'Recipe not found' });
      return;
    }

    // 获取玩家数据
    const player = await getPlayerProfile(userId);
    if (!player) {
      res.status(404).json({ error: 'Player not found' });
      return;
    }

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
      res.status(400).json({
        error: 'Insufficient materials',
        missing: missingMaterials,
      });
      return;
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

    // 更新数据库
    await execute(
      'UPDATE players SET materials = $1, updated_at = NOW() WHERE user_id = $2',
      [JSON.stringify(updatedMaterials), userId]
    );

    res.json({
      success: true,
      data: {
        recipe: recipe.name,
        type: recipe.type,
        quantity,
        input: Object.fromEntries(
          Object.entries(inputMaterials).map(([k, v]) => [k, v * quantity])
        ),
        output: Object.fromEntries(
          Object.entries(outputMaterials).map(([k, v]) => [k, Math.floor(v * quantity * recipe.efficiency)])
        ),
        materials: updatedMaterials,
      },
    });
  } catch (error) {
    console.error('Error processing materials:', error);
    res.status(500).json({ error: 'Failed to process materials' });
  }
});

export default router;
