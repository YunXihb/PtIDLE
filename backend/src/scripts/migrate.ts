/**
 * T-FOLLOW-1 + T-FOLLOW-2: Migrations Runner
 *
 * 自动应用 `src/migrations/*.sql`（按文件名数字升序），通过 `schema_migrations`
 * 表追踪已应用版本，实现幂等（重复运行安全）。
 *
 * 用法:
 *   npx ts-node src/scripts/migrate.ts            # 应用所有未运行的迁移
 *   npx ts-node src/scripts/migrate.ts --status   # 仅打印当前状态，不应用
 *
 * 程序化 API（供 src/index.ts 启动时检测用）:
 *   import { checkMigrationsStatus } from './scripts/migrate';
 *   const status = await checkMigrationsStatus();
 *   if (status.hasPending) console.warn(`Missing: ${status.missing.join(', ')}`);
 *
 * 设计决策:
 *   - 使用 PostgreSQL `schema_migrations` 表（filename UNIQUE + applied_at）
 *   - 每个迁移文件独立事务 (BEGIN/COMMIT)，失败 ROLLBACK 并 abort 整个流程
 *   - 排序按文件名（"001_" "002_" 等），确保依赖顺序
 *   - Bootstrap 自身：第一次运行自动创建 schema_migrations 表
 *   - checkMigrationsStatus 走 fail-open（DB 错误返回 ok=false，不抛错）
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
// T-FOLLOW-2: 启动期状态查询（程序化）
// ========================================

/**
 * migrations 状态（用于 src/index.ts 启动时检测）
 * - ok: false → DB 错误，不应阻塞启动（fail-open）
 * - hasPending: true → 有未应用的迁移，调用方可 console.warn
 */
export interface MigrationStatus {
  total: number;
  applied: number;
  pending: number;
  /** 未应用的文件名列表（已按文件名升序） */
  missing: string[];
  /** pending > 0 的便捷布尔 */
  hasPending: boolean;
  /** 查询是否成功（false = DB 错误） */
  ok: boolean;
  /** 错误信息（仅 ok=false 时存在） */
  error?: string;
}

/**
 * 只读检查当前 migrations 状态，不修改 DB。
 * 用于 src/index.ts 启动时检测缺失 migrations 并 console.warn。
 *
 * 设计决策:
 *   - **Fail-open**: DB 错误 → 返回 ok=false + error，不抛错（避免阻塞 server 启动）
 *   - 不调 listMigrations 之外的 IO（pure read + ensureMigrationsTable 自我修复）
 *   - missing 数组保留顺序，方便日志逐行展示
 */
export async function checkMigrationsStatus(): Promise<MigrationStatus> {
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