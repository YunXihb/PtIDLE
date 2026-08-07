// Integration tests for auth API
import request from 'supertest';
import express from 'express';
import authRoutes from '../routes/auth';
import { query, execute, withTransaction } from '../config/database';
import { errorHandler } from '../middleware/errorHandler';

// Create test app
const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use(errorHandler);

// Mock the database module
jest.mock('../config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  withTransaction: jest.fn()
}));

// Mock bcryptjs
jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('hashed_password'),
  compare: jest.fn().mockResolvedValue(true)
}));

// Mock jsonwebtoken
jest.mock('jsonwebtoken', () => ({
  sign: jest.fn().mockReturnValue('mock_token')
}));

const mockedQuery = query as jest.MockedFunction<typeof query>;
const mockedExecute = execute as jest.MockedFunction<typeof execute>;
const mockedWithTransaction = withTransaction as jest.MockedFunction<typeof withTransaction>;

describe('Auth API Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedQuery.mockReset();
    mockedExecute.mockReset();
    // 默认 withTransaction：以 mock client 调用 fn（register 的 existence/INSERT/init 走 client.query）
    mockedWithTransaction.mockReset();
    mockedWithTransaction.mockImplementation(async (fn: any) => {
      const client = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
      return fn(client);
    });
    process.env.JWT_SECRET = 'test_secret';
    process.env.JWT_EXPIRES_IN = '7d';
  });

  describe('POST /api/auth/register', () => {
    const validRegisterInput = {
      username: 'newuser',
      password: 'password123'
    };

    it('should register a new user and create player data', async () => {
      let capturedClient: any;
      mockedWithTransaction.mockImplementation(async (fn: any) => {
        capturedClient = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
        return fn(capturedClient);
      });

      const response = await request(app)
        .post('/api/auth/register')
        .send(validRegisterInput);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.username).toBe(validRegisterInput.username);

      // existence check + INSERT user + initializePlayer(1 player + 3 chars) = 6 client.query
      expect(capturedClient.query).toHaveBeenCalledTimes(6);
    });

    it('should return 400 for missing username', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({ password: 'password123' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Username is required');
    });

    it('should return 400 for missing password', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({ username: 'testuser' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Password must be at least 6 characters');
    });

    it('should return 400 for short password', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({ username: 'testuser', password: '12345' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Password must be at least 6 characters');
    });

    it('should return 400 for empty username', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({ username: '', password: 'password123' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Username is required');
    });

    it('should return 400 for existing username', async () => {
      // existence check 在事务内走 client.query，返回已存在用户
      mockedWithTransaction.mockImplementation(async (fn: any) => {
        const client = {
          query: jest.fn().mockResolvedValueOnce({ rows: [{ id: 'existing-user-id' }] }),
        };
        return fn(client);
      });

      const response = await request(app)
        .post('/api/auth/register')
        .send(validRegisterInput);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('already exists');
    });

    it('should trim whitespace from username', async () => {
      let capturedClient: any;
      mockedWithTransaction.mockImplementation(async (fn: any) => {
        capturedClient = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
        return fn(capturedClient);
      });

      await request(app)
        .post('/api/auth/register')
        .send({ username: '  newuser  ', password: 'password123' });

      // existence check 是 client.query 第 1 次调用，参数 [0] 为 username（已 trim）
      const queryCall = capturedClient.query.mock.calls[0]!;
      expect(queryCall[1]![0]).toBe('newuser');
    });
  });

  describe('POST /api/auth/login', () => {
    const mockUser = {
      id: 'user-123',
      username: 'testuser',
      password_hash: 'hashed_password',
      created_at: new Date('2026-01-01'),
      last_login: null
    };

    it('should login successfully with correct credentials', async () => {
      // Use mockReturnValueOnce to return user on first call
      mockedQuery
        .mockReturnValueOnce(Promise.resolve([{
          id: 'user-123',
          username: 'testuser',
          password_hash: 'hashed_password',
          created_at: new Date('2026-01-01'),
          last_login: null
        }] as any))
        .mockReturnValue(Promise.resolve([]));
      mockedExecute.mockResolvedValue(1);

      const response = await request(app)
        .post('/api/auth/login')
        .send({ username: 'testuser', password: 'password123' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data!.token).toBeDefined();
      expect(response.body.data!.user.username).toBe('testuser');
    });

    it('should return 400 for missing username', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({ password: 'password123' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Username is required');
    });

    it('should return 400 for missing password', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({ username: 'testuser' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Password is required');
    });

    it('should return 401 for non-existent user', async () => {
      mockedQuery.mockResolvedValue([]);

      const response = await request(app)
        .post('/api/auth/login')
        .send({ username: 'nonexistent', password: 'password123' });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Invalid username or password');
    });

    it('should return 401 for wrong password', async () => {
      mockedQuery.mockResolvedValue([mockUser] as any);
      const bcrypt = require('bcryptjs');
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);

      const response = await request(app)
        .post('/api/auth/login')
        .send({ username: 'testuser', password: 'wrongpassword' });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Invalid username or password');
    });

    it('should update last_login on successful login', async () => {
      mockedQuery.mockResolvedValue([mockUser] as any);
      mockedExecute.mockResolvedValue(1);

      await request(app)
        .post('/api/auth/login')
        .send({ username: 'testuser', password: 'password123' });

      expect(mockedExecute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users'),
        expect.any(Array)
      );
    });

    it('should trim whitespace from username', async () => {
      mockedQuery.mockResolvedValue([mockUser] as any);
      mockedExecute.mockResolvedValue(1);

      await request(app)
        .post('/api/auth/login')
        .send({ username: '  testuser  ', password: 'password123' });

      const queryCall = mockedQuery.mock.calls[0]!;
      expect(queryCall[1]![0]).toBe('testuser');
    });
  });
});
