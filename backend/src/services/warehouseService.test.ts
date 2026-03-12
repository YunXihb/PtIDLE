import { getWarehouseData } from '../services/warehouseService';
import { query } from '../config/database';

// Mock the database module
jest.mock('../config/database', () => ({
  query: jest.fn(),
}));

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('WarehouseService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getWarehouseData', () => {
    it('should return warehouse data for a valid user', async () => {
      const mockPlayerData = {
        resources: { iron_ore: 100, coal: 50, wood: 30 },
        materials: { iron_ingot: 10, plank: 5 },
        production_gear: { pickaxe: { bonus: 0.1 } },
        warehouse_limits: { resource: 1000, material: 500 },
      };

      mockQuery.mockResolvedValue([mockPlayerData] as any);

      const result = await getWarehouseData('user-123');

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT resources, materials, production_gear, warehouse_limits FROM players WHERE user_id = $1',
        ['user-123']
      );
      expect(result).not.toBeNull();
      expect(result?.resources).toEqual({ iron_ore: 100, coal: 50, wood: 30 });
      expect(result?.materials).toEqual({ iron_ingot: 10, plank: 5 });
      expect(result?.storageLimits).toEqual({ resource: 1000, material: 500 });
    });

    it('should return null if player not found', async () => {
      mockQuery.mockResolvedValue([]);

      const result = await getWarehouseData('nonexistent-user');

      expect(result).toBeNull();
    });

    it('should return empty objects for null database values', async () => {
      const mockPlayerData = {
        resources: null,
        materials: null,
        production_gear: null,
        warehouse_limits: null,
      };

      mockQuery.mockResolvedValue([mockPlayerData] as any);

      const result = await getWarehouseData('user-123');

      expect(result).not.toBeNull();
      expect(result?.resources).toEqual({});
      expect(result?.materials).toEqual({});
      expect(result?.production_gear).toEqual({});
      expect(result?.storageLimits).toEqual({});
    });

    it('should handle partial data correctly', async () => {
      const mockPlayerData = {
        resources: { iron_ore: 100 },
        materials: null,
        production_gear: { pickaxe: { bonus: 0.1 } },
        warehouse_limits: { resource: 1000 },
      };

      mockQuery.mockResolvedValue([mockPlayerData] as any);

      const result = await getWarehouseData('user-123');

      expect(result?.resources).toEqual({ iron_ore: 100 });
      expect(result?.materials).toEqual({});
      expect(result?.production_gear).toEqual({ pickaxe: { bonus: 0.1 } });
      expect(result?.storageLimits).toEqual({ resource: 1000 });
    });
  });
});
