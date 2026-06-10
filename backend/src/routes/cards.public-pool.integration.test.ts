// T1001 Integration tests for /api/cards/public-pool route

import request from 'supertest';
import express from 'express';
import cardsRoutes from './cards';

const app = express();
app.use(express.json());
app.use('/api/cards', cardsRoutes);

// Mock the cardService module — must be declared before importing route
jest.mock('../services/cardService', () => ({
  getAllCardTemplates: jest.fn(),
  getCardTemplateById: jest.fn(),
  getPlayerCards: jest.fn(),
  getPublicPoolCards: jest.fn(),
}));

import * as cardService from '../services/cardService';

const mockGetAllCardTemplates = cardService.getAllCardTemplates as jest.MockedFunction<
  typeof cardService.getAllCardTemplates
>;
const mockGetCardTemplateById = cardService.getCardTemplateById as jest.MockedFunction<
  typeof cardService.getCardTemplateById
>;
const mockGetPublicPoolCards = cardService.getPublicPoolCards as jest.MockedFunction<
  typeof cardService.getPublicPoolCards
>;

describe('GET /api/cards/public-pool (T1001)', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('should return public pool cards with is_public_pool=true', async () => {
    const poolCards: cardService.CardTemplate[] = [
      {
        id: 'template-qj',
        name: '轻击',
        description: '造成2点伤害',
        type: 'attack',
        cost: 1,
        effect: { damage: 2 },
        profession: 'common',
        template_no: 1,
        max_quantity: 5,
        is_public_pool: true,
      },
    ];
    mockGetPublicPoolCards.mockResolvedValueOnce(poolCards);

    const res = await request(app).get('/api/cards/public-pool');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual(poolCards);
    expect(res.body.data[0].is_public_pool).toBe(true);
    expect(res.body.data[0].name).toBe('轻击');
  });

  it('should return empty data when no public pool cards exist', async () => {
    mockGetPublicPoolCards.mockResolvedValueOnce([]);

    const res = await request(app).get('/api/cards/public-pool');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
  });

  it('should return 500 on service error', async () => {
    mockGetPublicPoolCards.mockRejectedValueOnce(new Error('DB down'));

    const res = await request(app).get('/api/cards/public-pool');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to fetch public pool cards');
  });

  it('should be reachable before /:id route (no greedy match)', async () => {
    const poolCards: cardService.CardTemplate[] = [
      {
        id: 'template-qj',
        name: '轻击',
        description: null,
        type: 'attack',
        cost: 1,
        effect: { damage: 2 },
        profession: 'common',
        template_no: 1,
        max_quantity: 5,
        is_public_pool: true,
      },
    ];
    mockGetPublicPoolCards.mockResolvedValueOnce(poolCards);

    const res = await request(app).get('/api/cards/public-pool');

    // If greedy /:id route had captured this, getCardTemplateById would have been called
    // instead of getPublicPoolCards.
    expect(mockGetPublicPoolCards).toHaveBeenCalled();
    expect(mockGetCardTemplateById).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it('should not call getAllCardTemplates (different endpoint)', async () => {
    mockGetPublicPoolCards.mockResolvedValueOnce([]);

    await request(app).get('/api/cards/public-pool');

    expect(mockGetAllCardTemplates).not.toHaveBeenCalled();
  });
});
