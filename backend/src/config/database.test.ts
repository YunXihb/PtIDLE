// T053 事务 helper 测试
// Mock pg.Pool 以避免真实 DB 连接

jest.mock('pg', () => {
  const mockClient = {
    query: jest.fn(),
    release: jest.fn(),
  };
  const mockPool = {
    connect: jest.fn().mockResolvedValue(mockClient),
    on: jest.fn(),
  };
  return { Pool: jest.fn(() => mockPool), __mockClient: mockClient };
});

// 必须用 require 拉 database.ts（jest.mock 在 import 之前被 hoisted）
const { pool, withTransaction, query } = require('./database');
const pg = require('pg');
const mockClient = pg.__mockClient;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('withTransaction — happy path', () => {
  it('commits when fn resolves', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await withTransaction(fn);
    expect(result).toBe('ok');
    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it('passes the same client to fn for multiple queries', async () => {
    const fn = jest.fn(async (client) => {
      await client.query('DELETE FROM character_deck WHERE id = $1', ['d1']);
      await client.query('DELETE FROM player_cards WHERE id = $1', ['c1']);
      return 2;
    });
    await withTransaction(fn);
    // fn 被调一次，传入 client
    expect(fn).toHaveBeenCalledWith(mockClient);
    // BEGIN → DELETE 1 → DELETE 2 → COMMIT
    expect(mockClient.query.mock.calls[0][0]).toBe('BEGIN');
    expect(mockClient.query.mock.calls[1][0]).toBe('DELETE FROM character_deck WHERE id = $1');
    expect(mockClient.query.mock.calls[2][0]).toBe('DELETE FROM player_cards WHERE id = $1');
    expect(mockClient.query.mock.calls[3][0]).toBe('COMMIT');
  });
});

describe('withTransaction — rollback on throw', () => {
  it('rolls back and rethrows when fn throws', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('DB error'));
    await expect(withTransaction(fn)).rejects.toThrow('DB error');
    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.query).not.toHaveBeenCalledWith('COMMIT');
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it('still releases client when ROLLBACK itself throws (defensive)', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })            // BEGIN
      .mockRejectedValueOnce(new Error('fn error'))   // fn 内 DELETE
      .mockRejectedValueOnce(new Error('rollback fail'));  // ROLLBACK
    const fn = jest.fn(async (c) => c.query('DELETE FROM x'));
    await expect(withTransaction(fn)).rejects.toThrow('fn error');
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });
});