// Integration tests for character deck assignment (PUT /:id/deck)
// T039: profession mismatch handling

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import characterRoutes from './characters';
import * as characterService from '../services/characterService';
import { errorHandler } from '../middleware/errorHandler';

jest.mock('../services/characterService');

const mockedAssignCardToCharacter =
  characterService.assignCardToCharacter as jest.MockedFunction<
    typeof characterService.assignCardToCharacter
  >;

const app = express();
app.use(express.json());
app.use('/api/characters', characterRoutes);
app.use(errorHandler);

describe('Characters Deck API Integration Tests (T039)', () => {
  const testUserId = 'test-user-id';
  const testUsername = 'testuser';
  const jwtSecret = process.env.JWT_SECRET || 'your_jwt_secret_change_in_production';
  const validToken = jwt.sign({ userId: testUserId, username: testUsername }, jwtSecret);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('PUT /api/characters/:id/deck (assign action)', () => {
    it('should return 200 on successful assignment', async () => {
      mockedAssignCardToCharacter.mockResolvedValue({
        success: true,
        character_deck_id: 'deck-1',
      });

      const response = await request(app)
        .put('/api/characters/char-1/deck')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ cardId: 'card-1', action: 'assign' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.character_deck_id).toBe('deck-1');
    });

    it('should return 400 with profession error when card profession mismatches', async () => {
      mockedAssignCardToCharacter.mockResolvedValue({
        success: false,
        error: "Character profession 'warrior' cannot use card profession 'mage'",
      });

      const response = await request(app)
        .put('/api/characters/char-1/deck')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ cardId: 'card-1', action: 'assign' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('profession');
    });

    it('should return 404 when character not found', async () => {
      mockedAssignCardToCharacter.mockResolvedValue({
        success: false,
        error: 'Character not found',
      });

      const response = await request(app)
        .put('/api/characters/nonexistent/deck')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ cardId: 'card-1', action: 'assign' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Character not found');
    });

    it('should return 404 when card not found', async () => {
      mockedAssignCardToCharacter.mockResolvedValue({
        success: false,
        error: 'Card not found',
      });

      const response = await request(app)
        .put('/api/characters/char-1/deck')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ cardId: 'nonexistent', action: 'assign' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Card not found');
    });

    it('should return 401 when no token', async () => {
      const response = await request(app)
        .put('/api/characters/char-1/deck')
        .send({ cardId: 'card-1', action: 'assign' });

      expect(response.status).toBe(401);
    });
  });
});
