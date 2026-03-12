// Integration tests for processing API
import request from 'supertest';
import express from 'express';
import processingRoutes from '../routes/processing';
import { query, execute } from '../config/database';

// Create test app
const app = express();
app.use(express.json());
app.use('/api/processing', processingRoutes);

// Mock the database module
jest.mock('../config/database', () => ({
  query: jest.fn(),
  execute: jest.fn()
}));

// Mock auth middleware
jest.mock('../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-123', username: 'testuser' };
    next();
  },
  AuthRequest: {} as any
}));

// Mock processingService
jest.mock('../services/processingService', () => ({
  getAllProcessingRecipes: jest.fn().mockResolvedValue([
    {
      id: 'recipe-1',
      name: '冶炼',
      type: 'smelting',
      input: { iron_ore: 2, coal: 1 },
      output: { iron_ingot: 1 },
      efficiency: 1.0,
    },
    {
      id: 'recipe-2',
      name: '木工',
      type: 'carpentry',
      input: { wood: 2 },
      output: { plank: 1 },
      efficiency: 1.0,
    },
    {
      id: 'recipe-3',
      name: '研磨',
      type: 'grinding',
      input: { herb: 2 },
      output: { herb_powder: 1 },
      efficiency: 1.0,
    },
  ]),
  getProcessingRecipeByType: jest.fn().mockImplementation((type: string) => {
    const recipes: Record<string, any> = {
      smelting: {
        id: 'recipe-1',
        name: '冶炼',
        type: 'smelting',
        input: { iron_ore: 2, coal: 1 },
        output: { iron_ingot: 1 },
        efficiency: 1.0,
      },
      carpentry: {
        id: 'recipe-2',
        name: '木工',
        type: 'carpentry',
        input: { wood: 2 },
        output: { plank: 1 },
        efficiency: 1.0,
      },
      grinding: {
        id: 'recipe-3',
        name: '研磨',
        type: 'grinding',
        input: { herb: 2 },
        output: { herb_powder: 1 },
        efficiency: 1.0,
      },
    };
    return Promise.resolve(recipes[type] || null);
  }),
  clearRecipesCache: jest.fn(),
}));

// Mock playerService
jest.mock('../services/playerService', () => ({
  getPlayerProfile: jest.fn().mockImplementation((userId: string) => {
    if (userId === 'user-123') {
      return Promise.resolve({
        id: 'player-1',
        user_id: 'user-123',
        username: 'testuser',
        resources: {},
        materials: { iron_ore: 10, coal: 5, wood: 10, herb: 10, iron_ingot: 0, plank: 0, herb_powder: 0 },
        production_gear: {},
        warehouse_limits: { material: 500 },
        idle_queue: [],
        last_offline: null,
        characters: [],
      });
    }
    return Promise.resolve(null);
  }),
}));

const mockedQuery = query as jest.MockedFunction<typeof query>;
const mockedExecute = execute as jest.MockedFunction<typeof execute>;

describe('Processing API Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/processing/recipes', () => {
    it('should return all processing recipes', async () => {
      const response = await request(app)
        .get('/api/processing/recipes');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(3);
      expect(response.body.data[0].type).toBe('smelting');
      expect(response.body.data[1].type).toBe('carpentry');
      expect(response.body.data[2].type).toBe('grinding');
    });

    it('should return empty array when no recipes', async () => {
      const processingService = require('../services/processingService');
      (processingService.getAllProcessingRecipes as jest.Mock).mockResolvedValueOnce([]);

      const response = await request(app)
        .get('/api/processing/recipes');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(0);
    });
  });

  describe('GET /api/processing/recipes/:type', () => {
    it('should return smelting recipe', async () => {
      const response = await request(app)
        .get('/api/processing/recipes/smelting');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.type).toBe('smelting');
      expect(response.body.data.name).toBe('冶炼');
    });

    it('should return 404 for non-existent type', async () => {
      const response = await request(app)
        .get('/api/processing/recipes/invalid');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Recipe not found');
    });
  });

  describe('POST /api/processing/process', () => {
    it('should process materials successfully', async () => {
      mockedExecute.mockResolvedValue(1);

      const response = await request(app)
        .post('/api/processing/process')
        .send({ recipeType: 'smelting', quantity: 1 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.recipe).toBe('冶炼');
      expect(response.body.data.output).toEqual({ iron_ingot: 1 });
      expect(mockedExecute).toHaveBeenCalled();
    });

    it('should process with custom quantity', async () => {
      mockedExecute.mockResolvedValue(1);

      const response = await request(app)
        .post('/api/processing/process')
        .send({ recipeType: 'carpentry', quantity: 3 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.quantity).toBe(3);
      expect(response.body.data.input).toEqual({ wood: 6 });
      expect(response.body.data.output).toEqual({ plank: 3 });
    });

    it('should return 400 for missing recipeType', async () => {
      const response = await request(app)
        .post('/api/processing/process')
        .send({ quantity: 1 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('recipeType is required');
    });

    it('should return 400 for invalid quantity', async () => {
      const response = await request(app)
        .post('/api/processing/process')
        .send({ recipeType: 'smelting', quantity: 0 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('quantity must be a positive integer');
    });

    it('should return 400 for negative quantity', async () => {
      const response = await request(app)
        .post('/api/processing/process')
        .send({ recipeType: 'smelting', quantity: -1 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('quantity must be a positive integer');
    });

    it('should return 400 for non-integer quantity', async () => {
      const response = await request(app)
        .post('/api/processing/process')
        .send({ recipeType: 'smelting', quantity: 1.5 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('quantity must be a positive integer');
    });

    it('should return 404 for non-existent recipe', async () => {
      const response = await request(app)
        .post('/api/processing/process')
        .send({ recipeType: 'nonexistent' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Recipe not found');
    });

    it('should return 400 for insufficient materials', async () => {
      const playerService = require('../services/playerService');
      (playerService.getPlayerProfile as jest.Mock).mockResolvedValueOnce({
        id: 'player-1',
        materials: { iron_ore: 1, coal: 0, iron_ingot: 0 },
      });

      const response = await request(app)
        .post('/api/processing/process')
        .send({ recipeType: 'smelting', quantity: 1 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Insufficient materials');
    });

    it('should apply efficiency to output', async () => {
      const processingService = require('../services/processingService');
      (processingService.getProcessingRecipeByType as jest.Mock).mockResolvedValueOnce({
        id: 'recipe-1',
        name: '冶炼',
        type: 'smelting',
        input: { iron_ore: 2, coal: 1 },
        output: { iron_ingot: 1 },
        efficiency: 1.5,
      });

      mockedExecute.mockResolvedValue(1);

      const response = await request(app)
        .post('/api/processing/process')
        .send({ recipeType: 'smelting', quantity: 2 });

      expect(response.status).toBe(200);
      // efficiency 1.5 * 2 quantity * 1 base = 3 output (floored)
      expect(response.body.data.output).toEqual({ iron_ingot: 3 });
    });
  });
});
