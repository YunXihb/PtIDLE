// Unit tests for authService
import * as authService from '../services/authService';
import { query, execute, withTransaction } from '../config/database';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// Mock the database module
jest.mock('../config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  withTransaction: jest.fn()
}));

// Mock bcryptjs
jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('hashed_password'),
  compare: jest.fn()
}));

// Mock jwt
jest.mock('jsonwebtoken', () => ({
  sign: jest.fn().mockReturnValue('mock_token')
}));

// Mock process.env
const originalEnv = process.env;
beforeEach(() => {
  jest.resetModules();
  process.env = { ...originalEnv, JWT_SECRET: 'test_secret', JWT_EXPIRES_IN: '7d' };
});

afterAll(() => {
  process.env = originalEnv;
});

const mockedQuery = query as jest.MockedFunction<typeof query>;
const mockedExecute = execute as jest.MockedFunction<typeof execute>;
const mockedWithTransaction = withTransaction as jest.MockedFunction<typeof withTransaction>;

describe('authService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // 默认 withTransaction：以 mock client 调用 fn（client.query 返回空结果集 + rowCount 1）
    // createUser 的 existence check / INSERT user / initializePlayer 写入均走此 client
    mockedWithTransaction.mockImplementation(async (fn: any) => {
      const client = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
      return fn(client);
    });
  });

  describe('createUser', () => {
    const validInput = {
      username: 'testuser',
      password: 'password123'
    };

    it('should create a user successfully', async () => {
      let capturedClient: any;
      mockedWithTransaction.mockImplementation(async (fn: any) => {
        capturedClient = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
        return fn(capturedClient);
      });

      const result = await authService.createUser(validInput);

      expect(result.username).toBe(validInput.username);
      expect(result.id).toBeDefined();
      // 写入包在 withTransaction 内（原子化）
      expect(mockedWithTransaction).toHaveBeenCalledTimes(1);
      // existence check + INSERT user + initializePlayer(1 player + 3 chars) = 6 client.query
      expect(capturedClient.query).toHaveBeenCalledTimes(6);
    });

    it('should throw InvalidInputError when username is empty', async () => {
      await expect(
        authService.createUser({ username: '', password: 'password123' })
      ).rejects.toThrow(authService.InvalidInputError);
    });

    it('should throw InvalidInputError when username is whitespace only', async () => {
      await expect(
        authService.createUser({ username: '   ', password: 'password123' })
      ).rejects.toThrow(authService.InvalidInputError);
    });

    it('should throw InvalidInputError when password is less than 6 characters', async () => {
      await expect(
        authService.createUser({ username: 'testuser', password: '12345' })
      ).rejects.toThrow(authService.InvalidInputError);
    });

    it('should throw UserAlreadyExistsError when username already exists', async () => {
      // existence check 在事务内走 client.query，返回已存在用户
      mockedWithTransaction.mockImplementation(async (fn: any) => {
        const client = {
          query: jest.fn().mockResolvedValueOnce({ rows: [{ id: 'existing-user-id' }] }),
        };
        return fn(client);
      });

      await expect(authService.createUser(validInput)).rejects.toThrow(
        authService.UserAlreadyExistsError
      );
    });

    it('should trim whitespace from username', async () => {
      let capturedClient: any;
      mockedWithTransaction.mockImplementation(async (fn: any) => {
        capturedClient = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
        return fn(capturedClient);
      });

      await authService.createUser({ username: '  testuser  ', password: 'password123' });

      // INSERT user 是 client.query 第 2 次调用（第 1 次是 existence check）
      const insertCall = capturedClient.query.mock.calls[1];
      expect(insertCall?.[1]?.[1]).toBe('testuser'); // username 已 trim
    });

    it('should rollback (propagate error) when initializePlayer fails, leaving no orphan user', async () => {
      // 模拟 initializePlayer 写首个棋子时失败：user 已 INSERT 但事务应整体回滚
      let capturedClient: any;
      mockedWithTransaction.mockImplementation(async (fn: any) => {
        capturedClient = {
          query: jest.fn()
            .mockResolvedValueOnce({ rows: [] })        // existence: 无已存在用户
            .mockResolvedValueOnce({ rowCount: 1 })      // INSERT user 成功
            .mockResolvedValueOnce({ rowCount: 1 })      // initializePlayer: INSERT players 成功
            .mockRejectedValueOnce(new Error('characters insert failed')), // 首个棋子失败
        };
        return fn(capturedClient);
      });

      // 事务 fn 抛错 -> createUser reject（真实 withTransaction 会 ROLLBACK，无孤立 user）
      await expect(authService.createUser(validInput)).rejects.toThrow('characters insert failed');

      // existence + INSERT user + INSERT players + 失败的棋子 = 4 次 client.query
      expect(capturedClient.query).toHaveBeenCalledTimes(4);
    });
  });

  describe('login', () => {
    const mockUser = {
      id: 'user-123',
      username: 'testuser',
      password_hash: 'hashed_password',
      created_at: new Date('2026-01-01'),
      last_login: null
    };

    it('should login successfully with correct credentials', async () => {
      mockedQuery.mockResolvedValue([mockUser] as any);
      mockedExecute.mockResolvedValue(1);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await authService.login('testuser', 'password123');

      expect(result.token).toBe('mock_token');
      expect(result.user.username).toBe('testuser');
      expect(mockedExecute).toHaveBeenCalled();
    });

    it('should throw InvalidInputError when username is empty', async () => {
      await expect(
        authService.login('', 'password123')
      ).rejects.toThrow(authService.InvalidInputError);
    });

    it('should throw InvalidInputError when password is empty', async () => {
      await expect(
        authService.login('testuser', '')
      ).rejects.toThrow(authService.InvalidInputError);
    });

    it('should throw InvalidCredentialsError when user not found', async () => {
      mockedQuery.mockResolvedValue([]);

      await expect(
        authService.login('nonexistent', 'password123')
      ).rejects.toThrow(authService.InvalidCredentialsError);
    });

    it('should throw InvalidCredentialsError when password is wrong', async () => {
      mockedQuery.mockResolvedValue([mockUser] as any);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        authService.login('testuser', 'wrongpassword')
      ).rejects.toThrow(authService.InvalidCredentialsError);
    });

    it('should trim whitespace from username', async () => {
      mockedQuery.mockResolvedValue([mockUser] as any);
      mockedExecute.mockResolvedValue(1);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await authService.login('  testuser  ', 'password123');

      const queryCall = mockedQuery.mock.calls[0];
      expect(queryCall?.[1]?.[0]).toBe('testuser');
    });

    it('should update last_login on successful login', async () => {
      mockedQuery.mockResolvedValue([mockUser] as any);
      mockedExecute.mockResolvedValue(1);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await authService.login('testuser', 'password123');

      expect(mockedExecute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users'),
        expect.any(Array)
      );
    });
  });
});
