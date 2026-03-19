import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { getAllCraftingRecipes, getCraftingRecipesByCategory, executeCardCrafting, executeGearCrafting } from '../services/craftingService';

const router = Router();

// 获取所有制造配方
router.get('/recipes', async (req, res) => {
  try {
    const recipes = await getAllCraftingRecipes();
    res.json({ success: true, data: recipes });
  } catch (error) {
    console.error('Error fetching crafting recipes:', error);
    res.status(500).json({ error: 'Failed to fetch crafting recipes' });
  }
});

// 按分类获取制造配方
router.get('/recipes/:category', async (req, res) => {
  try {
    const { category } = req.params;
    const recipes = await getCraftingRecipesByCategory(category);

    res.json({ success: true, data: recipes });
  } catch (error) {
    console.error('Error fetching crafting recipes by category:', error);
    res.status(500).json({ error: 'Failed to fetch crafting recipes' });
  }
});

// 执行卡牌制造
router.post('/card', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { recipeId, quantity = 1 } = req.body;

    if (!recipeId) {
      res.status(400).json({ error: 'recipeId is required' });
      return;
    }

    if (quantity < 1 || !Number.isInteger(quantity)) {
      res.status(400).json({ error: 'quantity must be a positive integer' });
      return;
    }

    const result = await executeCardCrafting(userId, recipeId, quantity);

    if (!result.success) {
      if (result.error === 'Recipe not found' || result.error === 'Card template not found') {
        res.status(404).json({ success: false, error: result.error });
        return;
      }
      if (result.error?.includes('Insufficient materials')) {
        res.status(400).json({ success: false, error: result.error });
        return;
      }
      if (result.error?.includes('Requires')) {
        res.status(403).json({ success: false, error: result.error });
        return;
      }
      res.status(400).json({ success: false, error: result.error });
      return;
    }

    res.json({
      success: true,
      data: {
        cardName: result.cardName,
        quantity: result.quantity,
        materialsUsed: result.materialsUsed,
        playerCardId: result.playerCardId,
      },
    });
  } catch (error) {
    console.error('Error crafting card:', error);
    res.status(500).json({ error: 'Failed to craft card' });
  }
});

// 执行装备制造
router.post('/gear', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { recipeId, quantity = 1 } = req.body;

    if (!recipeId) {
      res.status(400).json({ error: 'recipeId is required' });
      return;
    }

    if (quantity < 1 || !Number.isInteger(quantity)) {
      res.status(400).json({ error: 'quantity must be a positive integer' });
      return;
    }

    const result = await executeGearCrafting(userId, recipeId, quantity);

    if (!result.success) {
      if (result.error === 'Recipe not found') {
        res.status(404).json({ success: false, error: result.error });
        return;
      }
      if (result.error?.includes('Insufficient materials')) {
        res.status(400).json({ success: false, error: result.error });
        return;
      }
      if (result.error === 'Player not found') {
        res.status(404).json({ success: false, error: result.error });
        return;
      }
      res.status(400).json({ success: false, error: result.error });
      return;
    }

    res.json({
      success: true,
      data: {
        gearName: result.gearName,
        bonus: result.bonus,
        materialsUsed: result.materialsUsed,
      },
    });
  } catch (error) {
    console.error('Error crafting gear:', error);
    res.status(500).json({ error: 'Failed to craft gear' });
  }
});

export default router;
