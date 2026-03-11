// Integration tests for auth API
import request from 'supertest';
import express from 'express';
import authRoutes from '../routes/auth';

// Create test app
const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);

describe('Auth API Integration Tests', () => {
  const testUsername = `testuser_${Date.now()}`;
  const testPassword = 'password123';

  describe('POST /api/auth/register', () => {
    it('should register a new user successfully', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          username: testUsername,
          password: testPassword
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data.username).toBe(testUsername);
      expect(response.body.data).not.toHaveProperty('password_hash');
    });

    it('should return 400 when username already exists', async () => {
      // First create user
      await request(app)
        .post('/api/auth/register')
        .send({
          username: testUsername,
          password: testPassword
        });

      // Try to create duplicate
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          username: testUsername,
          password: 'different_password'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('already exists');
    });

    it('should return 400 when username is empty', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          username: '',
          password: testPassword
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should return 400 when password is too short', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'newuser',
          password: '12345'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('at least 6 characters');
    });

    it('should return 400 when username is missing', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          password: testPassword
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should return 400 when password is missing', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'newuser'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should return 400 when request body is empty', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });
});
