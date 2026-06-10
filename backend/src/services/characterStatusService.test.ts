// Unit tests for characterStatusService

const mockRedisClient = {
  hGet: jest.fn(),
  hGetAll: jest.fn(),
  lRange: jest.fn(),
};

const mockQuery = jest.fn();

jest.mock('../config/redis', () => ({
  redisClient: mockRedisClient,
}));

jest.mock('../config/database', () => ({
  query: mockQuery,
}));

import { getCharacterStatus } from './characterStatusService';

describe('characterStatusService', () => {
  const battleId = 'battle-1';
  const charId = 'char-1';

  const mockPiece = {
    name: 'Warrior1',
    profession: 'warrior',
    health: 18,
    max_health: 20,
    energy: 2,
    max_energy: 3,
    is_alive: true,
    player_id: 'p-1',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // 默认 Redis 没有 piece，从 DB 查
    mockRedisClient.hGet.mockResolvedValue(null);
    // 默认 board 为空
    mockRedisClient.hGetAll.mockResolvedValue({});
    // 默认无 effects
    mockRedisClient.lRange.mockResolvedValue([]);
    // 默认 DB 返回 warrior piece
    mockQuery.mockResolvedValue([mockPiece]);
  });

  it('should aggregate base properties from DB when Redis piece missing', async () => {
    const status = await getCharacterStatus(battleId, charId, 1);
    expect(status).not.toBeNull();
    expect(status!.name).toBe('Warrior1');
    expect(status!.profession).toBe('warrior');
    expect(status!.health).toBe(18);
    expect(status!.maxHealth).toBe(20);
    expect(status!.energy).toBe(2);
    expect(status!.maxEnergy).toBe(3);
    expect(status!.isAlive).toBe(true);
  });

  it('should return null when character not found in Redis or DB', async () => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue([]);
    const status = await getCharacterStatus(battleId, charId, 1);
    expect(status).toBeNull();
  });

  it('should return null when DB row has invalid profession', async () => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue([{ ...mockPiece, profession: 'common' }]);
    const status = await getCharacterStatus(battleId, charId, 1);
    expect(status).toBeNull();
  });

  it('should return position when character on board', async () => {
    mockRedisClient.hGetAll.mockResolvedValue({ '3,4': charId });
    const status = await getCharacterStatus(battleId, charId, 1);
    expect(status!.position).toEqual({ x: 3, y: 4 });
  });

  it('should return null position when not on board', async () => {
    mockRedisClient.hGetAll.mockResolvedValue({});
    const status = await getCharacterStatus(battleId, charId, 1);
    expect(status!.position).toBeNull();
  });

  it('should use Redis piece when available', async () => {
    mockRedisClient.hGet.mockResolvedValue(JSON.stringify(mockPiece));
    const status = await getCharacterStatus(battleId, charId, 1);
    expect(status!.name).toBe('Warrior1');
    // DB 不应被查询
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('should fall back to DB on corrupted Redis JSON', async () => {
    mockRedisClient.hGet.mockResolvedValue('not-json');
    const status = await getCharacterStatus(battleId, charId, 1);
    expect(status).not.toBeNull();
    expect(mockQuery).toHaveBeenCalled();
  });
});
