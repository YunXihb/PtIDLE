// T-FOLLOW-1: migrations runner 单元测试
// 总计 8 cases
// 覆盖：bootstrap / 排序 / 幂等 skip / 错误 abort / status / 重复运行

// ============== Mocks ==============
// 注意：jest.mock + const mockXxx 必须先于 import（ts-jest TDZ pitfall）

const mockQuery = jest.fn();
const mockPoolConnect = jest.fn();
const mockPoolEnd = jest.fn();
const mockClientQuery = jest.fn();

const mockReadFileSync = jest.fn();
const mockReaddirSync = jest.fn();
const mockConsoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
const mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

jest.mock('../config/database', () => ({
  pool: {
    connect: mockPoolConnect,
    end: mockPoolEnd,
  },
  query: mockQuery,
}));

jest.mock('fs', () => ({
  readFileSync: mockReadFileSync,
  readdirSync: mockReaddirSync,
}));

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _refs = { mockQuery, mockPoolConnect, mockPoolEnd, mockClientQuery, mockReadFileSync, mockReaddirSync };

// Imports must come AFTER all jest.mock calls
// 注意：migrate.ts 在 main() 自动跑，需要用 jest.isolateModules 隔离
import { runMigrations, printStatus, listMigrations } from './migrate';

// ============== Helpers ==============

/**
 * 准备一个干净的 mock 环境：
 *   - readdirSync 返回指定文件列表
 *   - readFileSync 返回对应 SQL 内容
 *   - query() 处理 schema_migrations 表 bootstrap + 查询 applied
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

  // query() — based on first arg
  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) {
      return [];
    }
    if (sql.includes('SELECT filename FROM schema_migrations')) {
      return Array.from(applied).map((f) => ({ filename: f }));
    }
    return [];
  });

  // pool.connect() → returns client with query method
  const mockClient = {
    query: mockClientQuery.mockImplementation(async (sql: string) => {
      if (failOn && sql.includes(`SQL for ${failOn}`)) {
        throw new Error('Simulated migration failure');
      }
      if (sql.startsWith('INSERT INTO schema_migrations')) {
        applied.add(failOn ?? 'unknown'); // track applied
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
// 2. runMigrations
// ========================================

describe('runMigrations', () => {
  it('case 2: 全未应用 → 全部按顺序应用', async () => {
    setupMocks({ files: ['001_a.sql', '002_b.sql'], applied: [] });
    await runMigrations();

    // 3 query calls: 1) bootstrap, 2) get applied, 3) per-migration insert (via client.query)
    // 2 pool.connect calls (1 per migration)
    expect(mockPoolConnect).toHaveBeenCalledTimes(2);

    // client.query: BEGIN, SQL, INSERT, COMMIT per migration × 2 = 8 calls
    expect(mockClientQuery).toHaveBeenCalledTimes(8);
  });

  it('case 3: 已全部应用 → 不调 pool.connect，提示已最新', async () => {
    setupMocks({ files: ['001_a.sql', '002_b.sql'], applied: ['001_a.sql', '002_b.sql'] });
    await runMigrations();

    expect(mockPoolConnect).not.toHaveBeenCalled();
    // 应打印 "Already applied" / "Nothing to do"
    const allLogs = mockConsoleLog.mock.calls.map((c) => String(c[0])).join('\n');
    expect(allLogs).toMatch(/All migrations already applied|Nothing to do/);
  });

  it('case 4: 部分已应用 → 只跑 pending', async () => {
    setupMocks({ files: ['001_a.sql', '002_b.sql', '003_c.sql'], applied: ['001_a.sql'] });
    await runMigrations();

    // 只有 002, 003 需要跑
    expect(mockPoolConnect).toHaveBeenCalledTimes(2);
  });

  it('case 5: 失败 → abort，剩余不跑 + process.exit(1)', async () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    setupMocks({
      files: ['001_a.sql', '002_b.sql', '003_c.sql'],
      applied: [],
      failOn: '002_b.sql',
    });

    await runMigrations();

    // 001 成功 (connect #1) → 002 失败 (connect #2) → 不跑 003 (connect #3 没发生)
    expect(mockPoolConnect).toHaveBeenCalledTimes(2);
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

    // 至少调用 query 2 次 (bootstrap + SELECT applied)
    expect(mockQuery).toHaveBeenCalledTimes(2);

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
  it('case 8: 第二次运行 → 全部已 applied → 0 connect 调用', async () => {
    // 模拟第一次已跑完（applied 集合有所有文件）
    setupMocks({ files: ['001_a.sql', '002_b.sql'], applied: ['001_a.sql', '002_b.sql'] });
    await runMigrations();
    expect(mockPoolConnect).not.toHaveBeenCalled();

    // 模拟再次运行（仍然全部 applied）
    jest.clearAllMocks();
    setupMocks({ files: ['001_a.sql', '002_b.sql'], applied: ['001_a.sql', '002_b.sql'] });
    await runMigrations();
    expect(mockPoolConnect).not.toHaveBeenCalled();
  });
});