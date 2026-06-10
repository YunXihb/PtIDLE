import {
  createCharacter,
  getCharactersByUserId,
  updateCharacterName,
  assignCardToCharacter,
} from '../services/characterService';
import { query, execute } from '../config/database';
import * as professionMechanicService from '../services/professionMechanicService';

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

// Mock professionMechanicService (T039)
jest.mock('../services/professionMechanicService', () => ({
  validateCardForDeckAssignment: jest.fn(),
  validateCardForCombat: jest.fn(),
  canUseProfession: jest.fn(),
  getCardProfession: jest.fn(),
  getCharacterProfession: jest.fn(),
  onWarriorAttackCardPlayed: jest.fn(),
  applyWarriorTaunt: jest.fn(),
  getTauntRedirect: jest.fn(),
}));

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockExecute = execute as jest.MockedFunction<typeof execute>;
const mockValidateCardForDeckAssignment =
  professionMechanicService.validateCardForDeckAssignment as jest.MockedFunction<
    typeof professionMechanicService.validateCardForDeckAssignment
  >;

describe('characterService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // 默认 profession 校验通过
    mockValidateCardForDeckAssignment.mockResolvedValue({ valid: true });
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

  describe('assignCardToCharacter', () => {
    const userId = 'user-uuid';
    const playerId = 'player-uuid';
    const characterId = 'char-uuid';
    const cardId = 'card-uuid';

    it('should assign card successfully when profession matches', async () => {
      const { getPlayerIdByUserId } = require('../services/playerService');
      getPlayerIdByUserId.mockResolvedValue(playerId);
      // query #1: character
      // query #2: card
      // query #3: existing assignment (empty)
      // query #4: deck count
      mockQuery
        .mockResolvedValueOnce([{ id: characterId, player_id: playerId, profession: 'warrior' }] as any)
        .mockResolvedValueOnce([{ id: cardId }] as any)
        .mockResolvedValueOnce([] as any)
        .mockResolvedValueOnce([{ count: '3' }] as any);
      mockExecute.mockResolvedValueOnce(1 as any);

      const result = await assignCardToCharacter(userId, characterId, cardId);
      expect(result.success).toBe(true);
      expect(result.character_deck_id).toBeDefined();
    });

    it('should return error when profession does not match', async () => {
      const { getPlayerIdByUserId } = require('../services/playerService');
      getPlayerIdByUserId.mockResolvedValue(playerId);
      mockQuery
        .mockResolvedValueOnce([{ id: characterId, player_id: playerId, profession: 'warrior' }] as any)
        .mockResolvedValueOnce([{ id: cardId }] as any)
        .mockResolvedValueOnce([] as any)
        .mockResolvedValueOnce([{ count: '3' }] as any);
      mockValidateCardForDeckAssignment.mockResolvedValueOnce({
        valid: false,
        error: "Character profession 'warrior' cannot use card profession 'mage'",
      });

      const result = await assignCardToCharacter(userId, characterId, cardId);
      expect(result.success).toBe(false);
      expect(result.error).toContain('profession');
    });

    it('should return error when player not found', async () => {
      const { getPlayerIdByUserId } = require('../services/playerService');
      getPlayerIdByUserId.mockResolvedValue(null);

      const result = await assignCardToCharacter(userId, characterId, cardId);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Player not found');
    });

    it('should return error when character not found', async () => {
      const { getPlayerIdByUserId } = require('../services/playerService');
      getPlayerIdByUserId.mockResolvedValue(playerId);
      mockQuery.mockResolvedValueOnce([] as any);

      const result = await assignCardToCharacter(userId, characterId, cardId);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Character not found');
    });

    it('should return error when card not found', async () => {
      const { getPlayerIdByUserId } = require('../services/playerService');
      getPlayerIdByUserId.mockResolvedValue(playerId);
      mockQuery
        .mockResolvedValueOnce([{ id: characterId, player_id: playerId, profession: 'warrior' }] as any)
        .mockResolvedValueOnce([] as any);

      const result = await assignCardToCharacter(userId, characterId, cardId);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Card not found');
    });

    it('should return error when card already assigned', async () => {
      const { getPlayerIdByUserId } = require('../services/playerService');
      getPlayerIdByUserId.mockResolvedValue(playerId);
      mockQuery
        .mockResolvedValueOnce([{ id: characterId, player_id: playerId, profession: 'warrior' }] as any)
        .mockResolvedValueOnce([{ id: cardId }] as any)
        .mockResolvedValueOnce([{ id: 'existing-deck-id' }] as any);

      const result = await assignCardToCharacter(userId, characterId, cardId);
      expect(result.success).toBe(false);
      expect(result.error).toContain('already assigned');
    });

    it('should return error when deck is full', async () => {
      const { getPlayerIdByUserId } = require('../services/playerService');
      getPlayerIdByUserId.mockResolvedValue(playerId);
      mockQuery
        .mockResolvedValueOnce([{ id: characterId, player_id: playerId, profession: 'warrior' }] as any)
        .mockResolvedValueOnce([{ id: cardId }] as any)
        .mockResolvedValueOnce([] as any)
        .mockResolvedValueOnce([{ count: '10' }] as any);

      const result = await assignCardToCharacter(userId, characterId, cardId);
      expect(result.success).toBe(false);
      expect(result.error).toContain('full');
    });
  });
});
