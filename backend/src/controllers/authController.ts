import { Request, Response, NextFunction } from 'express';
import { createUser, login, UserAlreadyExistsError, InvalidInputError, InvalidCredentialsError } from '../services/authService';

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

export async function handleLogin(req: Request, res: Response, next: NextFunction) {
  try {
    const { username, password } = req.body;

    const result = await login(username, password);

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    if (error instanceof InvalidCredentialsError) {
      res.status(401).json({
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
