import { getAllCraftingRecipes, getCraftingRecipesByCategory, getCraftingRecipeById, clearRecipesCache, executeCardCrafting, executeGearCrafting, executeConsumableCrafting } from '../services/craftingService';
import { query, execute } from '../config/database';

// Mock the database module
jest.mock('../config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
}));

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockExecute = execute as jest.MockedFunction<typeof execute>;

describe('CraftingService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearRecipesCache();
    jest.clearAllMocks();
  });

  describe('getAllCraftingRecipes', () => {
    it('should return all crafting recipes from database', async () => {
      const mockRecipes = [
        {
          id: '1',
          name: '基础移动卡',
          category: 'card',
          input: { iron_ingot: 1 },
          output: { name: '移动', quantity: 1 },
          profession_required: null,
        },
        {
          id: '2',
          name: '矿镐',
          category: 'gear',
          input: { iron_ingot: 5, plank: 2 },
          output: { name: '矿镐', bonus: 0.5 },
          profession_required: null,
        },
        {
          id: '3',
          name: '回血药',
          category: 'consumable',
          input: [{ iron_ingot: 1 }, { plank: 1 }],
          output: { name: '回血药', quantity: 1, effect: { heal: 5 } },
          profession_required: null,
        },
      ];

      mockQuery.mockResolvedValue(mockRecipes as any);

      const recipes = await getAllCraftingRecipes();

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT id, name, category, input, output, profession_required FROM crafting_recipes ORDER BY category'
      );
      expect(recipes).toHaveLength(3);
      expect(recipes[0].category).toBe('card');
      expect(recipes[1].category).toBe('gear');
      expect(recipes[2].category).toBe('consumable');
    });

    it('should return cached data if cache is valid', async () => {
      const mockRecipes = [
        {
          id: '1',
          name: '基础移动卡',
          category: 'card',
          input: { iron_ingot: 1 },
          output: { name: '移动', quantity: 1 },
          profession_required: null,
        },
      ];

      mockQuery.mockResolvedValue(mockRecipes as any);

      // First call - should query database
      await getAllCraftingRecipes();
      // Second call - should use cache
      const recipes = await getAllCraftingRecipes();

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(recipes).toHaveLength(1);
    });

    it('should handle empty database result', async () => {
      mockQuery.mockResolvedValue([]);

      const recipes = await getAllCraftingRecipes();

      expect(recipes).toHaveLength(0);
    });
  });

  describe('getCraftingRecipesByCategory', () => {
    it('should return recipes by category', async () => {
      const mockRecipes = [
        {
          id: '1',
          name: '基础移动卡',
          category: 'card',
          input: { iron_ingot: 1 },
          output: { name: '移动', quantity: 1 },
          profession_required: null,
        },
        {
          id: '2',
          name: '基础轻击卡',
          category: 'card',
          input: { iron_ingot: 2 },
          output: { name: '轻击', quantity: 1 },
          profession_required: null,
        },
        {
          id: '3',
          name: '矿镐',
          category: 'gear',
          input: { iron_ingot: 5, plank: 2 },
          output: { name: '矿镐', bonus: 0.5 },
          profession_required: null,
        },
      ];

      mockQuery.mockResolvedValue(mockRecipes as any);

      const cardRecipes = await getCraftingRecipesByCategory('card');

      expect(cardRecipes).toHaveLength(2);
      expect(cardRecipes.every(r => r.category === 'card')).toBe(true);
    });

    it('should return empty array for non-existent category', async () => {
      const mockRecipes = [
        {
          id: '1',
          name: '基础移动卡',
          category: 'card',
          input: { iron_ingot: 1 },
          output: { name: '移动', quantity: 1 },
          profession_required: null,
        },
      ];

      mockQuery.mockResolvedValue(mockRecipes as any);

      const recipes = await getCraftingRecipesByCategory('nonexistent');

      expect(recipes).toHaveLength(0);
    });
  });

  describe('getCraftingRecipeById', () => {
    it('should return recipe by id', async () => {
      const mockRecipes = [
        {
          id: '123',
          name: '基础移动卡',
          category: 'card',
          input: { iron_ingot: 1 },
          output: { name: '移动', quantity: 1 },
          profession_required: null,
        },
      ];

      mockQuery.mockResolvedValue(mockRecipes as any);

      const recipe = await getCraftingRecipeById('123');

      expect(recipe).not.toBeNull();
      expect(recipe?.name).toBe('基础移动卡');
    });

    it('should return null for non-existent id', async () => {
      const mockRecipes = [
        {
          id: '123',
          name: '基础移动卡',
          category: 'card',
          input: { iron_ingot: 1 },
          output: { name: '移动', quantity: 1 },
          profession_required: null,
        },
      ];

      mockQuery.mockResolvedValue(mockRecipes as any);

      const recipe = await getCraftingRecipeById('nonexistent');

      expect(recipe).toBeNull();
    });
  });

  describe('clearRecipesCache', () => {
    it('should clear the cache', async () => {
      const mockRecipes = [
        {
          id: '1',
          name: '基础移动卡',
          category: 'card',
          input: { iron_ingot: 1 },
          output: { name: '移动', quantity: 1 },
          profession_required: null,
        },
      ];

      mockQuery.mockResolvedValue(mockRecipes as any);

      // First call - populate cache
      await getAllCraftingRecipes();
      // Clear cache
      clearRecipesCache();
      // Second call - should query database again
      await getAllCraftingRecipes();

      expect(mockQuery).toHaveBeenCalledTimes(2);
    });
  });

  describe('executeCardCrafting', () => {
    const mockRecipe = {
      id: 'recipe-1',
      name: '基础移动卡',
      category: 'card',
      input: { iron_ingot: 1 },
      output: { name: '移动', quantity: 1 },
      profession_required: null,
    };

    const mockPlayer = {
      id: 'player-1',
      materials: { iron_ingot: 5, plank: 2 },
    };

    const mockCardTemplate = {
      id: 'template-1',
      name: '移动',
      type: 'tactical',
      cost: 0,
      effect: { movement: 1 },
    };

    it('should craft card successfully', async () => {
      // Mock recipe query
      mockQuery.mockResolvedValueOnce([mockRecipe] as any);
      // Mock player query
      mockQuery.mockResolvedValueOnce([mockPlayer] as any);
      // Mock card template query
      mockQuery.mockResolvedValueOnce([mockCardTemplate] as any);
      // Mock update player materials
      mockExecute.mockResolvedValueOnce({} as any);
      // Mock insert player card
      mockExecute.mockResolvedValueOnce({} as any);

      const result = await executeCardCrafting('user-1', 'recipe-1', 1);

      expect(result.success).toBe(true);
      expect(result.cardName).toBe('移动');
      expect(result.quantity).toBe(1);
      expect(result.materialsUsed).toEqual({ iron_ingot: 1 });
      expect(result.playerCardId).toBeDefined();
    });

    it('should return error for non-existent recipe', async () => {
      mockQuery.mockResolvedValueOnce([] as any);

      const result = await executeCardCrafting('user-1', 'nonexistent', 1);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Recipe not found');
    });

    it('should return error for non-card recipe', async () => {
      const gearRecipe = { ...mockRecipe, category: 'gear' };
      mockQuery.mockResolvedValueOnce([gearRecipe] as any);

      const result = await executeCardCrafting('user-1', 'recipe-1', 1);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Recipe is not a card recipe');
    });

    it('should return error for insufficient materials', async () => {
      const playerWithFewMaterials = {
        id: 'player-1',
        materials: { iron_ingot: 0, plank: 2 },
      };
      mockQuery.mockResolvedValueOnce([mockRecipe] as any);
      mockQuery.mockResolvedValueOnce([playerWithFewMaterials] as any);

      const result = await executeCardCrafting('user-1', 'recipe-1', 1);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Insufficient materials');
    });

    it('should return error when player not found', async () => {
      mockQuery.mockResolvedValueOnce([mockRecipe] as any);
      mockQuery.mockResolvedValueOnce([] as any);

      const result = await executeCardCrafting('user-1', 'recipe-1', 1);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Player not found');
    });

    it('should return error for profession requirement not met', async () => {
      const recipeWithProfession = {
        ...mockRecipe,
        profession_required: 'warrior',
      };
      const playerWithCharacters = {
        id: 'player-1',
        materials: { iron_ingot: 5 },
      };
      const charactersWithRanger = [{ profession: 'ranger' }];

      mockQuery.mockResolvedValueOnce([recipeWithProfession] as any);
      mockQuery.mockResolvedValueOnce([playerWithCharacters] as any);
      mockQuery.mockResolvedValueOnce(charactersWithRanger as any);

      const result = await executeCardCrafting('user-1', 'recipe-1', 1);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Requires warrior profession');
    });

    it('should succeed when player has required profession', async () => {
      const recipeWithProfession = {
        ...mockRecipe,
        profession_required: 'warrior',
        input: { iron_ingot: 3 },
      };
      const playerWithCharacters = {
        id: 'player-1',
        materials: { iron_ingot: 5 },
      };
      const charactersWithWarrior = [{ profession: 'warrior' }];

      mockQuery.mockResolvedValueOnce([recipeWithProfession] as any);
      mockQuery.mockResolvedValueOnce([playerWithCharacters] as any);
      mockQuery.mockResolvedValueOnce(charactersWithWarrior as any);
      mockQuery.mockResolvedValueOnce([mockCardTemplate] as any);
      mockExecute.mockResolvedValueOnce({} as any);
      mockExecute.mockResolvedValueOnce({} as any);

      const result = await executeCardCrafting('user-1', 'recipe-1', 1);

      expect(result.success).toBe(true);
      expect(result.cardName).toBe('移动');
    });

    it('should deduct correct quantity of materials', async () => {
      // Clear cache to ensure fresh query
      clearRecipesCache();

      const recipeWithMoreInput = {
        ...mockRecipe,
        input: { iron_ingot: 2 },
      };
      const playerWithEnoughMaterials = {
        id: 'player-1',
        materials: { iron_ingot: 10 },
      };

      mockQuery.mockResolvedValueOnce([recipeWithMoreInput] as any);
      mockQuery.mockResolvedValueOnce([playerWithEnoughMaterials] as any);
      mockQuery.mockResolvedValueOnce([mockCardTemplate] as any);
      mockExecute.mockResolvedValueOnce({} as any);
      mockExecute.mockResolvedValueOnce({} as any);

      const result = await executeCardCrafting('user-1', 'recipe-1', 3);

      expect(result.success).toBe(true);
      expect(result.materialsUsed).toEqual({ iron_ingot: 6 });
    });
  });

  describe('executeGearCrafting', () => {
    const mockGearRecipe = {
      id: 'gear-recipe-1',
      name: '矿镐',
      category: 'gear',
      input: { iron_ingot: 5, plank: 2 },
      output: { name: '矿镐', bonus: 0.5 },
      profession_required: null,
    };

    const mockPlayerWithMaterials = {
      id: 'player-1',
      materials: { iron_ingot: 10, plank: 5 },
      production_gear: {},
    };

    it('should craft gear successfully', async () => {
      mockQuery.mockResolvedValueOnce([mockGearRecipe] as any);
      mockQuery.mockResolvedValueOnce([mockPlayerWithMaterials] as any);
      mockExecute.mockResolvedValueOnce({} as any);

      const result = await executeGearCrafting('user-1', 'gear-recipe-1', 1);

      expect(result.success).toBe(true);
      expect(result.gearName).toBe('矿镐');
      expect(result.bonus).toBe(0.5);
      expect(result.materialsUsed).toEqual({ iron_ingot: 5, plank: 2 });
    });

    it('should return error for non-existent recipe', async () => {
      mockQuery.mockResolvedValueOnce([] as any);

      const result = await executeGearCrafting('user-1', 'nonexistent', 1);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Recipe not found');
    });

    it('should return error for non-gear recipe', async () => {
      const cardRecipe = { ...mockGearRecipe, category: 'card' };
      mockQuery.mockResolvedValueOnce([cardRecipe] as any);

      const result = await executeGearCrafting('user-1', 'gear-recipe-1', 1);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Recipe is not a gear recipe');
    });

    it('should return error for insufficient materials', async () => {
      const playerWithFewMaterials = {
        id: 'player-1',
        materials: { iron_ingot: 3, plank: 1 },
        production_gear: {},
      };
      mockQuery.mockResolvedValueOnce([mockGearRecipe] as any);
      mockQuery.mockResolvedValueOnce([playerWithFewMaterials] as any);

      const result = await executeGearCrafting('user-1', 'gear-recipe-1', 1);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Insufficient materials');
    });

    it('should return error when player not found', async () => {
      mockQuery.mockResolvedValueOnce([mockGearRecipe] as any);
      mockQuery.mockResolvedValueOnce([] as any);

      const result = await executeGearCrafting('user-1', 'gear-recipe-1', 1);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Player not found');
    });

    it('should update production_gear with correct bonus', async () => {
      mockQuery.mockResolvedValueOnce([mockGearRecipe] as any);
      mockQuery.mockResolvedValueOnce([mockPlayerWithMaterials] as any);
      mockExecute.mockResolvedValueOnce({} as any);

      const result = await executeGearCrafting('user-1', 'gear-recipe-1', 1);

      expect(result.success).toBe(true);
      expect(result.gearName).toBe('矿镐');
      expect(result.bonus).toBe(0.5);
    });

    it('should accumulate gear bonus when crafting multiple times', async () => {
      const playerWithExistingGear = {
        id: 'player-1',
        materials: { iron_ingot: 15, plank: 6 },
        production_gear: { mining_bonus: 0.5 },
      };

      mockQuery.mockResolvedValueOnce([mockGearRecipe] as any);
      mockQuery.mockResolvedValueOnce([playerWithExistingGear] as any);
      mockExecute.mockResolvedValueOnce({} as any);

      const result = await executeGearCrafting('user-1', 'gear-recipe-1', 1);

      expect(result.success).toBe(true);
      expect(result.gearName).toBe('矿镐');
      expect(result.bonus).toBe(0.5);
    });
  });

  describe('executeConsumableCrafting', () => {
    const mockConsumableRecipe = {
      id: 'consumable-recipe-1',
      name: '回血药',
      category: 'consumable',
      input: [{ iron_ingot: 1 }, { plank: 1 }],
      output: { name: '回血药', quantity: 1, effect: { heal: 5 } },
      profession_required: null,
    };

    const mockPlayerWithMaterials = {
      id: 'player-1',
      materials: { iron_ingot: 5, plank: 3 },
    };

    it('should craft consumable successfully', async () => {
      mockQuery.mockResolvedValueOnce([mockConsumableRecipe] as any);
      mockQuery.mockResolvedValueOnce([mockPlayerWithMaterials] as any);
      mockQuery.mockResolvedValueOnce([] as any); // No existing consumable
      mockExecute.mockResolvedValueOnce({} as any); // Insert consumable
      mockExecute.mockResolvedValueOnce({} as any); // Update materials

      const result = await executeConsumableCrafting('user-1', 'consumable-recipe-1', 1);

      expect(result.success).toBe(true);
      expect(result.consumableName).toBe('回血药');
      expect(result.quantity).toBe(1);
      expect(result.effect).toEqual({ heal: 5 });
      expect(result.materialsUsed).toEqual({ iron_ingot: 1 });
    });

    it('should return error for non-existent recipe', async () => {
      mockQuery.mockResolvedValueOnce([] as any);

      const result = await executeConsumableCrafting('user-1', 'nonexistent', 1);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Recipe not found');
    });

    it('should return error for non-consumable recipe', async () => {
      const cardRecipe = { ...mockConsumableRecipe, category: 'card' };
      mockQuery.mockResolvedValueOnce([cardRecipe] as any);

      const result = await executeConsumableCrafting('user-1', 'consumable-recipe-1', 1);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Recipe is not a consumable recipe');
    });

    it('should return error for insufficient materials', async () => {
      const playerWithFewMaterials = {
        id: 'player-1',
        materials: { iron_ingot: 0, plank: 0 },
      };
      mockQuery.mockResolvedValueOnce([mockConsumableRecipe] as any);
      mockQuery.mockResolvedValueOnce([playerWithFewMaterials] as any);

      const result = await executeConsumableCrafting('user-1', 'consumable-recipe-1', 1);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Insufficient materials');
    });

    it('should return error when player not found', async () => {
      mockQuery.mockResolvedValueOnce([mockConsumableRecipe] as any);
      mockQuery.mockResolvedValueOnce([] as any);

      const result = await executeConsumableCrafting('user-1', 'consumable-recipe-1', 1);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Player not found');
    });

    it('should accumulate consumable quantity when already exists', async () => {
      const existingConsumable = {
        id: 'existing-consumable-1',
        quantity: 3,
      };
      mockQuery.mockResolvedValueOnce([mockConsumableRecipe] as any);
      mockQuery.mockResolvedValueOnce([mockPlayerWithMaterials] as any);
      mockQuery.mockResolvedValueOnce([existingConsumable] as any); // Existing consumable found
      mockExecute.mockResolvedValueOnce({} as any); // Update quantity
      mockExecute.mockResolvedValueOnce({} as any); // Update materials

      const result = await executeConsumableCrafting('user-1', 'consumable-recipe-1', 1);

      expect(result.success).toBe(true);
      expect(result.consumableName).toBe('回血药');
      expect(result.playerConsumableId).toBe('existing-consumable-1');
    });

    it('should use alternative material when primary material is insufficient', async () => {
      const playerWithOnlyPlank = {
        id: 'player-1',
        materials: { iron_ingot: 0, plank: 5 },
      };
      mockQuery.mockResolvedValueOnce([mockConsumableRecipe] as any);
      mockQuery.mockResolvedValueOnce([playerWithOnlyPlank] as any);
      mockQuery.mockResolvedValueOnce([] as any); // No existing consumable
      mockExecute.mockResolvedValueOnce({} as any); // Insert consumable
      mockExecute.mockResolvedValueOnce({} as any); // Update materials

      const result = await executeConsumableCrafting('user-1', 'consumable-recipe-1', 1);

      expect(result.success).toBe(true);
      expect(result.consumableName).toBe('回血药');
      expect(result.materialsUsed).toEqual({ plank: 1 });
    });

    it('should deduct correct quantity of materials', async () => {
      mockQuery.mockResolvedValueOnce([mockConsumableRecipe] as any);
      mockQuery.mockResolvedValueOnce([mockPlayerWithMaterials] as any);
      mockQuery.mockResolvedValueOnce([] as any); // No existing consumable
      mockExecute.mockResolvedValueOnce({} as any); // Insert consumable
      mockExecute.mockResolvedValueOnce({} as any); // Update materials

      const result = await executeConsumableCrafting('user-1', 'consumable-recipe-1', 3);

      expect(result.success).toBe(true);
      expect(result.quantity).toBe(3);
      expect(result.materialsUsed).toEqual({ iron_ingot: 3 });
    });
  });
});
