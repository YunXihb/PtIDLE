import { getAllProcessingRecipes, getProcessingRecipeByType, getProcessingRecipeById, clearRecipesCache } from '../services/processingService';
import { query } from '../config/database';

// Mock the database module
jest.mock('../config/database', () => ({
  query: jest.fn(),
}));

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('ProcessingService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearRecipesCache();
  });

  describe('getAllProcessingRecipes', () => {
    it('should return all processing recipes from database', async () => {
      const mockRecipes = [
        {
          id: '1',
          name: '冶炼',
          type: 'smelting',
          input: { iron_ore: 2, coal: 1 },
          output: { iron_ingot: 1 },
          efficiency: 1.0,
        },
        {
          id: '2',
          name: '木工',
          type: 'carpentry',
          input: { wood: 2 },
          output: { plank: 1 },
          efficiency: 1.0,
        },
        {
          id: '3',
          name: '研磨',
          type: 'grinding',
          input: { herb: 2 },
          output: { herb_powder: 1 },
          efficiency: 1.0,
        },
      ];

      mockQuery.mockResolvedValue(mockRecipes as any);

      const recipes = await getAllProcessingRecipes();

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT id, name, type, input, output, efficiency FROM processing_recipes ORDER BY type'
      );
      expect(recipes).toHaveLength(3);
      expect(recipes[0].type).toBe('smelting');
      expect(recipes[1].type).toBe('carpentry');
      expect(recipes[2].type).toBe('grinding');
    });

    it('should return cached data if cache is valid', async () => {
      const mockRecipes = [
        {
          id: '1',
          name: '冶炼',
          type: 'smelting',
          input: { iron_ore: 2, coal: 1 },
          output: { iron_ingot: 1 },
          efficiency: 1.0,
        },
      ];

      mockQuery.mockResolvedValue(mockRecipes as any);

      // First call - should query database
      await getAllProcessingRecipes();
      // Second call - should use cache
      const recipes = await getAllProcessingRecipes();

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(recipes).toHaveLength(1);
    });

    it('should handle empty database result', async () => {
      mockQuery.mockResolvedValue([]);

      const recipes = await getAllProcessingRecipes();

      expect(recipes).toHaveLength(0);
    });
  });

  describe('getProcessingRecipeByType', () => {
    it('should return recipe by type', async () => {
      const mockRecipes = [
        {
          id: '1',
          name: '冶炼',
          type: 'smelting',
          input: { iron_ore: 2, coal: 1 },
          output: { iron_ingot: 1 },
          efficiency: 1.0,
        },
      ];

      mockQuery.mockResolvedValue(mockRecipes as any);

      const recipe = await getProcessingRecipeByType('smelting');

      expect(recipe).not.toBeNull();
      expect(recipe?.name).toBe('冶炼');
      expect(recipe?.type).toBe('smelting');
    });

    it('should return null for non-existent type', async () => {
      const mockRecipes = [
        {
          id: '1',
          name: '冶炼',
          type: 'smelting',
          input: { iron_ore: 2, coal: 1 },
          output: { iron_ingot: 1 },
          efficiency: 1.0,
        },
      ];

      mockQuery.mockResolvedValue(mockRecipes as any);

      const recipe = await getProcessingRecipeByType('nonexistent');

      expect(recipe).toBeNull();
    });
  });

  describe('getProcessingRecipeById', () => {
    it('should return recipe by id', async () => {
      const mockRecipes = [
        {
          id: '123',
          name: '冶炼',
          type: 'smelting',
          input: { iron_ore: 2, coal: 1 },
          output: { iron_ingot: 1 },
          efficiency: 1.0,
        },
      ];

      mockQuery.mockResolvedValue(mockRecipes as any);

      const recipe = await getProcessingRecipeById('123');

      expect(recipe).not.toBeNull();
      expect(recipe?.name).toBe('冶炼');
    });

    it('should return null for non-existent id', async () => {
      const mockRecipes = [
        {
          id: '123',
          name: '冶炼',
          type: 'smelting',
          input: { iron_ore: 2, coal: 1 },
          output: { iron_ingot: 1 },
          efficiency: 1.0,
        },
      ];

      mockQuery.mockResolvedValue(mockRecipes as any);

      const recipe = await getProcessingRecipeById('nonexistent');

      expect(recipe).toBeNull();
    });
  });

  describe('clearRecipesCache', () => {
    it('should clear the cache', async () => {
      const mockRecipes = [
        {
          id: '1',
          name: '冶炼',
          type: 'smelting',
          input: { iron_ore: 2, coal: 1 },
          output: { iron_ingot: 1 },
          efficiency: 1.0,
        },
      ];

      mockQuery.mockResolvedValue(mockRecipes as any);

      // First call - populate cache
      await getAllProcessingRecipes();
      // Clear cache
      clearRecipesCache();
      // Second call - should query database again
      await getAllProcessingRecipes();

      expect(mockQuery).toHaveBeenCalledTimes(2);
    });
  });
});
