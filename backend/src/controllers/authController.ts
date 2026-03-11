import { Request, Response, NextFunction } from 'express';
import { createUser, UserAlreadyExistsError, InvalidInputError } from '../services/authService';

export async function register(req: Request, res: Response, next: NextFunction) {
  try {
    const { username, password } = req.body;

    const user = await createUser({ username, password });

    res.status(201).json({
      success: true,
      data: user
    });
  } catch (error) {
    if (error instanceof UserAlreadyExistsError) {
      res.status(400).json({
        success: false,
        error: error.message
      });
      return;
    }

    if (error instanceof InvalidInputError) {
      res.status(400).json({
        success: false,
        error: error.message
      });
      return;
    }

    next(error);
  }
}
