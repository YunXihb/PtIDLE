// Unit tests for playerService
import * as playerService from '../services/playerService';
import { query, execute } from '../config/database';

// Mock the database module
jest.mock('../config/database', () => ({
  query: jest.fn(),
  execute: jest.fn()
}));

const mockedQuery = query as jest.MockedFunction<typeof query>;
const mockedExecute = execute as jest.MockedFunction<typeof execute>;

describe('playerService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('initializePlayer', () => {
    const userId = 'user-123';

    it('should create a player record with correct default values', async () => {
      mockedExecute.mockResolvedValue(1);

      await playerService.initializePlayer(userId);

      // Check that execute was called for creating player
      const playerCall = mockedExecute.mock.calls[0]!;
      expect(playerCall[0]).toContain('INSERT INTO players');
      expect(playerCall[1]![1]).toBe(userId);
      expect(playerCall[1]![2]).toBe(JSON.stringify({ iron_ore: 0, coal: 0, wood: 0, sap: 0, herb: 0, mushroom: 0 }));
      expect(playerCall[1]![3]).toBe(JSON.stringify({ iron_ingot: 0, plank: 0, herb_powder: 0 }));
    });

    it('should create 3 characters (warrior, ranger, mage)', async () => {
      mockedExecute.mockResolvedValue(1);

      await playerService.initializePlayer(userId);

      // Check that execute was called 4 times (1 for player + 3 for characters)
      expect(mockedExecute).toHaveBeenCalledTimes(4);

      // Verify character calls
      const characterCalls = mockedExecute.mock.calls.slice(1);

      // First character should be warrior with correct stats
      // SQL: INSERT INTO characters (id, player_id, name, profession, health, max_health, movement, energy, max_energy, ...)
      // Params:   $1,        $2,        $3,   $4,         $5,     $6,          $7,       $8,    $9
      expect(characterCalls[0]![0]).toContain('INSERT INTO characters');
      expect(characterCalls[0]![1]![3]).toBe('warrior'); // profession
      expect(characterCalls[0]![1]![4]).toBe(20); // health (warrior)
      expect(characterCalls[0]![1]![6]).toBe(2); // movement (warrior)
      expect(characterCalls[0]![1]![8]).toBe(3); // max_energy (warrior)

      // Second character should be ranger with correct stats
      expect(characterCalls[1]![1]![3]).toBe('ranger'); // profession
      expect(characterCalls[1]![1]![4]).toBe(15); // health (ranger)
      expect(characterCalls[1]![1]![6]).toBe(3); // movement (ranger)
      expect(characterCalls[1]![1]![8]).toBe(3); // max_energy (ranger)

      // Third character should be mage with correct stats
      expect(characterCalls[2]![1]![3]).toBe('mage'); // profession
      expect(characterCalls[2]![1]![4]).toBe(12); // health (mage)
      expect(characterCalls[2]![1]![6]).toBe(2); // movement (mage)
      expect(characterCalls[2]![1]![8]).toBe(3); // max_energy (mage)
    });

    it('should set last_offline to current time', async () => {
      mockedExecute.mockResolvedValue(1);

      await playerService.initializePlayer(userId);

      const playerCall = mockedExecute.mock.calls[0]!;
      // last_offline should be set to a date (the 8th parameter)
      expect(playerCall[1]![7]).toBeInstanceOf(Date);
    });

    it('should set character names as 棋子1, 棋子2, 棋子3', async () => {
      mockedExecute.mockResolvedValue(1);

      await playerService.initializePlayer(userId);

      const characterCalls = mockedExecute.mock.calls.slice(1);

      expect(characterCalls[0]![1]![2]).toBe('棋子1');
      expect(characterCalls[1]![1]![2]).toBe('棋子2');
      expect(characterCalls[2]![1]![2]).toBe('棋子3');
    });

    it('should set all characters as alive', async () => {
      mockedExecute.mockResolvedValue(1);

      await playerService.initializePlayer(userId);

      const characterCalls = mockedExecute.mock.calls.slice(1);

      // is_alive is the 12th parameter (index 11)
      expect(characterCalls[0]![1]![11]).toBe(true);
      expect(characterCalls[1]![1]![11]).toBe(true);
      expect(characterCalls[2]![1]![11]).toBe(true);
    });
  });

  describe('getPlayerIdByUserId', () => {
    it('should return player id when player exists', async () => {
      mockedQuery.mockResolvedValue([{ id: 'player-123' }] as any);

      const result = await playerService.getPlayerIdByUserId('user-123');

      expect(result).toBe('player-123');
    });

    it('should return null when player does not exist', async () => {
      mockedQuery.mockResolvedValue([]);

      const result = await playerService.getPlayerIdByUserId('nonexistent-user');

      expect(result).toBeNull();
    });
  });

  describe('getPlayerProfile', () => {
    const userId = 'user-123';
    const playerId = 'player-456';

    it('should return player profile with all required fields', async () => {
      mockedQuery
        .mockResolvedValueOnce([
          {
            id: playerId,
            user_id: userId,
            username: 'testuser',
            resources: { iron_ore: 10, coal: 5 },
            materials: { iron_ingot: 3 },
            production_gear: { pickaxe: { bonus: 0.5 } },
            warehouse_limits: { resource: 1000, material: 500 },
            idle_queue: [],
            last_offline: new Date('2026-01-01'),
          },
        ] as any)
        .mockResolvedValueOnce([
          {
            id: 'char-1',
            name: '棋子1',
            profession: 'warrior',
            health: 20,
            max_health: 20,
            movement: 2,
            energy: 3,
            max_energy: 3,
            position_x: null,
            position_y: null,
            is_alive: true,
          },
          {
            id: 'char-2',
            name: '棋子2',
            profession: 'ranger',
            health: 15,
            max_health: 15,
            movement: 3,
            energy: 3,
            max_energy: 3,
            position_x: null,
            position_y: null,
            is_alive: true,
          },
          {
            id: 'char-3',
            name: '棋子3',
            profession: 'mage',
            health: 12,
            max_health: 12,
            movement: 2,
            energy: 3,
            max_energy: 3,
            position_x: null,
            position_y: null,
            is_alive: true,
          },
        ] as any);

      const result = await playerService.getPlayerProfile(userId);

      expect(result).not.toBeNull();
      expect(result!.id).toBe(playerId);
      expect(result!.user_id).toBe(userId);
      expect(result!.username).toBe('testuser');
      expect(result!.resources).toEqual({ iron_ore: 10, coal: 5 });
      expect(result!.materials).toEqual({ iron_ingot: 3 });
      expect(result!.production_gear).toEqual({ pickaxe: { bonus: 0.5 } });
      expect(result!.warehouse_limits).toEqual({ resource: 1000, material: 500 });
      expect(result!.characters).toHaveLength(3);
      expect(result!.characters[0].profession).toBe('warrior');
      expect(result!.characters[1].profession).toBe('ranger');
      expect(result!.characters[2].profession).toBe('mage');
    });

    it('should return null when player does not exist', async () => {
      mockedQuery.mockResolvedValueOnce([]);

      const result = await playerService.getPlayerProfile('nonexistent-user');

      expect(result).toBeNull();
    });

    it('should return empty characters array when player has no characters', async () => {
      mockedQuery
        .mockResolvedValueOnce([
          {
            id: playerId,
            user_id: userId,
            username: 'testuser',
            resources: {},
            materials: {},
            production_gear: {},
            warehouse_limits: {},
            idle_queue: [],
            last_offline: null,
          },
        ] as any)
        .mockResolvedValueOnce([]);

      const result = await playerService.getPlayerProfile(userId);

      expect(result).not.toBeNull();
      expect(result!.characters).toHaveLength(0);
    });
  });
});
