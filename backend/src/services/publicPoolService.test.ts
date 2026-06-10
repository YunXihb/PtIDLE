// Unit tests for publicPoolService

const mockGetPublicPoolCards = jest.fn();

jest.mock('./cardService', () => ({
  getPublicPoolCards: mockGetPublicPoolCards,
}));

import { drawFromPublicPool, isPublicPoolDeckId } from './publicPoolService';

describe('publicPoolService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const mockPoolCard = {
    id: 'template-qj',
    name: '轻击',
    description: '造成2点伤害',
    type: 'attack' as const,
    cost: 1,
    effect: { damage: 2 },
    profession: 'common',
    template_no: 1,
    max_quantity: 5,
    is_public_pool: true,
  };

  describe('drawFromPublicPool', () => {
    it('should return empty array when need <= 0', async () => {
      const result = await drawFromPublicPool(0);
      expect(result).toEqual([]);
      expect(mockGetPublicPoolCards).not.toHaveBeenCalled();
    });

    it('should return empty array when public pool is empty', async () => {
      mockGetPublicPoolCards.mockResolvedValueOnce([]);
      const result = await drawFromPublicPool(3);
      expect(result).toEqual([]);
    });

    it('should return N copies of the public pool card with source=public_pool', async () => {
      mockGetPublicPoolCards.mockResolvedValueOnce([mockPoolCard]);
      const result = await drawFromPublicPool(3);
      expect(result).toHaveLength(3);
      for (const c of result) {
        expect(c.source).toBe('public_pool');
        expect(c.name).toBe('轻击');
        expect(c.type).toBe('attack');
        expect(c.cost).toBe(1);
        expect(c.template_no).toBe(1);
        expect(c.deck_id).toBe('pool:1');
        expect(c.card_id).toBe('template-qj');
      }
    });

    it('should return single copy when need=1', async () => {
      mockGetPublicPoolCards.mockResolvedValueOnce([mockPoolCard]);
      const result = await drawFromPublicPool(1);
      expect(result).toHaveLength(1);
    });
  });

  describe('isPublicPoolDeckId', () => {
    it('should return true for pool: prefix', () => {
      expect(isPublicPoolDeckId('pool:1')).toBe(true);
      expect(isPublicPoolDeckId('pool:8')).toBe(true);
    });

    it('should return false for non-pool deck_ids', () => {
      expect(isPublicPoolDeckId('uuid-123')).toBe(false);
      expect(isPublicPoolDeckId('deck:1')).toBe(false);
      expect(isPublicPoolDeckId('')).toBe(false);
    });
  });
});
