import { Pool, PoolConfig } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const poolConfig: PoolConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'ptidle',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  ssl: false,
};

export const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return result.rows;
  } finally {
    client.release();
  }
}

export async function queryOne<T = any>(text: string, params?: any[]): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] || null;
}

/**
 * T053：在单连接上执行事务，自动 BEGIN/COMMIT/ROLLBACK + release
 * - fn 接收 client；fn 内所有 SQL 走同一连接
 * - fn 成功 → COMMIT
 * - fn 抛错 → ROLLBACK + 重新抛错
 * - ROLLBACK 自身抛错 → 内部 try/catch 吞掉（避免 release 失败）
 * - 任何情况下 client.release() 都会被调用
 *
 * @param fn 接收 client，返回任意 Promise
 * @returns fn 的返回值
 */
export async function withTransaction<T>(
  fn: (client: import('pg').PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    try {
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (fnErr) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error('[withTransaction] ROLLBACK failed:', (rollbackErr as Error).message);
      }
      throw fnErr;
    }
  } finally {
    client.release();
  }
}

export async function execute(text: string, params?: any[]): Promise<number> {
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return result.rowCount || 0;
  } finally {
    client.release();
  }
}

export async function testConnection(): Promise<boolean> {
  try {
    const client = await pool.connect();
    await client.query('SELECT NOW()');
    client.release();
    console.log('✅ PostgreSQL connected');
    return true;
  } catch (error: any) {
    console.error('❌ PostgreSQL connection failed:', error.message);
    return false;
  }
}

export default pool;
