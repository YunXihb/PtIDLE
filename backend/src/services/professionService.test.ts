import { getAllProfessions, getProfessionByName, clearProfessionsCache } from '../services/professionService';
import { query } from '../config/database';

// Mock the database module
jest.mock('../config/database', () => ({
  query: jest.fn(),
}));

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('professionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearProfessionsCache();
    jest.clearAllMocks();
  });

  describe('getAllProfessions', () => {
    it('should return all professions from database', async () => {
      const mockProfessions = [
        {
          id: 'uuid-1',
          name: 'mage',
          base_health: 12,
          base_movement: 2,
          base_energy: 3,
          description: '法师 - 低血量，远程AOE',
        },
        {
          id: 'uuid-2',
          name: 'ranger',
          base_health: 15,
          base_movement: 3,
          base_energy: 3,
          description: '弓手 - 中等血量，远程单体',
        },
        {
          id: 'uuid-3',
          name: 'warrior',
          base_health: 20,
          base_movement: 2,
          base_energy: 3,
          description: '战士 - 高血量，近战坦克',
        },
      ];

      mockQuery.mockResolvedValue(mockProfessions as any);

      const professions = await getAllProfessions();

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT id, name, base_health, base_movement, base_energy, description FROM professions ORDER BY name'
      );
      expect(professions).toHaveLength(3);
      expect(professions[0].name).toBe('mage');
      expect(professions[1].name).toBe('ranger');
      expect(professions[2].name).toBe('warrior');
    });

    it('should return cached data if cache is valid', async () => {
      const mockProfessions = [
        {
          id: 'uuid-1',
          name: 'warrior',
          base_health: 20,
          base_movement: 2,
          base_energy: 3,
          description: '战士 - 高血量，近战坦克',
        },
      ];

      mockQuery.mockResolvedValue(mockProfessions as any);

      // First call - should query database
      await getAllProfessions();
      // Second call - should use cache
      const professions = await getAllProfessions();

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(professions).toHaveLength(1);
    });

    it('should handle empty database result', async () => {
      mockQuery.mockResolvedValue([] as any);

      const professions = await getAllProfessions();

      expect(professions).toHaveLength(0);
    });
  });

  describe('getProfessionByName', () => {
    it('should return profession by name', async () => {
      const mockProfessions = [
        {
          id: 'uuid-1',
          name: 'warrior',
          base_health: 20,
          base_movement: 2,
          base_energy: 3,
          description: '战士 - 高血量，近战坦克',
        },
      ];

      mockQuery.mockResolvedValue(mockProfessions as any);

      const profession = await getProfessionByName('warrior');

      expect(profession).not.toBeNull();
      expect(profession?.name).toBe('warrior');
      expect(profession?.base_health).toBe(20);
    });

    it('should return null for non-existent profession', async () => {
      const mockProfessions = [
        {
          id: 'uuid-1',
          name: 'warrior',
          base_health: 20,
          base_movement: 2,
          base_energy: 3,
          description: '战士 - 高血量，近战坦克',
        },
      ];

      mockQuery.mockResolvedValue(mockProfessions as any);

      const profession = await getProfessionByName('nonexistent');

      expect(profession).toBeNull();
    });
  });

  describe('clearProfessionsCache', () => {
    it('should clear the cache', async () => {
      const mockProfessions = [
        {
          id: 'uuid-1',
          name: 'warrior',
          base_health: 20,
          base_movement: 2,
          base_energy: 3,
          description: '战士 - 高血量，近战坦克',
        },
      ];

      mockQuery.mockResolvedValue(mockProfessions as any);

      // First call - populate cache
      await getAllProfessions();
      // Clear cache
      clearProfessionsCache();
      // Second call - should query database again
      await getAllProfessions();

      expect(mockQuery).toHaveBeenCalledTimes(2);
    });
  });
});
