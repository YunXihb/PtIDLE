/**
 * T-FOLLOW-1 + T-FOLLOW-2 + T-FOLLOW-5: Migrations Runner
 *
 * 自动应用 migrations dir 下的 *.sql 文件（按文件名数字升序），通过 schema_migrations
 * 表追踪已应用版本，实现幂等（重复运行安全）。
 *
 * 用法:
 *   node src/scripts/migrate.js            # 应用所有未运行的迁移
 *   node src/scripts/migrate.js --status   # 仅打印当前状态，不应用
 *
 * 环境变量:
 *   MIGRATIONS_DIR  覆盖 migrations 目录路径 (prod image 用 /app/migrations)
 *
 * 程序化 API (供 src/index.ts 启动期检测):
 *   const { checkMigrationsStatus } = require('./scripts/migrate');
 */

'use strict';

const { readFileSync, readdirSync } = require('fs');
const { join, resolve } = require('path');
const { Pool } = require('pg');
require('dotenv').config();

// ========================================
// Database pool (self-contained, no .ts deps)
// T-FOLLOW-6 bug fix: 原 require('../config/database') 在没 tsc 编译的上下文
// (CI 跑 npm ci 但不 build) 会 throw MODULE_NOT_FOUND. 改为内联 pool + query,
// 让 migrate.js 在 src/ 和 dist/ 两种上下文都能独立跑.
// ========================================

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'ptidle',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  ssl: false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

/**
 * 轻量 query 助手 — pool.connect + client.query + release.
 * 等价于原 database.ts 的 query(), 但不依赖 .ts 编译产物.
 */
async function query(text, params) {
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return result.rows;
  } finally {
    client.release();
  }
}

// ========================================
// 配置
// ========================================

/** migrations 目录 — env var 优先，默认相对 __dirname 解析 */
const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR
  ? resolve(process.env.MIGRATIONS_DIR)
  : resolve(__dirname, '../migrations');

/** 追踪表名 */
const MIGRATIONS_TABLE = 'schema_migrations';

// ========================================
// Bootstrap
// ========================================

async function ensureMigrationsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id SERIAL PRIMARY KEY,
      filename TEXT UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

// ========================================
// 核心逻辑
// ========================================

/**
 * 列出 migrations 目录所有 .sql 文件，按文件名升序排序
 * @returns {{filename: string, filepath: string}[]}
 */
function listMigrations() {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  return files.map((filename) => ({
    filename,
    filepath: join(MIGRATIONS_DIR, filename),
  }));
}

/**
 * 查询已应用的迁移
 * @returns {Promise<Set<string>>}
 */
async function getAppliedMigrations() {
  const rows = await query(
    `SELECT filename FROM ${MIGRATIONS_TABLE} ORDER BY filename`
  );
  return new Set(rows.map((r) => r.filename));
}

/**
 * 应用单个迁移
 */
async function applyMigration(file) {
  const sql = readFileSync(file.filepath, 'utf8');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query(
        `INSERT INTO ${MIGRATIONS_TABLE} (filename) VALUES ($1)`,
        [file.filename]
      );
      await client.query('COMMIT');
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error(`[migrate] ROLLBACK failed for ${file.filename}:`, rollbackErr);
      }
      throw err;
    }
  } finally {
    client.release();
  }
}

/**
 * 打印当前状态
 */
async function printStatus() {
  await ensureMigrationsTable();
  const all = listMigrations();
  const applied = await getAppliedMigrations();

  console.log(`\n📋 Migration status:`);
  console.log(`   Migrations directory: ${MIGRATIONS_DIR}`);
  console.log(`   Total files: ${all.length}`);
  console.log(`   Applied: ${applied.size}`);
  console.log(`   Pending: ${all.length - applied.size}\n`);

  for (const m of all) {
    const status = applied.has(m.filename) ? '✓ applied' : '○ pending';
    console.log(`   ${status}  ${m.filename}`);
  }
  console.log('');
}

/**
 * migrations 状态（程序化 API, fail-open）
 * @returns {Promise<{total: number, applied: number, pending: number, missing: string[], hasPending: boolean, ok: boolean, error?: string}>}
 */
async function checkMigrationsStatus() {
  try {
    await ensureMigrationsTable();
    const all = listMigrations();
    const applied = await getAppliedMigrations();
    const missing = all.filter((m) => !applied.has(m.filename)).map((m) => m.filename);
    return {
      total: all.length,
      applied: applied.size,
      pending: missing.length,
      missing,
      hasPending: missing.length > 0,
      ok: true,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      total: 0,
      applied: 0,
      pending: 0,
      missing: [],
      hasPending: false,
      ok: false,
      error: message,
    };
  }
}

async function runMigrations() {
  await ensureMigrationsTable();

  const all = listMigrations();
  const applied = await getAppliedMigrations();
  const pending = all.filter((m) => !applied.has(m.filename));

  console.log(`\n🚀 Running migrations:`);
  console.log(`   Total files: ${all.length}`);
  console.log(`   Already applied: ${applied.size}`);
  console.log(`   Pending: ${pending.length}\n`);

  if (pending.length === 0) {
    console.log('✅ All migrations already applied. Nothing to do.\n');
    return;
  }

  let successCount = 0;
  let failureCount = 0;

  for (const m of pending) {
    const start = Date.now();
    try {
      await applyMigration(m);
      const elapsed = Date.now() - start;
      console.log(`   ✓ ${m.filename} (${elapsed}ms)`);
      successCount++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`   ✗ ${m.filename} FAILED: ${message}`);
      console.error(`\n❌ Migration aborted. Database is in a clean state (transaction rolled back).`);
      console.error(`   Fix the error above and re-run. Already-applied migrations will be skipped.\n`);
      failureCount++;
      break;
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`   Applied: ${successCount}`);
  console.log(`   Failed: ${failureCount}`);
  console.log(`   Remaining: ${pending.length - successCount - failureCount}\n`);

  if (failureCount > 0) {
    process.exit(1);
  }
}

// ========================================
// CLI
// ========================================

async function main() {
  const args = process.argv.slice(2);

  try {
    if (args.includes('--status') || args.includes('-s')) {
      await printStatus();
    } else {
      await runMigrations();
    }
  } catch (err) {
    console.error('Migration runner error:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main();
}

// ========================================
// Exports
// ========================================

module.exports = {
  listMigrations,
  printStatus,
  checkMigrationsStatus,
  runMigrations,
  MIGRATIONS_DIR,
};