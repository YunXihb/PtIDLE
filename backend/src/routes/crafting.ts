import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { getAllCraftingRecipes, getCraftingRecipesByCategory, executeCardCrafting, executeGearCrafting, executeConsumableCrafting } from '../services/craftingService';
import { ok, fail } from '../utils/http';

const router = Router();

// 获取所有制造配方
router.get('/recipes', async (req, res) => {
  try {
    const recipes = await getAllCraftingRecipes();
    ok(res, recipes);
  } catch (error) {
    console.error('Error fetching crafting recipes:', error);
    fail(res, 500, 'Failed to fetch crafting recipes');
  }
});

// 按分类获取制造配方
router.get('/recipes/:category', async (req, res) => {
  try {
    const { category } = req.params;
    const recipes = await getCraftingRecipesByCategory(category);

    ok(res, recipes);
  } catch (error) {
    console.error('Error fetching crafting recipes by category:', error);
    fail(res, 500, 'Failed to fetch crafting recipes');
  }
});

// 执行卡牌制造
router.post('/card', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      fail(res, 401, 'Unauthorized');
      return;
    }

    const { recipeId, quantity = 1 } = req.body;

    if (!recipeId) {
      fail(res, 400, 'recipeId is required');
      return;
    }

    if (quantity < 1 || !Number.isInteger(quantity)) {
      fail(res, 400, 'quantity must be a positive integer');
      return;
    }

    const result = await executeCardCrafting(userId, recipeId, quantity);

    if (!result.success) {
      if (result.error === 'Recipe not found' || result.error === 'Card template not found') {
        fail(res, 404, result.error);
        return;
      }
      if (result.error?.includes('Insufficient materials')) {
        fail(res, 400, result.error);
        return;
      }
      if (result.error?.includes('Requires')) {
        fail(res, 403, result.error);
        return;
      }
      fail(res, 400, result.error!);
      return;
    }

    ok(res, {
      cardName: result.cardName,
      quantity: result.quantity,
      materialsUsed: result.materialsUsed,
      playerCardId: result.playerCardId,
    });
  } catch (error) {
    console.error('Error crafting card:', error);
    fail(res, 500, 'Failed to craft card');
  }
});

// 执行装备制造
router.post('/gear', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      fail(res, 401, 'Unauthorized');
      return;
    }

    const { recipeId, quantity = 1 } = req.body;

    if (!recipeId) {
      fail(res, 400, 'recipeId is required');
      return;
    }

    if (quantity < 1 || !Number.isInteger(quantity)) {
      fail(res, 400, 'quantity must be a positive integer');
      return;
    }

    const result = await executeGearCrafting(userId, recipeId, quantity);

    if (!result.success) {
      if (result.error === 'Recipe not found') {
        fail(res, 404, result.error);
        return;
      }
      if (result.error?.includes('Insufficient materials')) {
        fail(res, 400, result.error);
        return;
      }
      if (result.error === 'Player not found') {
        fail(res, 404, result.error);
        return;
      }
      fail(res, 400, result.error!);
      return;
    }

    ok(res, {
      gearName: result.gearName,
      bonus: result.bonus,
      materialsUsed: result.materialsUsed,
    });
  } catch (error) {
    console.error('Error crafting gear:', error);
    fail(res, 500, 'Failed to craft gear');
  }
});

// 执行消耗品制造
router.post('/consumable', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      fail(res, 401, 'Unauthorized');
      return;
    }

    const { recipeId, quantity = 1 } = req.body;

    if (!recipeId) {
      fail(res, 400, 'recipeId is required');
      return;
    }

    if (quantity < 1 || !Number.isInteger(quantity)) {
      fail(res, 400, 'quantity must be a positive integer');
      return;
    }

    const result = await executeConsumableCrafting(userId, recipeId, quantity);

    if (!result.success) {
      if (result.error === 'Recipe not found') {
        fail(res, 404, result.error);
        return;
      }
      if (result.error?.includes('Insufficient materials')) {
        fail(res, 400, result.error);
        return;
      }
      if (result.error === 'Player not found') {
        fail(res, 404, result.error);
        return;
      }
      fail(res, 400, result.error!);
      return;
    }

    ok(res, {
      consumableName: result.consumableName,
      quantity: result.quantity,
      effect: result.effect,
      materialsUsed: result.materialsUsed,
      playerConsumableId: result.playerConsumableId,
    });
  } catch (error) {
    console.error('Error crafting consumable:', error);
    fail(res, 500, 'Failed to craft consumable');
  }
});

export default router;
