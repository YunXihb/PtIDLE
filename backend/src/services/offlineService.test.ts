// Unit tests for offlineService
import {
  calculateOfflineEarnings,
  applyWarehouseLimits,
  calculateStoredAmount,
  MAX_OFFLINE_MINUTES,
  DEFAULT_WAREHOUSE_LIMIT,
} from '../services/offlineService';

describe('offlineService', () => {
  describe('calculateStoredAmount', () => {
    it('should store all added resources when there is capacity', () => {
      expect(calculateStoredAmount(100, 50, 1000)).toBe(50);
    });

    it('should limit stored resources to remaining capacity', () => {
      expect(calculateStoredAmount(950, 100, 1000)).toBe(50);
    });

    it('should return 0 when already at capacity', () => {
      expect(calculateStoredAmount(1000, 100, 1000)).toBe(0);
    });

    it('should handle negative added values correctly', () => {
      expect(calculateStoredAmount(500, -100, 1000)).toBe(0);
    });

    it('should handle zero capacity', () => {
      expect(calculateStoredAmount(0, 100, 0)).toBe(0);
    });
  });

  describe('calculateOfflineEarnings', () => {
    it('should return zero earnings when lastOfflineTime is null', () => {
      const result = calculateOfflineEarnings(null);

      expect(result.offlineTime).toBe(0);
      expect(result.maxOfflineTime).toBe(0);
      expect(result.resources.iron_ore).toBe(0);
      expect(result.totalResourceCount).toBe(0);
    });

    it('should calculate correct earnings for 60 minutes offline', () => {
      const lastOffline = new Date(Date.now() - 60 * 60 * 1000); // 60 minutes ago
      const result = calculateOfflineEarnings(lastOffline);

      expect(result.offlineTime).toBe(60);
      expect(result.resources.iron_ore).toBe(60); // 1 per minute
      expect(result.resources.coal).toBe(30); // 0.5 per minute
      expect(result.resources.wood).toBe(60);
      expect(result.resources.sap).toBe(30);
      expect(result.resources.herb).toBe(60);
      expect(result.resources.mushroom).toBe(30);
    });

    it('should cap earnings at maximum offline time', () => {
      // 48 hours ago - should be capped at 24 hours (MAX_OFFLINE_MINUTES)
      const lastOffline = new Date(Date.now() - 48 * 60 * 60 * 1000);
      const result = calculateOfflineEarnings(lastOffline);

      expect(result.offlineTime).toBeGreaterThan(MAX_OFFLINE_MINUTES);
      expect(result.maxOfflineTime).toBe(MAX_OFFLINE_MINUTES);
      expect(result.resources.iron_ore).toBe(MAX_OFFLINE_MINUTES); // 1 per minute * 1440
    });

    it('should handle very short offline time (less than 1 minute)', () => {
      const lastOffline = new Date(Date.now() - 30 * 1000); // 30 seconds ago
      const result = calculateOfflineEarnings(lastOffline);

      expect(result.offlineTime).toBe(0);
      expect(result.resources.iron_ore).toBe(0);
    });

    it('should calculate totalResourceCount correctly', () => {
      const lastOffline = new Date(Date.now() - 60 * 60 * 1000); // 60 minutes
      const result = calculateOfflineEarnings(lastOffline);

      const expectedTotal = 60 + 30 + 60 + 30 + 60 + 30; // 270
      expect(result.totalResourceCount).toBe(expectedTotal);
    });
  });

  describe('applyWarehouseLimits', () => {
    it('should store all earnings when under warehouse limits', () => {
      const earnings = {
        offlineTime: 60,
        maxOfflineTime: 60,
        resources: { iron_ore: 60, coal: 30, wood: 60, sap: 30, herb: 60, mushroom: 30 },
        totalResourceCount: 270,
      };
      const currentResources = { iron_ore: 0, coal: 0, wood: 0, sap: 0, herb: 0, mushroom: 0 };
      const warehouseLimits = { resource: 1000, material: 500 };

      const result = applyWarehouseLimits(earnings, currentResources, warehouseLimits);

      expect(result.stored.iron_ore).toBe(60);
      expect(result.stored.coal).toBe(30);
      expect(result.overflowed.iron_ore).toBe(0);
      expect(result.overflowed.coal).toBe(0);
    });

    it('should limit stored resources when at capacity', () => {
      const earnings = {
        offlineTime: 60,
        maxOfflineTime: 60,
        resources: { iron_ore: 60, coal: 30, wood: 60, sap: 30, herb: 60, mushroom: 30 },
        totalResourceCount: 270,
      };
      const currentResources = { iron_ore: 950, coal: 980, wood: 0, sap: 0, herb: 0, mushroom: 0 };
      const warehouseLimits = { resource: 1000, material: 500 };

      const result = applyWarehouseLimits(earnings, currentResources, warehouseLimits);

      expect(result.stored.iron_ore).toBe(50); // 1000 - 950 = 50 remaining
      expect(result.overflowed.iron_ore).toBe(10); // 60 - 50 = 10 overflowed
      expect(result.stored.coal).toBe(20); // 1000 - 980 = 20 remaining
      expect(result.overflowed.coal).toBe(10); // 30 - 20 = 10 overflowed
    });

    it('should use default warehouse limit when not specified', () => {
      const earnings = {
        offlineTime: 60,
        maxOfflineTime: 60,
        resources: { iron_ore: 60, coal: 30, wood: 60, sap: 30, herb: 60, mushroom: 30 },
        totalResourceCount: 270,
      };
      const currentResources = { iron_ore: 0, coal: 0, wood: 0, sap: 0, herb: 0, mushroom: 0 };
      const warehouseLimits = {}; // No limits specified

      const result = applyWarehouseLimits(earnings, currentResources, warehouseLimits);

      expect(result.stored.iron_ore).toBe(60);
      expect(result.stored.coal).toBe(30);
    });

    it('should handle missing current resources as zero', () => {
      const earnings = {
        offlineTime: 60,
        maxOfflineTime: 60,
        resources: { iron_ore: 60, coal: 30, wood: 60, sap: 30, herb: 60, mushroom: 30 },
        totalResourceCount: 270,
      };
      const currentResources = {}; // Empty
      const warehouseLimits = { resource: 1000 };

      const result = applyWarehouseLimits(earnings, currentResources, warehouseLimits);

      expect(result.stored.iron_ore).toBe(60);
    });
  });

  describe('constants', () => {
    it('MAX_OFFLINE_MINUTES should be 1440 (24 hours)', () => {
      expect(MAX_OFFLINE_MINUTES).toBe(1440);
    });

    it('DEFAULT_WAREHOUSE_LIMIT should be 1000', () => {
      expect(DEFAULT_WAREHOUSE_LIMIT).toBe(1000);
    });
  });
});
