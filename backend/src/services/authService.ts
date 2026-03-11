import { query, execute } from '../config/database';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

export interface User {
  id: string;
  username: string;
  password_hash: string;
  created_at: Date;
  last_login: Date | null;
}

export interface CreateUserInput {
  username: string;
  password: string;
}

export class UserAlreadyExistsError extends Error {
  constructor(username: string) {
    super(`User "${username}" already exists`);
    this.name = 'UserAlreadyExistsError';
  }
}

export class InvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidInputError';
  }
}

async function hashPassword(password: string): Promise<string> {
  const saltRounds = 10;
  return bcrypt.hash(password, saltRounds);
}

export async function createUser(input: CreateUserInput): Promise<Omit<User, 'password_hash'>> {
  // Validate input
  if (!input.username || input.username.trim().length === 0) {
    throw new InvalidInputError('Username is required');
  }

  if (!input.password || input.password.length < 6) {
    throw new InvalidInputError('Password must be at least 6 characters');
  }

  // Check if username already exists
  const existingUsers = await query<User>(
    'SELECT id FROM users WHERE username = $1',
    [input.username.trim()]
  );

  if (existingUsers.length > 0) {
    throw new UserAlreadyExistsError(input.username);
  }

  // Hash password and create user
  const passwordHash = await hashPassword(input.password);
  const userId = uuidv4();
  const now = new Date();

  await execute(
    `INSERT INTO users (id, username, password_hash, created_at, last_login)
     VALUES ($1, $2, $3, $4, NULL)`,
    [userId, input.username.trim(), passwordHash, now]
  );

  return {
    id: userId,
    username: input.username.trim(),
    created_at: now,
    last_login: null
  };
}
