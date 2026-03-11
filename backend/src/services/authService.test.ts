// Unit tests for authService
import * as authService from '../services/authService';
import { query, execute } from '../config/database';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// Mock the database module
jest.mock('../config/database', () => ({
  query: jest.fn(),
  execute: jest.fn()
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

describe('authService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createUser', () => {
    const validInput = {
      username: 'testuser',
      password: 'password123'
    };

    it('should create a user successfully', async () => {
      // Setup mocks
      mockedQuery.mockResolvedValue([]); // No existing user
      mockedExecute.mockResolvedValue(1);

      const result = await authService.createUser(validInput);

      expect(result.username).toBe(validInput.username);
      expect(result.id).toBeDefined();
      expect(mockedExecute).toHaveBeenCalled();
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
      mockedQuery.mockResolvedValue([{ id: 'existing-user-id' }] as any);

      await expect(authService.createUser(validInput)).rejects.toThrow(
        authService.UserAlreadyExistsError
      );
    });

    it('should trim whitespace from username', async () => {
      mockedQuery.mockResolvedValue([]);
      mockedExecute.mockResolvedValue(1);

      await authService.createUser({ username: '  testuser  ', password: 'password123' });

      const executeCall = mockedExecute.mock.calls[0];
      expect(executeCall?.[1]?.[1]).toBe('testuser');
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
