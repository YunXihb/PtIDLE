import { getAllCardTemplates, getCardTemplateById, clearCardTemplatesCache } from '../services/cardService';
import { query } from '../config/database';

// Mock the database module
jest.mock('../config/database', () => ({
  query: jest.fn(),
}));

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('cardService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearCardTemplatesCache();
  });

  describe('getAllCardTemplates', () => {
    it('should return all card templates from database', async () => {
      const mockCards = [
        {
          id: 'card-1',
          name: '轻击',
          description: '造成2点伤害',
          type: 'attack' as const,
          cost: 1,
          effect: { damage: 2 },
          profession: 'common',
        },
        {
          id: 'card-2',
          name: '重击',
          description: '造成4点伤害',
          type: 'attack' as const,
          cost: 2,
          effect: { damage: 4 },
          profession: 'warrior',
        },
      ];

      mockQuery.mockResolvedValueOnce(mockCards as any);

      const cards = await getAllCardTemplates();

      expect(cards).toHaveLength(2);
      expect(cards[0].name).toBe('轻击');
      expect(cards[1].profession).toBe('warrior');
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('should return cached data on subsequent calls', async () => {
      const mockCards = [
        {
          id: 'card-1',
          name: '轻击',
          description: '造成2点伤害',
          type: 'attack' as const,
          cost: 1,
          effect: { damage: 2 },
          profession: 'common',
        },
      ];

      mockQuery.mockResolvedValueOnce(mockCards as any);

      // First call
      await getAllCardTemplates();
      // Second call
      await getAllCardTemplates();

      expect(mockQuery).toHaveBeenCalledTimes(1);
    });
  });

  describe('getCardTemplateById', () => {
    it('should return card template by id', async () => {
      const mockCards = [
        {
          id: 'card-1',
          name: '轻击',
          description: '造成2点伤害',
          type: 'attack' as const,
          cost: 1,
          effect: { damage: 2 },
          profession: 'common',
        },
      ];

      mockQuery.mockResolvedValueOnce(mockCards as any);

      const card = await getCardTemplateById('card-1');

      expect(card).toBeDefined();
      expect(card?.name).toBe('轻击');
    });

    it('should return null for non-existent card', async () => {
      const mockCards: any[] = [];

      mockQuery.mockResolvedValueOnce(mockCards);

      const card = await getCardTemplateById('non-existent');

      expect(card).toBeNull();
    });
  });
});
