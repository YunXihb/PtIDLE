// Unit tests for skillService
import * as skillService from '../services/skillService';
import { query } from '../config/database';

jest.mock('../config/database', () => ({
  query: jest.fn()
}));

const mockedQuery = query as jest.MockedFunction<typeof query>;

describe('skillService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clear the cache before each test
    skillService.clearSkillsCache();
  });

  describe('getAllGatheringSkills', () => {
    it('should return all gathering skills from database', async () => {
      mockedQuery.mockResolvedValueOnce([
        {
          id: 'skill-1',
          name: '采矿',
          type: 'mining',
          yields: { iron_ore: 1, coal: 0.3 },
          base_yield: 1
        },
        {
          id: 'skill-2',
          name: '伐木',
          type: 'woodcutting',
          yields: { wood: 1, sap: 0.2 },
          base_yield: 1
        },
        {
          id: 'skill-3',
          name: '草药学',
          type: 'herbalism',
          yields: { herb: 1, mushroom: 0.3 },
          base_yield: 1
        }
      ]);

      const skills = await skillService.getAllGatheringSkills();

      expect(skills).toHaveLength(3);
      expect(skills[0]).toEqual({
        id: 'skill-1',
        name: '采矿',
        type: 'mining',
        yields: { iron_ore: 1, coal: 0.3 },
        base_yield: 1
      });
    });

    it('should use cache on subsequent calls', async () => {
      mockedQuery.mockResolvedValueOnce([
        {
          id: 'skill-1',
          name: '采矿',
          type: 'mining',
          yields: { iron_ore: 1 },
          base_yield: 1
        }
      ]);

      // First call
      await skillService.getAllGatheringSkills();

      // Second call should use cache
      const skills = await skillService.getAllGatheringSkills();

      expect(mockedQuery).toHaveBeenCalledTimes(1);
      expect(skills).toHaveLength(1);
    });

    it('should return empty array if no skills exist', async () => {
      mockedQuery.mockResolvedValueOnce([]);

      const skills = await skillService.getAllGatheringSkills();

      expect(skills).toHaveLength(0);
    });
  });

  describe('getGatheringSkillByType', () => {
    it('should return skill by type', async () => {
      mockedQuery.mockResolvedValueOnce([
        {
          id: 'skill-1',
          name: '采矿',
          type: 'mining',
          yields: { iron_ore: 1 },
          base_yield: 1
        },
        {
          id: 'skill-2',
          name: '伐木',
          type: 'woodcutting',
          yields: { wood: 1 },
          base_yield: 1
        }
      ]);

      const skill = await skillService.getGatheringSkillByType('mining');

      expect(skill).not.toBeNull();
      expect(skill?.name).toBe('采矿');
      expect(skill?.type).toBe('mining');
    });

    it('should return null if skill type not found', async () => {
      mockedQuery.mockResolvedValueOnce([
        {
          id: 'skill-1',
          name: '采矿',
          type: 'mining',
          yields: { iron_ore: 1 },
          base_yield: 1
        }
      ]);

      const skill = await skillService.getGatheringSkillByType('nonexistent');

      expect(skill).toBeNull();
    });
  });

  describe('getGatheringConfig', () => {
    it('should return config in correct format', async () => {
      mockedQuery.mockResolvedValueOnce([
        {
          id: 'skill-1',
          name: '采矿',
          type: 'mining',
          yields: { iron_ore: 1, coal: 0.3 },
          base_yield: 1
        },
        {
          id: 'skill-2',
          name: '伐木',
          type: 'woodcutting',
          yields: { wood: 1, sap: 0.2 },
          base_yield: 1
        },
        {
          id: 'skill-3',
          name: '草药学',
          type: 'herbalism',
          yields: { herb: 1, mushroom: 0.3 },
          base_yield: 1
        }
      ]);

      const config = await skillService.getGatheringConfig();

      expect(config.mining).toEqual({
        primaryResource: 'iron_ore',
        baseRate: 1,
        byproduct: 'coal',
        byproductChance: 0.3
      });

      expect(config.woodcutting).toEqual({
        primaryResource: 'wood',
        baseRate: 1,
        byproduct: 'sap',
        byproductChance: 0.2
      });

      expect(config.herbalism).toEqual({
        primaryResource: 'herb',
        baseRate: 1,
        byproduct: 'mushroom',
        byproductChance: 0.3
      });
    });
  });

  describe('clearSkillsCache', () => {
    it('should clear the cache', async () => {
      mockedQuery
        .mockResolvedValueOnce([
          {
            id: 'skill-1',
            name: '采矿',
            type: 'mining',
            yields: { iron_ore: 1 },
            base_yield: 1
          }
        ])
        .mockResolvedValueOnce([
          {
            id: 'skill-1',
            name: '采矿',
            type: 'mining',
            yields: { iron_ore: 1 },
            base_yield: 1
          }
        ]);

      // First call populates cache
      await skillService.getAllGatheringSkills();

      // Clear cache
      skillService.clearSkillsCache();

      // Second call should query database again
      await skillService.getAllGatheringSkills();

      expect(mockedQuery).toHaveBeenCalledTimes(2);
    });
  });
});
