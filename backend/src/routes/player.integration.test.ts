// Integration tests for player API with auth middleware
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import playerRoutes from '../routes/player';

const app = express();
app.use(express.json());
app.use('/api/player', playerRoutes);

describe('Player API Integration Tests', () => {
  const testUserId = 'test-user-id';
  const testUsername = 'testuser';
  const testPassword = 'password123';
  const jwtSecret = process.env.JWT_SECRET || 'your_jwt_secret_change_in_production';

  // Generate a valid token for testing
  const validToken = jwt.sign({ userId: testUserId, username: testUsername }, jwtSecret);

  describe('GET /api/player/profile', () => {
    it('should return 401 when no token provided', async () => {
      const response = await request(app)
        .get('/api/player/profile');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('No token provided');
    });

    it('should return 401 when token does not start with Bearer', async () => {
      const response = await request(app)
        .get('/api/player/profile')
        .set('Authorization', validToken);

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('No token provided');
    });

    it('should return 401 for invalid token', async () => {
      const response = await request(app)
        .get('/api/player/profile')
        .set('Authorization', 'Bearer invalid_token');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Invalid token');
    });

    it('should return 401 for malformed authorization header', async () => {
      const response = await request(app)
        .get('/api/player/profile')
        .set('Authorization', 'Basic some_token');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('No token provided');
    });

    it('should return 200 and user info for valid token', async () => {
      const response = await request(app)
        .get('/api/player/profile')
        .set('Authorization', `Bearer ${validToken}`);

      expect(response.status).toBe(200);
      expect(response.body.userId).toBe(testUserId);
      expect(response.body.username).toBe(testUsername);
      expect(response.body.message).toBe('This is a protected route');
    });

    it('should return 401 for expired token', async () => {
      // Generate an expired token (expires in -1 second)
      const expiredToken = jwt.sign(
        { userId: testUserId, username: testUsername },
        jwtSecret,
        { expiresIn: '-1s' }
      );

      const response = await request(app)
        .get('/api/player/profile')
        .set('Authorization', `Bearer ${expiredToken}`);

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Invalid token');
    });
  });
});
