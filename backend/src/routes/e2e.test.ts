// End-to-End tests for user registration and player initialization flow
import request from 'supertest';
import express from 'express';
import authRoutes from '../routes/auth';
import playerRoutes from '../routes/player';
import { query, execute } from '../config/database';

// Create test app
const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/player', playerRoutes);

// Mock the database module
jest.mock('../config/database', () => ({
  query: jest.fn(),
  execute: jest.fn()
}));

// Mock bcryptjs
jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('hashed_password'),
  compare: jest.fn().mockResolvedValue(true)
}));

// Mock jsonwebtoken
jest.mock('jsonwebtoken', () => ({
  sign: jest.fn().mockImplementation((payload: any, _secret: string, _options: any) => {
    return `token_for_${payload.username || payload.userId}`;
  })
}));

const mockedQuery = query as jest.MockedFunction<typeof query>;
const mockedExecute = execute as jest.MockedFunction<typeof execute>;

describe('E2E: User Registration and Player Initialization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedQuery.mockReset();
    mockedExecute.mockReset();
    process.env.JWT_SECRET = 'test_secret';
    process.env.JWT_EXPIRES_IN = '7d';
  });

  it('should complete full user flow: register -> login -> get player info', async () => {
    const username = 'e2euser';
    const password = 'password123';

    // Step 1: Register new user
    mockedQuery
      .mockReturnValueOnce(Promise.resolve([])) // No existing user
      .mockReturnValueOnce(Promise.resolve([{ id: 'player-123' }])); // Player created
    mockedExecute.mockResolvedValue(1);

    const registerResponse = await request(app)
      .post('/api/auth/register')
      .send({ username, password });

    expect(registerResponse.status).toBe(201);
    expect(registerResponse.body.success).toBe(true);
    expect(registerResponse.body.data.username).toBe(username);

    // Verify player initialization was called (execute called 5 times: 1 user + 1 player + 3 characters)
    expect(mockedExecute).toHaveBeenCalledTimes(5);

    // Step 2: Login with registered user
    mockedQuery
      .mockReturnValueOnce(Promise.resolve([{
        id: 'user-123',
        username: 'e2euser',
        password_hash: 'hashed_password',
        created_at: new Date(),
        last_login: null
      }] as any))
      .mockReturnValue(Promise.resolve([]));
    mockedExecute.mockResolvedValue(1);

    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({ username, password });

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.success).toBe(true);
    expect(loginResponse.body.data.token).toBeDefined();
  });

  it('should create player with 3 characters on registration', async () => {
    mockedQuery
      .mockReturnValueOnce(Promise.resolve([]))
      .mockReturnValueOnce(Promise.resolve([{ id: 'player-new' }]));
    mockedExecute.mockResolvedValue(1);

    await request(app)
      .post('/api/auth/register')
      .send({ username: 'newplayer', password: 'password123' });

    // Verify execute was called 5 times (1 user + 1 player + 3 characters)
    const executeCalls = mockedExecute.mock.calls;
    expect(executeCalls.length).toBe(5);

    // Verify character insert calls
    const characterCalls = executeCalls.slice(2) as Array<[string, any[]]>; // Skip user and player inserts

    // Check that 3 character inserts were made
    expect(characterCalls.length).toBe(3);

    // Verify professions: warrior, ranger, mage
    const professions = characterCalls.map(call => call[1][3]); // profession is 4th parameter
    expect(professions).toContain('warrior');
    expect(professions).toContain('ranger');
    expect(professions).toContain('mage');
  });

  it('should initialize player with correct resources', async () => {
    mockedQuery
      .mockReturnValueOnce(Promise.resolve([]))
      .mockReturnValueOnce(Promise.resolve([{ id: 'player-res' }]));
    mockedExecute.mockResolvedValue(1);

    await request(app)
      .post('/api/auth/register')
      .send({ username: 'resourceuser', password: 'password123' });

    // Get the player insert call
    const playerCall = mockedExecute.mock.calls[1]!;

    // Verify resources
    const resources = JSON.parse(playerCall[1]![2]!);
    expect(resources).toEqual({
      iron_ore: 0,
      coal: 0,
      wood: 0,
      sap: 0,
      herb: 0,
      mushroom: 0
    });

    // Verify materials
    const materials = JSON.parse(playerCall[1]![3]!);
    expect(materials).toEqual({
      iron_ingot: 0,
      plank: 0,
      herb_powder: 0
    });
  });

  it('should create characters with correct initial stats', async () => {
    mockedQuery
      .mockReturnValueOnce(Promise.resolve([]))
      .mockReturnValueOnce(Promise.resolve([{ id: 'player-stats' }]));
    mockedExecute.mockResolvedValue(1);

    await request(app)
      .post('/api/auth/register')
      .send({ username: 'statsuser', password: 'password123' });

    // Get character insert calls
    const characterCalls = mockedExecute.mock.calls.slice(2);

    // Warrior: HP=20, Movement=2, Energy=3
    const warriorStats = characterCalls[0]![1]!;
    expect(warriorStats[4]).toBe(20); // health
    expect(warriorStats[6]).toBe(2); // movement
    expect(warriorStats[8]).toBe(3); // max_energy

    // Ranger: HP=15, Movement=3, Energy=3
    const rangerStats = characterCalls[1]![1]!;
    expect(rangerStats[4]).toBe(15); // health
    expect(rangerStats[6]).toBe(3); // movement
    expect(rangerStats[8]).toBe(3); // max_energy

    // Mage: HP=12, Movement=2, Energy=3
    const mageStats = characterCalls[2]![1]!;
    expect(mageStats[4]).toBe(12); // health
    expect(mageStats[6]).toBe(2); // movement
    expect(mageStats[8]).toBe(3); // max_energy
  });

  it('should prevent registration with duplicate username', async () => {
    // First registration succeeds
    mockedQuery
      .mockReturnValueOnce(Promise.resolve([]))
      .mockReturnValueOnce(Promise.resolve([{ id: 'player-1' }]));
    mockedExecute.mockResolvedValue(1);

    await request(app)
      .post('/api/auth/register')
      .send({ username: 'duplicate', password: 'password123' });

    // Second registration with same username should fail
    mockedQuery.mockResolvedValue([{ id: 'existing-id' }] as any);

    const response = await request(app)
      .post('/api/auth/register')
      .send({ username: 'duplicate', password: 'password123' });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('already exists');
  });

  it('should fail login with wrong password', async () => {
    // Setup user exists
    mockedQuery.mockResolvedValue([{
      id: 'user-123',
      username: 'testuser',
      password_hash: 'hashed_password',
      created_at: new Date(),
      last_login: null
    }] as any);

    // Mock bcrypt compare to return false (wrong password)
    const bcrypt = require('bcryptjs');
    (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);

    const response = await request(app)
      .post('/api/auth/login')
      .send({ username: 'testuser', password: 'wrongpassword' });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Invalid username or password');
  });
});
