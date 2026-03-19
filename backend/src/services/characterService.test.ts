import { createCharacter, getCharactersByUserId, updateCharacterName } from '../services/characterService';
import { query, execute } from '../config/database';

// Mock the database module
jest.mock('../config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
}));

// Mock playerService
jest.mock('../services/playerService', () => ({
  getPlayerIdByUserId: jest.fn(),
}));

// Mock professionService
jest.mock('../services/professionService', () => ({
  getProfessionByName: jest.fn(),
}));

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockExecute = execute as jest.MockedFunction<typeof execute>;

describe('characterService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createCharacter', () => {
    const mockProfession = {
      id: 'uuid-profession',
      name: 'warrior',
      base_health: 20,
      base_movement: 2,
      base_energy: 3,
      description: '战士',
    };

    it('should create a character successfully', async () => {
      const { getPlayerIdByUserId } = require('../services/playerService');
      const { getProfessionByName } = require('../services/professionService');

      getPlayerIdByUserId.mockResolvedValue('player-uuid');
      getProfessionByName.mockResolvedValue(mockProfession);
      mockQuery.mockResolvedValueOnce([{ count: 3 }] as any); // character count
      mockExecute.mockResolvedValueOnce(1 as any);

      const result = await createCharacter('user-uuid', 'TestChar', 'warrior');

      expect(result.success).toBe(true);
      expect(result.character).toBeDefined();
      expect(result.character?.name).toBe('TestChar');
      expect(result.character?.profession).toBe('warrior');
      expect(result.character?.health).toBe(20);
    });

    it('should return error for invalid profession', async () => {
      const { getProfessionByName } = require('../services/professionService');

      getProfessionByName.mockResolvedValue(null);

      const result = await createCharacter('user-uuid', 'TestChar', 'invalid');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid profession');
    });

    it('should return error for player not found', async () => {
      const { getPlayerIdByUserId } = require('../services/playerService');
      const { getProfessionByName } = require('../services/professionService');

      getPlayerIdByUserId.mockResolvedValue(null);
      getProfessionByName.mockResolvedValue(mockProfession);

      const result = await createCharacter('user-uuid', 'TestChar', 'warrior');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Player not found');
    });

    it('should return error when character limit reached', async () => {
      const { getPlayerIdByUserId } = require('../services/playerService');
      const { getProfessionByName } = require('../services/professionService');

      getPlayerIdByUserId.mockResolvedValue('player-uuid');
      getProfessionByName.mockResolvedValue(mockProfession);
      mockQuery.mockResolvedValueOnce([{ count: 9 }] as any); // already at limit

      const result = await createCharacter('user-uuid', 'TestChar', 'warrior');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Maximum character limit reached (9)');
    });
  });

  describe('getCharactersByUserId', () => {
    it('should return empty array when player not found', async () => {
      const { getPlayerIdByUserId } = require('../services/playerService');

      getPlayerIdByUserId.mockResolvedValue(null);

      const characters = await getCharactersByUserId('user-uuid');

      expect(characters).toEqual([]);
    });

    it('should return characters for valid user', async () => {
      const { getPlayerIdByUserId } = require('../services/playerService');

      getPlayerIdByUserId.mockResolvedValue('player-uuid');
      mockQuery.mockResolvedValueOnce([
        {
          id: 'char-1',
          player_id: 'player-uuid',
          name: 'Warrior1',
          profession: 'warrior',
          health: 20,
          max_health: 20,
          movement: 2,
          energy: 3,
          max_energy: 3,
          position_x: null,
          position_y: null,
          is_alive: true,
          created_at: new Date(),
        },
      ] as any);

      const characters = await getCharactersByUserId('user-uuid');

      expect(characters).toHaveLength(1);
      expect(characters[0].name).toBe('Warrior1');
    });
  });

  describe('updateCharacterName', () => {
    it('should update character name successfully', async () => {
      const { getPlayerIdByUserId } = require('../services/playerService');

      getPlayerIdByUserId.mockResolvedValue('player-uuid');
      mockQuery.mockResolvedValueOnce([
        {
          id: 'char-1',
          player_id: 'player-uuid',
          name: 'OldName',
          profession: 'warrior',
          health: 20,
          max_health: 20,
          movement: 2,
          energy: 3,
          max_energy: 3,
          position_x: null,
          position_y: null,
          is_alive: true,
          created_at: new Date(),
        },
      ] as any);
      mockExecute.mockResolvedValueOnce(1 as any);

      const result = await updateCharacterName('user-uuid', 'char-1', 'NewName');

      expect(result.success).toBe(true);
      expect(result.character).toBeDefined();
      expect(result.character?.name).toBe('NewName');
    });

    it('should return error for player not found', async () => {
      const { getPlayerIdByUserId } = require('../services/playerService');

      getPlayerIdByUserId.mockResolvedValue(null);

      const result = await updateCharacterName('user-uuid', 'char-1', 'NewName');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Player not found');
    });

    it('should return error for character not found', async () => {
      const { getPlayerIdByUserId } = require('../services/playerService');

      getPlayerIdByUserId.mockResolvedValue('player-uuid');
      mockQuery.mockResolvedValueOnce([] as any);

      const result = await updateCharacterName('user-uuid', 'char-999', 'NewName');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Character not found');
    });
  });
});
