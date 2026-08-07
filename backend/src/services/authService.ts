import { query, execute, withTransaction } from '../config/database';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { initializePlayer } from './playerService';
import { JWT_SECRET, JWT_EXPIRES_IN } from '../config/jwt';

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

export class InvalidCredentialsError extends Error {
  constructor() {
    super('Invalid username or password');
    this.name = 'InvalidCredentialsError';
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

  const username = input.username.trim();

  // Hash password 在事务外完成（CPU 密集，避免占用连接）
  const passwordHash = await hashPassword(input.password);
  const userId = uuidv4();
  const now = new Date();

  // 事务：existence check + INSERT user + initializePlayer 原子化
  // 修复此前 INSERT user 与 initializePlayer 各自独立 execute、中间失败留孤立 user 的 bug
  return withTransaction(async (client) => {
    // Check if username already exists（事务内同连接读，保证一致性）
    const existing = await client.query<User>(
      'SELECT id FROM users WHERE username = $1',
      [username]
    );

    if (existing.rows.length > 0) {
      throw new UserAlreadyExistsError(username);
    }

    // Create user
    await client.query(
      `INSERT INTO users (id, username, password_hash, created_at, last_login)
       VALUES ($1, $2, $3, $4, NULL)`,
      [userId, username, passwordHash, now]
    );

    // 初始化玩家数据（创建玩家记录和棋子）—— 同一事务，失败则整体回滚
    await initializePlayer(userId, client);

    return {
      id: userId,
      username,
      created_at: now,
      last_login: null
    };
  });
}

function generateToken(userId: string, username: string): string {
  return jwt.sign(
    { userId, username },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] }
  );
}

export interface LoginResult {
  token: string;
  user: Omit<User, 'password_hash'>;
}

export async function login(username: string, password: string): Promise<LoginResult> {
  // Validate input
  if (!username || username.trim().length === 0) {
    throw new InvalidInputError('Username is required');
  }

  if (!password || password.length === 0) {
    throw new InvalidInputError('Password is required');
  }

  // Find user by username
  const users = await query<User>(
    'SELECT id, username, password_hash, created_at, last_login FROM users WHERE username = $1',
    [username.trim()]
  );

  if (users.length === 0) {
    throw new InvalidCredentialsError();
  }

  const user = users[0];

  // Verify password
  const isValidPassword = await bcrypt.compare(password, user.password_hash);
  if (!isValidPassword) {
    throw new InvalidCredentialsError();
  }

  // Update last_login
  const now = new Date();
  await execute(
    'UPDATE users SET last_login = $1 WHERE id = $2',
    [now, user.id]
  );

  // Generate JWT token
  const token = generateToken(user.id, user.username);

  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      created_at: user.created_at,
      last_login: now
    }
  };
}
