// T-FOLLOW-1: migrations runner 单元测试
// 总计 8 cases
// 覆盖：bootstrap / 排序 / 幂等 skip / 错误 abort / status / 重复运行

// ============== Mocks ==============
// 注意：jest.mock + const mockXxx 必须先于 import（ts-jest TDZ pitfall）

const mockPoolConnect = jest.fn();
const mockPoolEnd = jest.fn();
const mockClientQuery = jest.fn();

const mockReadFileSync = jest.fn();
const mockReaddirSync = jest.fn();
const mockConsoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
const mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

// T-FOLLOW-6 bug fix: migrate.js 不再 require('../config/database'), 改为内联 pg.Pool.
// 测试 mock 'pg' module, Pool 构造返回 mock 实例 (connect/end/on).
jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    connect: mockPoolConnect,
    end: mockPoolEnd,
    on: jest.fn(),
  })),
}));

jest.mock('fs', () => ({
  readFileSync: mockReadFileSync,
  readdirSync: mockReaddirSync,
}));

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _refs = { mockPoolConnect, mockPoolEnd, mockClientQuery, mockReadFileSync, mockReaddirSync };

// Imports must come AFTER all jest.mock calls
// 注意：migrate.js 在 main() 自动跑，需要用 jest.isolateModules 隔离
import { runMigrations, printStatus, listMigrations, checkMigrationsStatus } from './migrate';

// ============== Helpers ==============

/**
 * 准备一个干净的 mock 环境：
 *   - readdirSync 返回指定文件列表
 *   - readFileSync 返回对应 SQL 内容
 *   - client.query() 处理 schema_migrations bootstrap + 查询 applied + 业务 SQL + INSERT
 *   - pool.connect() 返回 mock client
 */
function setupMocks(opts: {
  files?: string[];
  fileContents?: Record<string, string>;
  applied?: string[];
  failOn?: string;
} = {}) {
  const files = opts.files ?? ['001_a.sql', '002_b.sql', '003_c.sql'];
  const applied = new Set(opts.applied ?? []);
  const failOn = opts.failOn;

  mockReaddirSync.mockReturnValue(files);
  mockReadFileSync.mockImplementation((path: string) => {
    const filename = path.split('/').pop() ?? '';
    if (opts.fileContents && filename in opts.fileContents) {
      return opts.fileContents[filename];
    }
    return `-- SQL for ${filename}`;
  });

  // pool.connect() → returns client with query method
  // 单一 client.query mock 同时处理 bootstrap (CREATE TABLE) + 查询 applied (SELECT) +
  // 业务 SQL (BEGIN/file.sql/INSERT/COMMIT) — 因为 migrate.js 内联 query() 也走 client.query
  const mockClient = {
    query: mockClientQuery.mockImplementation(async (sql: string) => {
      // bootstrap: CREATE TABLE schema_migrations
      if (sql.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) {
        return { rows: [] };
      }
      // getAppliedMigrations: SELECT filename
      if (sql.includes('SELECT filename FROM schema_migrations')) {
        return { rows: Array.from(applied).map((f) => ({ filename: f })) };
      }
      // 业务 migration SQL
      if (failOn && sql.includes(`SQL for ${failOn}`)) {
        throw new Error('Simulated migration failure');
      }
      // INSERT INTO schema_migrations — track applied
      if (sql.startsWith('INSERT INTO schema_migrations')) {
        applied.add(failOn ?? 'unknown');
      }
      return { rows: [] };
    }),
    release: jest.fn(),
  };
  mockPoolConnect.mockResolvedValue(mockClient);
  mockPoolEnd.mockResolvedValue(undefined);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockConsoleLog.mockClear();
  mockConsoleError.mockClear();
});

// ========================================
// 1. listMigrations（纯函数，无 IO）
// ========================================

describe('listMigrations', () => {
  it('case 1: 列出目录所有 .sql 文件，按文件名升序', () => {
    mockReaddirSync.mockReturnValue(['003_c.sql', '001_a.sql', '002_b.sql', 'README.md', '005_e.sql']);
    const result = listMigrations();
    expect(result.map((m) => m.filename)).toEqual(['001_a.sql', '002_b.sql', '003_c.sql', '005_e.sql']);
  });
});

// ========================================
// 1b. MIGRATIONS_DIR env var (T-FOLLOW-5)
// prod image 用 MIGRATIONS_DIR=/app/migrations 覆盖默认路径
// ========================================

describe('listMigrations - MIGRATIONS_DIR env var', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    delete process.env.MIGRATIONS_DIR;
  });

  it('uses MIGRATIONS_DIR env var when set', () => {
    const customDir = '/custom/migrations/path';
    process.env.MIGRATIONS_DIR = customDir;
    mockReaddirSync.mockReturnValue(['999_test.sql']);

    // 重新 import (因为 env var 在 module load 时被读取)
    const { listMigrations: listMigrationsFresh } = require('./migrate');
    const result = listMigrationsFresh();

    expect(mockReaddirSync).toHaveBeenCalledWith(customDir);
    expect(result[0].filepath).toBe(`${customDir}/999_test.sql`);
  });
});

// ========================================
// 2. runMigrations
// ========================================

describe('runMigrations', () => {
  it('case 2: 全未应用 → 全部按顺序应用', async () => {
    setupMocks({ files: ['001_a.sql', '002_b.sql'], applied: [] });
    await runMigrations();

    // pool.connect: ensureTable (1) + getApplied (1) + applyMigration×2 (2) = 4
    expect(mockPoolConnect).toHaveBeenCalledTimes(4);

    // client.query: ensureTable (1) + getApplied (1) + (BEGIN+SQL+INSERT+COMMIT)×2 = 10
    expect(mockClientQuery).toHaveBeenCalledTimes(10);
  });

  it('case 3: 已全部应用 → 仅 bootstrap（不跑 migration），提示已最新', async () => {
    setupMocks({ files: ['001_a.sql', '002_b.sql'], applied: ['001_a.sql', '002_b.sql'] });
    await runMigrations();

    // bootstrap (ensureTable + getApplied) 仍走 pool.connect，但 applyMigration 不跑
    expect(mockPoolConnect).toHaveBeenCalledTimes(2);
    // 没有 BEGIN/COMMIT 表明没有 migration 被应用
    const callSqls = mockClientQuery.mock.calls.map((c) => String(c[0]).trim().split(' ')[0]);
    expect(callSqls).not.toContain('BEGIN');
    expect(callSqls).not.toContain('COMMIT');
    // 应打印 "Already applied" / "Nothing to do"
    const allLogs = mockConsoleLog.mock.calls.map((c) => String(c[0])).join('\n');
    expect(allLogs).toMatch(/All migrations already applied|Nothing to do/);
  });

  it('case 4: 部分已应用 → 只跑 pending', async () => {
    setupMocks({ files: ['001_a.sql', '002_b.sql', '003_c.sql'], applied: ['001_a.sql'] });
    await runMigrations();

    // ensureTable (1) + getApplied (1) + applyMigration×2 (002+003) = 4
    expect(mockPoolConnect).toHaveBeenCalledTimes(4);
  });

  it('case 5: 失败 → abort，剩余不跑 + process.exit(1)', async () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    setupMocks({
      files: ['001_a.sql', '002_b.sql', '003_c.sql'],
      applied: [],
      failOn: '002_b.sql',
    });

    await runMigrations();

    // ensureTable (1) + getApplied (1) + applyMigration×2 (001成功+002失败) = 4
    // 003 因 abort 不跑
    expect(mockPoolConnect).toHaveBeenCalledTimes(4);
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('case 6: 失败时 ROLLBACK 被调（事务回滚）', async () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    setupMocks({
      files: ['001_a.sql', '002_b.sql'],
      applied: [],
      failOn: '001_a.sql',
    });

    await runMigrations();

    // client.query calls: BEGIN, SQL(throws), ROLLBACK
    const calls = mockClientQuery.mock.calls.map((c) => String(c[0]).trim().split(' ')[0]);
    expect(calls).toContain('BEGIN');
    expect(calls).toContain('ROLLBACK');
    // COMMIT 不应在失败路径出现
    expect(calls).not.toContain('COMMIT');
    exitSpy.mockRestore();
  });
});

// ========================================
// 3. printStatus
// ========================================

describe('printStatus', () => {
  it('case 7: printStatus 调用 bootstrap + 查询 applied + 打印列表', async () => {
    setupMocks({ files: ['001_a.sql', '002_b.sql'], applied: ['001_a.sql'] });
    await printStatus();

    // bootstrap (ensureTable) + getApplied → 2 pool.connect + 2 client.query
    expect(mockPoolConnect).toHaveBeenCalledTimes(2);
    expect(mockClientQuery).toHaveBeenCalledTimes(2);

    // 应打印 status 标题 + applied/pending summary
    const allLogs = mockConsoleLog.mock.calls.map((c) => String(c[0])).join('\n');
    expect(allLogs).toContain('Migration status');
    expect(allLogs).toContain('Total files: 2');
    expect(allLogs).toContain('Applied: 1');
    expect(allLogs).toContain('Pending: 1');
    expect(allLogs).toContain('applied');
    expect(allLogs).toContain('pending');
  });
});

// ========================================
// 4. 重复运行 idempotency（行为测试）
// ========================================

describe('idempotency behavior', () => {
  it('case 8: 第二次运行 → 全部已 applied → 仅 bootstrap，无 migration 应用', async () => {
    // 模拟第一次已跑完（applied 集合有所有文件）
    setupMocks({ files: ['001_a.sql', '002_b.sql'], applied: ['001_a.sql', '002_b.sql'] });
    await runMigrations();
    // bootstrap (ensureTable + getApplied) 走 pool.connect，applyMigration 不跑
    expect(mockPoolConnect).toHaveBeenCalledTimes(2);

    // 模拟再次运行（仍然全部 applied）
    jest.clearAllMocks();
    setupMocks({ files: ['001_a.sql', '002_b.sql'], applied: ['001_a.sql', '002_b.sql'] });
    await runMigrations();
    expect(mockPoolConnect).toHaveBeenCalledTimes(2);
  });
});

// ========================================
// 5. checkMigrationsStatus (T-FOLLOW-2)
// 启动期只读检测，index.ts 用
// ========================================

describe('checkMigrationsStatus', () => {
  it('case 9: 全部已 applied → ok=true, hasPending=false, missing=[]', async () => {
    setupMocks({ files: ['001_a.sql', '002_b.sql'], applied: ['001_a.sql', '002_b.sql'] });
    const status = await checkMigrationsStatus();

    expect(status.ok).toBe(true);
    expect(status.total).toBe(2);
    expect(status.applied).toBe(2);
    expect(status.pending).toBe(0);
    expect(status.hasPending).toBe(false);
    expect(status.missing).toEqual([]);
    expect(status.error).toBeUndefined();
  });

  it('case 10: 部分未 applied → ok=true, hasPending=true, missing 列出文件名', async () => {
    setupMocks({ files: ['001_a.sql', '002_b.sql', '003_c.sql'], applied: ['001_a.sql'] });
    const status = await checkMigrationsStatus();

    expect(status.ok).toBe(true);
    expect(status.total).toBe(3);
    expect(status.applied).toBe(1);
    expect(status.pending).toBe(2);
    expect(status.hasPending).toBe(true);
    expect(status.missing).toEqual(['002_b.sql', '003_c.sql']);
  });

  it('case 11: 全部未 applied → missing 包含所有 .sql 文件', async () => {
    setupMocks({ files: ['001_a.sql', '002_b.sql'], applied: [] });
    const status = await checkMigrationsStatus();

    expect(status.ok).toBe(true);
    expect(status.total).toBe(2);
    expect(status.applied).toBe(0);
    expect(status.pending).toBe(2);
    expect(status.hasPending).toBe(true);
    expect(status.missing).toEqual(['001_a.sql', '002_b.sql']);
  });

  it('case 12: DB 错误 → fail-open 返回 ok=false + error，不抛错', async () => {
    setupMocks({ files: ['001_a.sql'], applied: [] });
    // 强制 mockClientQuery bootstrap 失败（第一次 query 是 CREATE TABLE）
    mockClientQuery.mockRejectedValueOnce(new Error('relation "schema_migrations" does not exist'));

    const status = await checkMigrationsStatus();

    expect(status.ok).toBe(false);
    expect(status.error).toContain('schema_migrations');
    expect(status.hasPending).toBe(false);
    expect(status.missing).toEqual([]);
    // 不阻塞调用方：返回的对象可用，不抛异常
  });

  it('case 13: bootstrap 之前 query 抛错（极端 DB 离线）→ ok=false，total=0', async () => {
    setupMocks({ files: ['001_a.sql'], applied: [] });
    // mockClientQuery 所有调用都抛错（DB 离线模拟）
    mockClientQuery.mockImplementation(async () => {
      throw new Error('DB connection refused');
    });

    const status = await checkMigrationsStatus();

    expect(status.ok).toBe(false);
    expect(status.error).toBe('DB connection refused');
    expect(status.total).toBe(0);
    expect(status.applied).toBe(0);
    expect(status.pending).toBe(0);
  });
});