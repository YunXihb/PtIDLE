import { Request, Response, NextFunction } from 'express';
import { createUser, login, UserAlreadyExistsError, InvalidInputError, InvalidCredentialsError } from '../services/authService';
import { ok, fail } from '../utils/http';

export async function register(req: Request, res: Response, next: NextFunction) {
  try {
    const { username, password } = req.body;

    const user = await createUser({ username, password });

    ok(res, user, 201);
  } catch (error) {
    if (error instanceof UserAlreadyExistsError) {
      fail(res, 400, error.message);
      return;
    }

    if (error instanceof InvalidInputError) {
      fail(res, 400, error.message);
      return;
    }

    next(error);
  }
}

export async function handleLogin(req: Request, res: Response, next: NextFunction) {
  try {
    const { username, password } = req.body;

    const result = await login(username, password);

    ok(res, result);
  } catch (error) {
    if (error instanceof InvalidCredentialsError) {
      fail(res, 401, error.message);
      return;
    }

    if (error instanceof InvalidInputError) {
      fail(res, 400, error.message);
      return;
    }

    next(error);
  }
}
