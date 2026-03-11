import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { authMiddleware, AuthRequest } from './auth';

describe('authMiddleware', () => {
  let mockRequest: Partial<AuthRequest>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction;

  beforeEach(() => {
    mockRequest = {
      headers: {}
    };
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    nextFunction = jest.fn();
  });

  it('should return 401 if no token provided', () => {
    authMiddleware(
      mockRequest as AuthRequest,
      mockResponse as Response,
      nextFunction
    );

    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(mockResponse.json).toHaveBeenCalledWith({ error: 'No token provided' });
    expect(nextFunction).not.toHaveBeenCalled();
  });

  it('should return 401 if token does not start with Bearer', () => {
    mockRequest.headers = {
      authorization: 'SomeToken123'
    };

    authMiddleware(
      mockRequest as AuthRequest,
      mockResponse as Response,
      nextFunction
    );

    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(mockResponse.json).toHaveBeenCalledWith({ error: 'No token provided' });
    expect(nextFunction).not.toHaveBeenCalled();
  });

  it('should return 401 for invalid token', () => {
    mockRequest.headers = {
      authorization: 'Bearer invalidtoken'
    };

    authMiddleware(
      mockRequest as AuthRequest,
      mockResponse as Response,
      nextFunction
    );

    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(mockResponse.json).toHaveBeenCalledWith({ error: 'Invalid token' });
    expect(nextFunction).not.toHaveBeenCalled();
  });

  it('should allow request for valid token and attach user info', () => {
    const userId = 'test-user-id';
    const username = 'testuser';
    const token = jwt.sign(
      { userId, username },
      process.env.JWT_SECRET || 'your_jwt_secret_change_in_production'
    );

    mockRequest.headers = {
      authorization: `Bearer ${token}`
    };

    authMiddleware(
      mockRequest as AuthRequest,
      mockResponse as Response,
      nextFunction
    );

    expect(nextFunction).toHaveBeenCalled();
    expect(mockRequest.user).toEqual({
      userId,
      username
    });
    expect(mockResponse.status).not.toHaveBeenCalled();
  });
});
