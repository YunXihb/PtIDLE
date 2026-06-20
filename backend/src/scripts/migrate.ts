/**
 * T-FOLLOW-1: Migrations Runner
 *
 * 自动应用 `src/migrations/*.sql`（按文件名数字升序），通过 `schema_migrations`
 * 表追踪已应用版本，实现幂等（重复运行安全）。
 *
 * 用法:
 *   npx ts-node scripts/migrate.ts           # 应用所有未运行的迁移
 *   npx ts-node scripts/migrate.ts --status  # 仅打印当前状态，不应用
 *
 * 设计决策:
 *   - 使用 PostgreSQL `schema_migrations` 表（filename UNIQUE + applied_at）
 *   - 每个迁移文件独立事务 (BEGIN/COMMIT)，失败 ROLLBACK 并 abort 整个流程
 *   - 排序按文件名（"001_" "002_" 等），确保依赖顺序
 *   - Bootstrap 自身：第一次运行自动创建 schema_migrations 表
 *
 * 范围外:
 *   - 不支持 down/rollback（项目尚无对应 .down.sql 文件）
 *   - 不支持 non-SQL migrations（未来加 JS/TS migrations 需扩展此 runner）
 */

import { readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { pool, query } from '../config/database';

// ========================================
// 配置
// ========================================

/** migrations 目录（相对 backend/） */
// 注意：此文件位于 src/scripts/，需回退两级到 backend/，再进入 src/migrations/
const MIGRATIONS_DIR = resolve(__dirname, '../migrations');

/** 追踪表名 */
const MIGRATIONS_TABLE = 'schema_migrations';

// ========================================
// Bootstrap
// ========================================

async function ensureMigrationsTable(): Promise<void> {
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

interface MigrationFile {
  filename: string;
  filepath: string;
}

/**
 * 列出 migrations 目录所有 .sql 文件，按文件名（数字前缀）升序排序
 */
export function listMigrations(): MigrationFile[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // 字符串排序：001_ < 002_ < ... < 010_
  return files.map((filename) => ({
    filename,
    filepath: join(MIGRATIONS_DIR, filename),
  }));
}

/**
 * 查询已应用的迁移（返回 Set<filename>）
 */
async function getAppliedMigrations(): Promise<Set<string>> {
  const rows = await query<{ filename: string }>(
    `SELECT filename FROM ${MIGRATIONS_TABLE} ORDER BY filename`
  );
  return new Set(rows.map((r) => r.filename));
}

/**
 * 应用单个迁移：执行 SQL + 记录到 schema_migrations
 * 失败抛错（事务回滚），由调用方决定是否继续
 */
async function applyMigration(file: MigrationFile): Promise<void> {
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
export async function printStatus(): Promise<void> {
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

// ========================================
// 主入口
// ========================================

export async function runMigrations(): Promise<void> {
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
      break; // 终止后续迁移
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

async function main(): Promise<void> {
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

// 仅在直接执行此文件时运行 main()（require.main === module 模式）
// 这样单元测试可以 import 内部函数而不触发 CLI
if (require.main === module) {
  main();
}