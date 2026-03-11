// Unit tests for authService
import * as authService from '../services/authService';
import { query, execute } from '../config/database';

// Mock the database module
jest.mock('../config/database', () => ({
  query: jest.fn(),
  execute: jest.fn()
}));

// Mock bcryptjs
jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('hashed_password')
}));

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
});
