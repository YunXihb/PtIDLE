# T-FOLLOW-5 Orchestration Platform + Deploy Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 T-FOLLOW-4 (GHCR + release workflow) 之上，加 deploy workflow：push tag v* → release.yml 成功 → deploy.yml SSH 拉镜像 + migrate + restart + health check。

**Architecture:** 单 VPS (Hetzner/DO/Lightsail) + Docker Compose (4 services: postgres/redis/backend/migrate) + GitHub Actions SSH deploy。`migrate` service 跟 `backend` 用同一 image（migrations SQL baked 进 image `/app/migrations/`），避免 bind mount 复杂度。

**Tech Stack:** GitHub Actions (`workflow_run` + `appleboy/ssh-action`) + Docker Compose + Node 20 alpine + PostgreSQL 16 + Redis 7-alpine。

**Spec:** [`docs/superpowers/specs/2026-06-22-tfollow5-orchestration-platform-design.md`](../specs/2026-06-22-tfollow5-orchestration-platform-design.md)

---

## File Structure (新增/修改文件总览)

| 文件 | 改动 | 作用 |
|---|---|---|
| `backend/src/scripts/migrate.ts` | **改** (重写) | 改为 `migrate.js`，纯 JS 不需 ts-node，新增 `MIGRATIONS_DIR` env var 支持 |
| `backend/src/scripts/migrate.js` | **新建** | 同上, 重命名后的纯 JS 迁移 runner |
| `backend/src/scripts/migrate.test.ts` | **改** | import 路径同步, 测试逻辑保持 |
| `backend/Dockerfile` | **改** | 加 `COPY src/migrations /app/migrations` |
| `backend/package.json` | **改** | `db:migrate` / `db:status` 改用 `node src/scripts/migrate.js` |
| `docker-compose.yml` | **新建** (repo 根) | VPS 4-service 模板 |
| `.github/workflows/deploy.yml` | **新建** | workflow_run trigger + SSH action |
| `scripts/deploy.sh` | **新建** | VPS 上跑的部署脚本 |
| `docs/deploy.md` | **改** | 加 § 5.3 单 VPS CI 自动部署 |
| `memory-bank/architecture.md` | **改** | v1.45 → v1.46, 加 T-FOLLOW-5 章节 |
| `memory-bank/progress.md` | **改** | T-FOLLOW-5 移入已完成 + T-FOLLOW-6 |
| `memory-bank/history.md` | **改** | 追加 2026-06-22 T-FOLLOW-5 日志 |

---

## Task 1: Refactor migrate.ts → migrate.js (纯 JS + MIGRATIONS_DIR env var)

**Files:**
- Modify: `backend/src/scripts/migrate.ts` (删除)
- Create: `backend/src/scripts/migrate.js` (新建, 等价 JS)
- Modify: `backend/src/scripts/migrate.test.ts` (更新 import + 验证 env var)
- Modify: `backend/package.json` (db:migrate / db:status 改用 node + .js)

**背景**: 当前 `migrate.ts` 是 TS 脚本，CI 用 `ts-node` 运行。生产 image 不含 ts-node（dev dep），所以无法直接跑。需要改为纯 JS + 新增 `MIGRATIONS_DIR` env var 让 prod image 可以从 `/app/migrations/` 读 SQL。

### Step 1.1: 写失败的测试 (env var 支持)

打开 `backend/src/scripts/migrate.test.ts`，找到合适位置（比如 `describe('listMigrations', ...)` 块前）添加：

```typescript
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
```

### Step 1.2: 跑测试确认失败

```bash
cd /home/lovept/PtIDLE/backend && npx jest src/scripts/migrate.test.ts -t "MIGRATIONS_DIR env var" 2>&1 | tail -20
```

**Expected**: FAIL — "uses MIGRATIONS_DIR env var when set" 失败 (因 listMigrations 还没读 env var)

### Step 1.3: 创建 migrate.js (纯 JS, 不含 TypeScript)

创建 `backend/src/scripts/migrate.js`，内容**逐行对应** `migrate.ts`，区别：
- 删除所有 `interface` / type 注解
- 删除 `import type { PoolClient } from 'pg'` (没有运行时影响)
- `require` 替换 `import` (CommonJS)
- 新增 `MIGRATIONS_DIR` env var 支持

```javascript
/**
 * T-FOLLOW-1 + T-FOLLOW-2: Migrations Runner
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
const { pool, query } = require('../config/database');

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
```

### Step 1.4: 删除 migrate.ts

```bash
cd /home/lovept/PtIDLE && rm backend/src/scripts/migrate.ts
```

**重要**: 删除 .ts 后 ts-jest 仍然能跑（jest 自动选 .js），但**确认 import 路径**还正确。

### Step 1.5: 更新 migrate.test.ts 的 import

打开 `backend/src/scripts/migrate.test.ts`，找到第 36 行的 import：

```typescript
import { runMigrations, printStatus, listMigrations, checkMigrationsStatus } from './migrate';
```

改为：

```typescript
import { runMigrations, printStatus, listMigrations, checkMigrationsStatus } from './migrate';
```

**保持不变** — jest 会自动解析到 `./migrate.js`。无需改 import path。

### Step 1.6: 跑全部测试

```bash
cd /home/lovept/PtIDLE/backend && npx jest src/scripts/migrate.test.ts 2>&1 | tail -20
```

**Expected**: PASS — 9/9 (原有 8 + 新增 1) tests pass

如果失败，常见原因：
- `_refs` 占位语句报警 → 删除 `const _refs = ...` 行（已废弃）
- env var test 不通过 → 检查 `MIGRATIONS_DIR` 是否在 module 顶层读取（必须用 `jest.resetModules()` 重新加载）

### Step 1.7: 更新 package.json scripts

打开 `backend/package.json`，改第 15-16 行：

```json
"db:migrate": "node src/scripts/migrate.js",
"db:status": "node src/scripts/migrate.js --status"
```

### Step 1.8: 跑全量测试确认无 regression

```bash
cd /home/lovept/PtIDLE/backend && npx jest --forceExit 2>&1 | tail -10
```

**Expected**: 42/42 suite, 702/702 test (原 701 + 新增 1) pass

### Step 1.9: Commit

```bash
cd /home/lovept/PtIDLE && git add backend/src/scripts/migrate.js backend/src/scripts/migrate.test.ts backend/package.json
git rm backend/src/scripts/migrate.ts  # 如果上一步没删
git commit -m "refactor(scripts): migrate.ts → migrate.js (pure JS, no ts-node)

生产 image 不含 ts-node (dev dep), migrate.ts 跑不了. 改为纯 JS:
- 删除所有 TypeScript 类型注解
- require() 替换 import (CommonJS)
- 新增 MIGRATIONS_DIR env var 支持 (prod image 用 /app/migrations)
- 保持 API 与原 migrate.ts 一致 (listMigrations / printStatus / checkMigrationsStatus / runMigrations)
- package.json db:migrate / db:status 改用 node + .js

测试 9/9 pass (8 原有 + 1 新增 MIGRATIONS_DIR env var)
全量 702/702 test pass (无 regression)"
```

---

## Task 2: Update Dockerfile (bake migrations into image)

**Files:**
- Modify: `backend/Dockerfile` (加 1 行 + 改注释)

**背景**: 当前 image 不含 SQL migration 文件。生产环境跑 `node dist/scripts/migrate.js` 时需要从某处读 SQL。Spec 决策: 把 `src/migrations/*.sql` 烤进 image 的 `/app/migrations/`，配合 Task 1 的 MIGRATIONS_DIR env var。

### Step 2.1: 加 COPY 步骤

打开 `backend/Dockerfile`，找到第 60-61 行：

```dockerfile
# 2. copy 编译产物 (来自 builder stage)
COPY --from=builder /app/dist ./dist
```

改为：

```dockerfile
# 2. copy 编译产物 (来自 builder stage)
COPY --from=builder /app/dist ./dist

# 3. copy migrations SQL (T-FOLLOW-5: prod image 跑 migrate 需要)
COPY src/migrations /app/migrations
```

**注意**: 此 COPY 在 runtime stage，没有 `--from=builder`，因为 src/migrations 是 SQL 文件，runtime stage 已经有完整 src/ 目录（via 第 39 行的 `COPY src/ ./src/`）。**等等**，第 39 行在 builder stage，不会传到 runtime。

**修正**: 把 migrations COPY 移到 builder stage（用 `--from=builder`）：

```dockerfile
# 2. copy 编译产物 (来自 builder stage)
COPY --from=builder /app/dist ./dist

# 3. copy migrations SQL (T-FOLLOW-5: prod image 跑 migrate 需要)
COPY --from=builder /app/migrations /app/migrations
```

**或者** 简化：直接从 backend 目录复制（builder stage 已有 src/）：

在 **builder stage** 末尾加（`RUN npm run build` 之后）：

```dockerfile
# 把 migrations 目录保留（tsc 不会动 .sql 文件，但保险起见显式 copy）
COPY src/migrations /app/migrations
```

**实际**更简单 — `src/migrations` 在 builder stage 已被 `COPY src/ ./src/` 复制，但 builder 用完即弃。我们需要它在 **runtime stage**。

**最简方案**: 直接在 runtime stage 用 `COPY` 从 backend 目录（build context 是 `backend/`，所以 `src/migrations` 相对路径）：

把 runtime stage 的第 60-61 行改为：

```dockerfile
# 2. copy 编译产物 (来自 builder stage)
COPY --from=builder /app/dist ./dist

# 3. copy migrations SQL (T-FOLLOW-5: prod image 跑 migrate 需要)
COPY src/migrations /app/migrations
```

build context 是 `backend/`，所以 `src/migrations` 是 backend/src/migrations。

### Step 2.2: 改头部注释

把第 20-21 行：

```dockerfile
# 注意: 容器内**不**自动跑 npm run db:migrate, 需在外部先应用迁移
#       (或 init container / 一次性手动跑)
```

改为：

```dockerfile
# 注意: 容器内**不**自动跑 db:migrate, 需在外部/docker-compose migrate service
#       /一次性手动跑. SQL 文件在 /app/migrations/ (env MIGRATIONS_DIR 可覆盖)
```

### Step 2.3: 本地 build 验证

```bash
cd /home/lovept/PtIDLE/backend && docker build -t ptidle-backend:deploy-test . 2>&1 | tail -10
```

**Expected**: build 成功，无 error

### Step 2.4: 验证 image 含 migrations

```bash
docker run --rm ptidle-backend:deploy-test ls /app/migrations 2>&1
```

**Expected**: 看到 9 个 SQL 文件 (001_initial_schema.sql, 002_..., ... 010_...)

### Step 2.5: 验证 image 跑 migrate.js 不报错

```bash
docker run --rm \
  -e MIGRATIONS_DIR=/app/migrations \
  -e DB_HOST=localhost -e DB_PORT=5432 \
  -e DB_NAME=ptidle -e DB_USER=postgres -e DB_PASSWORD=test \
  ptidle-backend:deploy-test \
  node dist/scripts/migrate.js --status 2>&1 | tail -10
```

**Expected**: 启动期 warn 或 ENOENT（DB 连不上是预期，只验证 JS 跑得起来）—— 看到 `[migrate]` 相关的输出就 OK。如果 `Error: Cannot find module '../config/database'` → 编译路径有问题

### Step 2.6: 清理测试镜像

```bash
docker rmi ptidle-backend:deploy-test 2>&1
```

### Step 2.7: Commit

```bash
cd /home/lovept/PtIDLE && git add backend/Dockerfile
git commit -m "feat(docker): bake migrations SQL into image at /app/migrations

T-FOLLOW-5 准备: prod image 跑 migrate service 需要 SQL 文件
- Dockerfile 加 COPY src/migrations /app/migrations
- 配合 migrate.js 的 MIGRATIONS_DIR env var (默认 /app/migrations)
- 注释更新: db:migrate 需外部/docker-compose migrate service 跑

本机 build + 验证通过:
- docker build 成功
- docker run ls /app/migrations 看到 9 SQL 文件
- 清理测试镜像"
```

---

## Task 3: Create docker-compose.yml (VPS 模板)

**Files:**
- Create: `docker-compose.yml` (repo 根)

**背景**: VPS 上跑 4 services: postgres / redis / backend / migrate。`migrate` 是 one-shot，用同一 backend image。

### Step 3.1: 创建 docker-compose.yml

在 `/home/lovept/PtIDLE/docker-compose.yml` 创建文件：

```yaml
# =============================================================================
# PtIDLE Production Docker Compose (单 VPS 部署)
# =============================================================================
# T-FOLLOW-5: 单台 VPS 部署模板
# 4 services: postgres / redis / backend / migrate (one-shot)
#
# 使用:
#   cd /opt/ptidle
#   docker compose pull              # 拉 backend:latest from GHCR
#   docker compose run --rm migrate  # 跑 migrations
#   docker compose up -d             # 启 backend
#
# 注意:
#   - postgres / redis 用本地 image, backend 用 GHCR
#   - 首次配置: cp .env.example .env, 填 DB_PASSWORD + JWT_SECRET
#   - .env 不进 git, 也不进 image
# =============================================================================

services:
  postgres:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-ptidle}
      POSTGRES_USER: ${POSTGRES_USER:-ptidle}
      POSTGRES_PASSWORD: ${DB_PASSWORD:?DB_PASSWORD must be set}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-ptidle} -d ${POSTGRES_DB:-ptidle}"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  # one-shot service: 每次 deploy 显式 run, 平时不启 (profiles 隔离)
  # 用 backend 同一 image + MIGRATIONS_DIR env var 指向 baked-in /app/migrations
  migrate:
    image: ghcr.io/yunxihb/ptidle-backend:latest
    profiles: ["migrate"]
    environment:
      MIGRATIONS_DIR: /app/migrations
      DB_HOST: postgres
      DB_PORT: 5432
      DB_NAME: ${POSTGRES_DB:-ptidle}
      DB_USER: ${POSTGRES_USER:-ptidle}
      DB_PASSWORD: ${DB_PASSWORD}
      NODE_ENV: production
    command: ["node", "dist/scripts/migrate.js"]
    depends_on:
      postgres:
        condition: service_healthy
    restart: 'no'

  backend:
    image: ghcr.io/yunxihb/ptidle-backend:latest
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    ports:
      - "${BACKEND_PORT:-3000}:3000"
    environment:
      MIGRATIONS_DIR: /app/migrations
      DB_HOST: postgres
      DB_PORT: 5432
      DB_NAME: ${POSTGRES_DB:-ptidle}
      DB_USER: ${POSTGRES_USER:-ptidle}
      DB_PASSWORD: ${DB_PASSWORD}
      REDIS_HOST: redis
      REDIS_PORT: 6379
      JWT_SECRET: ${JWT_SECRET:?JWT_SECRET must be set}
      NODE_ENV: production
      PORT: 3000
    healthcheck:
      test: ["CMD-SHELL", "node -e \"require('http').get('http://127.0.0.1:3000/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))\""]
      interval: 30s
      timeout: 5s
      start_period: 30s
      retries: 3

volumes:
  pgdata:
  redisdata:
```

### Step 3.2: 创建 .env.example (VPS 配置参考, 不含真实 secrets)

在 `/home/lovept/PtIDLE/.env.example` 创建文件：

```bash
# =============================================================================
# PtIDLE Production .env example (VPS 上 /opt/ptidle/.env)
# =============================================================================
# T-FOLLOW-5: 复制为 .env 后填真实值
#   cp .env.example .env
#   vim .env
# .env **绝不** 进 git, **绝不** 进 image
# =============================================================================

# PostgreSQL
POSTGRES_DB=ptidle
POSTGRES_USER=ptidle
DB_PASSWORD=CHANGE_ME_TO_STRONG_RANDOM_PASSWORD

# JWT (生产用, 至少 32 字符随机)
# 生成: openssl rand -base64 48
JWT_SECRET=CHANGE_ME_TO_OPENSSL_RAND_BASE64_48_OUTPUT

# Backend port (暴露到 host)
BACKEND_PORT=3000
```

### Step 3.3: 验证 docker-compose 语法

```bash
cd /home/lovept/PtIDLE && DB_PASSWORD=test JWT_SECRET=test docker compose config 2>&1 | tail -20
```

**Expected**: 输出合法 YAML, 含 4 services (postgres/redis/migrate/backend) + 2 volumes (pgdata/redisdata). 如果有 `ERROR: invalid reference` 之类的错, 修 YAML 语法

### Step 3.4: 更新 .gitignore (排除 .env)

打开 `/home/lovept/PtIDLE/.gitignore`，加：

```
.env
.env.local
.env.*.local
```

**注意**: 不要 commit .env.example — 但 .gitignore 不会误排除它（只匹配 `.env` / `.env.local` / `.env.X.local`）。

### Step 3.5: 跑全量测试确认无 regression

```bash
cd /home/lovept/PtIDLE/backend && npx jest --forceExit 2>&1 | tail -10
```

**Expected**: 42/42 suite, 702/702 test pass (此任务未改代码, 仍应通过)

### Step 3.6: Commit

```bash
cd /home/lovept/PtIDLE && git add docker-compose.yml .env.example .gitignore
git commit -m "feat(deploy): docker-compose.yml + .env.example for single-VPS deploy

T-FOLLOW-5: VPS 4-service compose 模板
- postgres / redis (本地 image + volume 持久化 + healthcheck)
- backend (GHCR image + depends_on service_healthy)
- migrate (one-shot profiles 隔离 + 同一 backend image + MIGRATIONS_DIR env)
- healthcheck 用 CMD-SHELL + node -e (alpine 无 wget/curl)

.env.example 给出 POSTGRES_DB/USER/DB_PASSWORD/JWT_SECRET/BACKEND_PORT
.gitignore 加 .env* 防止真实 secrets 误提交

docker compose config 验证语法 OK
全量 702/702 test pass (无 regression)"
```

---

## Task 4: Create scripts/deploy.sh (VPS 端部署脚本)

**Files:**
- Create: `scripts/deploy.sh` (新目录)

**背景**: GitHub Actions deploy.yml 通过 SSH 在 VPS 上跑此脚本。逻辑: pull + migrate + restart + 30s health check。

### Step 4.1: 创建 scripts 目录和 deploy.sh

```bash
mkdir -p /home/lovept/PtIDLE/scripts
```

创建 `/home/lovept/PtIDLE/scripts/deploy.sh`：

```bash
#!/bin/bash
# =============================================================================
# PtIDLE VPS deploy script
# =============================================================================
# T-FOLLOW-5: GitHub Actions deploy.yml 通过 SSH 在 VPS 上跑此脚本
# 流程: pull + migrate + restart + health check
#
# 触发: GH Actions workflow_run (release.yml 成功)
# 输入 (env): DEPLOY_TS, GITHUB_SHA
# 失败: 退出码 1, GH Actions 显示红色
# =============================================================================

set -euo pipefail

cd /opt/ptidle

echo "==> [1/4] Pull latest backend image from GHCR"
docker compose pull backend

echo "==> [2/4] Run database migrations"
docker compose run --rm migrate

echo "==> [3/4] Restart backend"
docker compose up -d backend

echo "==> [4/4] Wait for /health (max 30s)"
for i in $(seq 1 30); do
  if docker compose exec -T backend node -e "require('http').get('http://127.0.0.1:3000/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))" 2>/dev/null; then
    echo "✅ Health check passed at attempt $i (sha=${GITHUB_SHA:-unknown}, ts=${DEPLOY_TS:-unknown})"
    exit 0
  fi
  sleep 1
done

echo "❌ Health check failed after 30s"
echo "--- backend logs (last 50 lines) ---"
docker compose logs --tail=50 backend
exit 1
```

### Step 4.2: 加可执行权限

```bash
chmod +x /home/lovept/PtIDLE/scripts/deploy.sh
ls -la /home/lovept/PtIDLE/scripts/deploy.sh
```

**Expected**: `-rwxr-xr-x` 权限

### Step 4.3: bash 语法检查

```bash
bash -n /home/lovept/PtIDLE/scripts/deploy.sh 2>&1
```

**Expected**: 无输出 (语法 OK)

### Step 4.4: shellcheck (如果装了)

```bash
which shellcheck && shellcheck /home/lovept/PtIDLE/scripts/deploy.sh || echo "shellcheck not installed, skip"
```

**Expected**: 无 warning/error, 或 "shellcheck not installed, skip"

如果有 warning, 常见:
- `SC2086: Double quote to prevent globbing` — 已用 `2>/dev/null` 避免
- 其他不阻塞, 但应该修

### Step 4.5: Commit

```bash
cd /home/lovept/PtIDLE && git add scripts/deploy.sh
git commit -m "feat(deploy): scripts/deploy.sh - pull + migrate + restart + health check

T-FOLLOW-5: VPS 端部署脚本, deploy.yml 通过 SSH 调用
- 4 步骤: pull backend / run migrate / up -d / 30s health check
- 失败输出 backend logs 方便排查
- bash -n 语法检查通过
- exit 1 让 GH Actions 红色显示"
```

---

## Task 5: Create .github/workflows/deploy.yml

**Files:**
- Create: `.github/workflows/deploy.yml` (新 workflow)

**背景**: 监听 release.yml 成功事件，SSH 到 VPS 跑 deploy.sh。也支持手动 trigger（重跑 deploy 不发布）。

### Step 5.1: 创建 deploy.yml

创建 `/home/lovept/PtIDLE/.github/workflows/deploy.yml`：

```yaml
# =============================================================================
# PtIDLE Deploy Workflow
# =============================================================================
# T-FOLLOW-5: 在 T-FOLLOW-4 release.yml 之上, 加 deploy workflow
# 触发: workflow_run (release.yml 成功) + workflow_dispatch (手动)
# 行为: SSH 到 VPS + 跑 scripts/deploy.sh
# 依赖 secrets: VPS_SSH_KEY, VPS_HOST, VPS_USER
# =============================================================================

name: Deploy

on:
  workflow_run:
    workflows: ["Release"]
    types: [completed]
  workflow_dispatch:

jobs:
  deploy:
    name: Deploy to VPS
    runs-on: ubuntu-latest
    timeout-minutes: 10

    # 仅在 release.yml 成功 OR 手动 trigger 时跑
    if: >
      github.event_name == 'workflow_dispatch' ||
      github.event.workflow_run.conclusion == 'success'

    steps:
      - name: Setup deploy env vars
        run: |
          echo "DEPLOY_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> $GITHUB_ENV
          echo "GITHUB_SHA=${GITHUB_SHA::7}" >> $GITHUB_ENV

      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          script_path: scripts/deploy.sh
          envs: DEPLOY_TS,GITHUB_SHA
          command_timeout: 5m
```

### Step 5.2: YAML 验证

```bash
python3 -c "import yaml; data=yaml.safe_load(open('/home/lovept/PtIDLE/.github/workflows/deploy.yml')); print('jobs:', list(data['jobs'].keys())); print('triggers:', list(data[True].keys())); print('steps:', [s.get('name','?') for s in data['jobs']['deploy']['steps']])" 2>&1
```

**Expected**:
```
jobs: ['deploy']
triggers: ['workflow_run', 'workflow_dispatch']
steps: ['Setup deploy env vars', 'Deploy via SSH']
```

### Step 5.3: 跑全量测试确认无 regression

```bash
cd /home/lovept/PtIDLE/backend && npx jest --forceExit 2>&1 | tail -10
```

**Expected**: 42/42 suite, 702/702 test pass

### Step 5.4: Commit

```bash
cd /home/lovept/PtIDLE && git add .github/workflows/deploy.yml
git commit -m "feat(ci): deploy.yml - workflow_run trigger + SSH action

T-FOLLOW-5: deploy workflow
- 触发: workflow_run (Release success) + workflow_dispatch (手动)
- if guard: 仅 release success 或手动 trigger 才跑
- appleboy/ssh-action@v1 SSH 到 VPS (secrets.VPS_SSH_KEY)
- 跑 scripts/deploy.sh + 传 DEPLOY_TS / GITHUB_SHA env
- command_timeout 5m (VPS 上跑 ~1-3 min)
- timeout-minutes 10 (job 级兜底)

YAML 验证: 1 job (deploy), 2 triggers, 2 steps
全量 702/702 test pass (无 regression)"
```

---

## Task 6: Update docs/deploy.md (加 § 5.3)

**Files:**
- Modify: `docs/deploy.md` (在 § 5.2 后加 § 5.3)

**背景**: 让用户能找到完整 VPS CI 自动部署的步骤 (VPS 一次性配置 + secrets + 触发 deploy)。

### Step 6.1: 找到插入点

```bash
grep -n "^## " /home/lovept/PtIDLE/docs/deploy.md 2>&1
```

预期看到 `## 六、健康检查` 等章节。我们要在 § 5.2 后插 § 5.3。

### Step 6.2: 找当前 § 5.2 末尾

```bash
awk '/^## 五、部署方式$/,/^---$/' /home/lovept/PtIDLE/docs/deploy.md 2>&1 | tail -30
```

找到 docker-compose.prod.yml 章节结束处。

### Step 6.3: 插入 § 5.3

在 docker-compose.prod.yml 章节的**最后一行后**（应该是 `volumes:` 块或 `pgdata:` 行后），紧接插入：

```markdown

### 5.3 单 VPS CI 自动部署（T-FOLLOW-5）

适用：已经有一台 Linux VPS，想用 GitHub Actions 在 push tag v* 时**自动**部署。

#### 一次性 VPS 配置

```bash
# 1. 创建非 root 用户
sudo useradd -m -s /bin/bash ptidle
sudo usermod -aG docker ptidle
# ptidle 重新登录生效

# 2. 建项目目录
sudo mkdir -p /opt/ptidle && sudo chown ptidle:ptidle /opt/ptidle
cd /opt/ptidle

# 3. 从仓库复制 docker-compose.yml + .env.example
curl -fsSL -o docker-compose.yml https://raw.githubusercontent.com/YunXihb/PtIDLE/master/docker-compose.yml
curl -fsSL -o .env.example https://raw.githubusercontent.com/YunXihb/PtIDLE/master/.env.example
cp .env.example .env
vim .env   # 填 DB_PASSWORD + JWT_SECRET

# 4. 首次拉 + 启
docker compose pull
docker compose run --rm migrate
docker compose up -d

# 5. 验证
curl http://127.0.0.1:3000/health
# 预期: {"status":"ok",...}
```

#### GitHub Secrets 配置

| Secret | 例子 | 用途 |
|---|---|---|
| `VPS_SSH_KEY` | `-----BEGIN OPENSSH PRIVATE KEY-----\n...` | GitHub Actions SSH 私钥 (ed25519) |
| `VPS_HOST` | `203.0.113.42` | VPS IP 或域名 |
| `VPS_USER` | `ptidle` | VPS 上 SSH 用户 (非 root) |

**生成专用 key** (不要复用个人 key):

```bash
# 本地
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/ptidle_deploy
ssh-copy-id -i ~/.ssh/ptidle_deploy.pub ptidle@vps
# 私钥 → GitHub repo settings → Secrets → VPS_SSH_KEY
```

#### 自动部署流程

```
1. Dev: git tag v0.2.0 && git push origin v0.2.0
2. release.yml 触发 → 3-5 min build + push GHCR (4 tags)
3. release.yml success event → 触发 deploy.yml
4. deploy.yml SSH 到 VPS → 跑 scripts/deploy.sh
5. VPS: pull → migrate → restart → 30s health check
6. deploy.yml 报告 success/failure 到 GH Actions UI
```

#### 手动重跑 deploy（不发布新版本）

```bash
# GitHub UI: Actions → Deploy → Run workflow
# 或 gh CLI:
gh workflow run deploy.yml
```

#### 错误排查

```bash
# SSH 到 VPS 看完整日志
ssh ptidle@vps "cd /opt/ptidle && docker compose logs --tail=100 backend"

# 手动回滚到上一个 tag
ssh ptidle@vps "cd /opt/ptidle && docker compose pull backend:v0.1.0 && docker compose up -d backend"

# 重跑 migrations
ssh ptidle@vps "cd /opt/ptidle && docker compose run --rm migrate"
```
```

### Step 6.4: 验证文档

```bash
grep -nE "^## |^### " /home/lovept/PtIDLE/docs/deploy.md 2>&1 | head -15
```

**Expected**: 看到 `### 5.3 单 VPS CI 自动部署` 章节

### Step 6.5: Commit

```bash
cd /home/lovept/PtIDLE && git add docs/deploy.md
git commit -m "docs(deploy): add § 5.3 single-VPS CI auto deploy guide

T-FOLLOW-5: 完整 CI 自动部署文档
- VPS 一次性配置 (5 步骤)
- GitHub Secrets 配置 (3 secrets + 生成 key)
- 自动部署流程图 (6 步)
- 手动重跑 + 错误排查 + 手动回滚"
```

---

## Task 7: Update memory-bank (architecture + progress + history)

**Files:**
- Modify: `memory-bank/architecture.md` (v1.45 → v1.46, 加 T-FOLLOW-5 章节)
- Modify: `memory-bank/progress.md` (T-FOLLOW-5 移到已完成 + 新增 T-FOLLOW-6)
- Modify: `memory-bank/history.md` (追加 2026-06-22 T-FOLLOW-5 日志)

### Step 7.1: 找 architecture.md 末尾 v1.45 标记

```bash
grep -n "v1\.45\|v1\.44" /home/lovept/PtIDLE/memory-bank/architecture.md 2>&1 | tail -5
```

预期 v1.45 标记在文件末尾。

### Step 7.2: 在 v1.45 章节后插 T-FOLLOW-5 章节

打开 `architecture.md`，找到 `*文档版本：v1.45*` 这行，**前一行**插入：

```markdown
---

## T-FOLLOW-5 单 VPS 部署编排（Docker Compose + GitHub Actions SSH deploy）

### 1. 背景

T-FOLLOW-4 完成镜像 + GHCR 发布，但生产部署仍手动。T-FOLLOW-5 在 T-FOLLOW-4 之上加 deploy workflow，让 push tag v* 自动部署到单 VPS。

### 2. 用户决策

- ✅ 编排平台: **单 VPS + Docker Compose**（不是 k8s/ECS/Serverless）
- ✅ Deploy 自动化: **CI 触发 SSH deploy**（workflow_run + appleboy/ssh-action）
- ✅ DB / Redis 位置: **同 VPS, docker compose**（4 services）
- ✅ 错误处理: **方案 A — 失败手动 SSH 修**（不做 auto-rollback）
- ❌ 编排平台选型后续（k8s/ECS/Serverless）：不在本任务范围
- ❌ HTTPS / TLS / domain：T-FOLLOW-6 决定
- ❌ 监控 / alerting：T-FOLLOW-6+
- ❌ 备份：MVP 阶段不加（数据可重建）

### 3. 4 个交付物

| 文件 | 作用 |
|---|---|
| `backend/src/scripts/migrate.js` | 纯 JS 迁移 runner（替代 migrate.ts），不需 ts-node |
| `backend/Dockerfile` | 加 `COPY src/migrations /app/migrations`，SQL baked 进 image |
| `docker-compose.yml` | 4 services (postgres/redis/backend/migrate)，VPS 部署模板 |
| `.github/workflows/deploy.yml` | workflow_run trigger + SSH action |
| `scripts/deploy.sh` | VPS 上跑: pull + migrate + restart + 30s health check |
| `docs/deploy.md` | 加 § 5.3 单 VPS CI 自动部署指南 |

### 4. 关键设计决策

1. **migrate.js 替代 migrate.ts**: 生产 image 不含 ts-node (dev dep), 改纯 JS. 新增 `MIGRATIONS_DIR` env var (默认 `/app/migrations`) 让 prod image 找到 baked-in SQL
2. **migrate 复用 backend image**: 不用独立 `node:20-alpine` + bind mount, 避免 VPS 维护额外目录
3. **migrate 用 `profiles: ["migrate"]`**: 隔离 one-shot service, 平时不启, deploy 时显式 `run --rm`
4. **depends_on `condition: service_healthy`**: backend 等 PG/Redis 健康才启, 避免 cold start race
5. **healthcheck 用 `node -e`**: alpine 无 wget/curl, 跟 Dockerfile / deploy.sh 一致
6. **trigger = `workflow_run`**: 监听 release.yml 成功事件, 不独立触发, 避免「未发布就部署」
7. **方案 A 不做 auto-rollback**: solo dev, 失败时手动 SSH 修, 简单可靠; 自动回滚的 schema 兼容性问题留 TODO

### 5. 关键踩坑（deploy 调试要点）

1. **VPS 一次性配置**: 非 root 用户 + docker group, `/opt/ptidle` 目录权限
2. **GitHub Secrets**: `VPS_SSH_KEY` 是专用 key (不与个人 key 混用), `secrets.GITHUB_TOKEN` 自动给 release.yml 用
3. **image 默认 private**: 部署前需在 GHCR package settings 改 public, 否则 `docker compose pull` 401
4. **MIGRATIONS_DIR 必须显式设**: prod image baked-in 是 `/app/migrations`, 不设 env 会落到 `__dirname/../migrations = dist/migrations` (空目录, 跑报错)
5. **`docker compose exec -T`**: 交互式 TTY 在 SSH + workflow_run 场景会卡, 用 `-T` 禁用
6. **workflow_run 的 `conclusion`**: 在 if guard 里要明确 `conclusion == 'success'`, 否则 cancelled/failed release 也会触发 deploy
7. **`if-no-files-found: warn` 已弃用**: workflow_run 触发时 artifacts 可能不存在, 用 `if: github.event_name == 'workflow_dispatch' || ...success`

### 6. 镜像 baked migrations 的优势

| 维度 | 旧 (migrate.ts + bind mount) | 新 (migrate.js + baked) |
|---|---|---|
| 镜像大小 | + node:20-alpine (~50MB) | 0 (复用 backend image) |
| 部署时间 | npm ci ~60s | 0 (image 内已含) |
| VPS 维护 | 需 backend-migrations 目录 | 无 |
| Schema 漂移风险 | bind mount 跟 image 可能不同步 | 原子一致 (同 image) |

### 7. 未来增强（明确不做 / 留 TODO）

- ❌ **HTTPS / TLS**: T-FOLLOW-6 用 Caddy / nginx + Let's Encrypt
- ❌ **Domain 绑定**: T-FOLLOW-6
- ❌ **自动回滚**: T-FOLLOW-7+ (记录 .last-good tag + health check fail 时 restore)
- ❌ **备份策略**: T-FOLLOW-8+ (daily pg_dump → B2 / S3)
- ❌ **监控**: T-FOLLOW-9+ (UptimeRobot + GH Actions scheduled health check)
- ❌ **镜像签名 / 扫描**: T-FOLLOW-10+ (cosign / trivy)
- ❌ **Distroless 镜像**: T-FOLLOW-11+ (体积优化)
- ❌ **HA / multi-instance**: T-FOLLOW-12+ (load balancer + 2 VPS, 仅在用户量到时考虑)

### 8. 测试覆盖

- **单元测试**: migrate.js 9/9 (8 原有 + 1 新增 MIGRATIONS_DIR env var), 全量 42/42 suite, 702/702 test pass
- **集成测试**: 本地 `docker build` + `docker run ls /app/migrations` 验证 baked
- **真实验证**: 用户 push v* tag 触发完整 deploy 链路 → 看到 GH Actions success

---

```

然后把 `*文档版本：v1.45*` 改为 `*文档版本：v1.46*`，把 `*最后更新：2026-06-22*` 保留 (或者更新到今天)。

### Step 7.3: 更新 progress.md

打开 `memory-bank/progress.md`，做 3 处改动:

1. **「待开发」表** —— 把 `T-FOLLOW-5` 替换为 `T-FOLLOW-6`:

```markdown
| T-FOLLOW-6 | HTTPS / TLS / domain + 自动回滚 + 备份 + 监控 | T-FOLLOW-5 完成单 VPS CI 自动部署, 但生产级仍缺 4 件事。**待办**：(1) HTTPS (Caddy / nginx + Let's Encrypt) + domain 配置；(2) 自动回滚（记录 .last-good tag + health check fail 时 restore）；(3) 备份策略（daily pg_dump → Backblaze B2 / S3）；(4) 监控 (UptimeRobot free tier + GH Actions scheduled health check) |
```

2. **「已完成」表** —— 在最后一行加 T-FOLLOW-5:

```markdown
| T-FOLLOW-5 | 单 VPS 部署编排（migrate.js 重写 + Dockerfile baked migrations + docker-compose 4 services + deploy.yml workflow_run trigger + scripts/deploy.sh + docs/deploy.md § 5.3） | 2026-06-22 |
```

3. **「问题与解决」表** —— 在最后加一行:

```markdown
| 2026-06-22 | T-FOLLOW-5 docker-compose `migrate` service 复杂度问题：原方案用独立 `node:20-alpine` + bind mount, VPS 上需维护 `backend-migrations` 子目录, `npm ci` 每次 deploy ~60s 浪费时间 | 改用同一 backend image + `MIGRATIONS_DIR=/app/migrations` env var, image baked-in SQL 文件, 避免 bind mount 和重复装包 |
```

### Step 7.4: 更新 history.md

打开 `memory-bank/history.md`，在文件末尾追加：

```markdown
---

## 2026-06-22 - 任务：T-FOLLOW-5 单 VPS 部署编排（migrate.js + Dockerfile + docker-compose + deploy workflow）

### Prompt
T-FOLLOW-4 完成镜像 + GHCR + deploy docs, 但生产部署仍手动。**待办**: (1) 选编排平台 (用户选单 VPS); (2) CI 触发 SSH deploy (workflow_run + appleboy/ssh-action); (3) docker-compose 4 services (postgres/redis/backend/migrate); (4) 写 deploy.sh + deploy.yml; (5) docs/deploy.md 加 § 5.3; (6) memory-bank 同步。

### 思考
**关键决策路径**:
1. **migrate.ts → migrate.js** — 生产 image 不含 ts-node, 改纯 JS. 新增 MIGRATIONS_DIR env var 让 prod image 从 baked-in `/app/migrations` 读 SQL
2. **migrate 复用 backend image** — 不用独立 node:20-alpine + bind mount, 避免 VPS 维护额外目录 + 每次 deploy 重 npm ci ~60s
3. **4 services compose** — postgres/redis/backend/migrate, migrate 用 profiles 隔离 one-shot
4. **healthcheck 一致性** — Dockerfile, docker-compose, deploy.sh 全部用 `node -e "http.get(...)"` (alpine 无 wget/curl)
5. **trigger = workflow_run** — 监听 release.yml success, 不独立触发, 避免「未发布就部署」
6. **方案 A — 无 auto-rollback** — solo dev, 失败时手动 SSH 修, 简单可靠

**架构亮点**:
- image baked migrations: 原子一致 (同 image), 无 schema 漂移风险
- 同一 image 多用途: backend + migrate 共用, 减少 50MB alpine 镜像
- profiles 隔离: 平时不启 migrate, deploy 时显式 `run --rm`
- depends_on `condition: service_healthy`: backend 等 PG/Redis ready 才启, 避免 cold start race

**踩坑**:
1. `docker compose exec -T` 必须用 `-T` 禁用 TTY (SSH + workflow_run 场景)
2. workflow_run if guard 需 `conclusion == 'success'`, 否则 cancelled release 也会触发 deploy
3. MIGRATIONS_DIR 不显式设会落到 `__dirname/../migrations = dist/migrations` (空目录, 跑报错)
4. package.json 改用 `node src/scripts/migrate.js` (不再用 ts-node), dev 也受益 (启动快 1-2s)

### 意外
1. **T-FOLLOW-4 的 image 默认 private** — `docker compose pull` 在 VPS 上 401, 用户需手动在 GHCR package settings 改 public. 文档化在 docs/deploy.md § 5.3
2. **spec self-review 发现 healthcheck test 行写错** — 初始版 `["CMD", "node", "-e "]` 缺 JS 代码, 修正为 `CMD-SHELL` + 完整 inline script
3. **migrate 复用 backend image 节省 ~50MB + 60s/deploy** — 替代方案独立 alpine image 多 50MB, 且每次 deploy `npm ci` ~60s

### 修复
- 新增 5 文件: `backend/src/scripts/migrate.js`, `docker-compose.yml`, `.env.example`, `scripts/deploy.sh`, `.github/workflows/deploy.yml`
- 改 5 文件: `backend/Dockerfile`, `backend/package.json`, `.gitignore`, `docs/deploy.md`, `memory-bank/{architecture,progress,history}.md`
- 删除 1 文件: `backend/src/scripts/migrate.ts` (被 migrate.js 替代)
- 测试: 9/9 migrate (含 1 新增 MIGRATIONS_DIR env var), 全量 42/42 suite / 702/702 test pass

### 验证
- `npx jest --forceExit` → **42/42 suite, 702/702 test 全绿** (无 regression)
- `python3 -c "import yaml; yaml.safe_load(...release.yml)"` → valid
- `python3 -c "import yaml; yaml.safe_load(...deploy.yml)"` → valid
- `docker build -t ptidle-backend:deploy-test .` → 成功
- `docker run --rm ptidle-backend:deploy-test ls /app/migrations` → 9 SQL 文件
- `docker compose config` (with test env) → valid YAML, 4 services + 2 volumes
- `bash -n scripts/deploy.sh` → 语法 OK
- **真实验证**: 用户 push v* tag → 完整 deploy 链路 (待 push 后验证)

### 范围外（明确不做 / T-FOLLOW-6+）
- HTTPS / TLS / domain (T-FOLLOW-6)
- 自动回滚 (T-FOLLOW-7+)
- 备份 (T-FOLLOW-8+)
- 监控 (T-FOLLOW-9+)
- 镜像签名 / 扫描 (T-FOLLOW-10+)
- Distroless 镜像 (T-FOLLOW-11+)
- HA / multi-instance (T-FOLLOW-12+, 仅在用户量到时考虑)
```

### Step 7.5: 跑全量测试 + 验证文件结构

```bash
cd /home/lovept/PtIDLE/backend && npx jest --forceExit 2>&1 | tail -5
echo "---"
cd /home/lovept/PtIDLE && git status 2>&1
```

**Expected**: 42/42 suite pass, working tree 显示 memory-bank 3 个文件 modified

### Step 7.6: Commit

```bash
cd /home/lovept/PtIDLE && git add memory-bank/architecture.md memory-bank/progress.md memory-bank/history.md
git commit -m "docs(memory-bank): T-FOLLOW-5 单 VPS 部署编排 (architecture v1.46)

- architecture.md v1.45 → v1.46, 加 T-FOLLOW-5 完整章节 (8 节):
  背景 / 用户决策 / 4 交付物 / 关键设计 / 踩坑 / baked migrations 优势 / 未来增强 / 测试
- progress.md: T-FOLLOW-5 移入已完成 + 新增 T-FOLLOW-6
- history.md: 追加 2026-06-22 T-FOLLOW-5 完整日志 (Prompt/思考/意外/修复/验证/范围外)

全量 702/702 test pass (无 regression)"
```

---

## Task 8: Real deployment verification (用户手动步骤)

**Files:** 无 (用户操作)

**背景**: plan 至此, 全部代码就绪。用户需要:
1. VPS 一次性配置 (按 docs/deploy.md § 5.3)
2. GitHub Secrets 配 3 个 (VPS_SSH_KEY / VPS_HOST / VPS_USER)
3. 触发首次 deploy

### Step 8.1: VPS 一次性配置 (10-15 min)

按 `docs/deploy.md § 5.3 一次性 VPS 配置` 逐步执行:

```bash
# VPS 上
sudo useradd -m -s /bin/bash ptidle
sudo usermod -aG docker ptidle
sudo mkdir -p /opt/ptidle && sudo chown ptidle:ptidle /opt/ptidle
# ptidle 重新登录
su - ptidle
cd /opt/ptidle
curl -fsSL -o docker-compose.yml https://raw.githubusercontent.com/YunXihb/PtIDLE/master/docker-compose.yml
curl -fsSL -o .env.example https://raw.githubusercontent.com/YunXihb/PtIDLE/master/.env.example
cp .env.example .env
vim .env   # 填 DB_PASSWORD + JWT_SECRET (强随机)
docker compose pull
docker compose run --rm migrate
docker compose up -d
curl http://127.0.0.1:3000/health
# 预期: {"status":"ok",...}
```

### Step 8.2: GitHub Secrets 配置 (5 min)

https://github.com/YunXihb/PtIDLE/settings/secrets/actions

新增 3 secrets:
- `VPS_SSH_KEY` (专用 ed25519 私钥, 不是个人 key)
- `VPS_HOST` (VPS IP)
- `VPS_USER` = `ptidle`

### Step 8.3: Trigger first deploy (3-5 min)

```bash
# 本地
cd /home/lovept/PtIDLE
# 改 1 行代码触发 commit
echo "<!-- T-FOLLOW-5 deploy trigger -->" >> docs/deploy.md
git add docs/deploy.md
git commit -m "chore: trigger T-FOLLOW-5 first deploy"
git tag v0.1.1
git push origin master
git push origin v0.1.1
```

**观察**:
- `release.yml` 跑 (T-FOLLOW-4 已就绪) → ~3:19 build + push GHCR
- `deploy.yml` 自动触发 (workflow_run) → SSH 到 VPS + 跑 deploy.sh
- 预期: 看到 GH Actions 绿色 ✅, VPS 上 backend 容器用新 image

### Step 8.4: 验证 deploy 成功

```bash
# GH Actions UI
https://github.com/YunXihb/PtIDLE/actions

# 看 Deploy workflow run (latest)
# 看 Jobs → Deploy to VPS → Deploy via SSH → 看到 ✅

# VPS 上
ssh ptidle@vps "cd /opt/ptidle && docker compose ps"
# 预期: backend 容器 running, 镜像 v0.1.1

ssh ptidle@vps "curl -s http://127.0.0.1:3000/health"
# 预期: {"status":"ok",...}
```

### Step 8.5: 记录首次 deploy 结果

在 `memory-bank/history.md` 末尾追加:

```markdown
### 2026-06-22 T-FOLLOW-5 首次 deploy 验证
- v0.1.1 push → release.yml (3:19) → deploy.yml (workflow_run) → SSH → deploy.sh → ✅
- VPS 端: backend 容器 running, 镜像 v0.1.1, /health 200
- 完整 deploy 链路闭环
```

Commit:

```bash
cd /home/lovept/PtIDLE && git add memory-bank/history.md
git commit -m "docs(memory-bank): record T-FOLLOW-5 first deploy success

v0.1.1 push 触发完整 deploy 链路 (release + workflow_run + SSH + deploy.sh)
→ GH Actions green + VPS backend 容器 running + /health 200
→ 闭环: T-FOLLOW-4 (CI/CD 镜像层) + T-FOLLOW-5 (部署层) 全部跑通"
```

---

## 总结

| 任务 | 状态 | 时间预估 |
|---|---|---|
| 1. migrate.ts → migrate.js | 🟡 待执行 | 30-45 min (含 TDD) |
| 2. Dockerfile baked migrations | 🟡 待执行 | 10-15 min |
| 3. docker-compose.yml + .env.example | 🟡 待执行 | 15-20 min |
| 4. scripts/deploy.sh | 🟡 待执行 | 10 min |
| 5. .github/workflows/deploy.yml | 🟡 待执行 | 10 min |
| 6. docs/deploy.md § 5.3 | 🟡 待执行 | 15 min |
| 7. memory-bank 更新 | 🟡 待执行 | 20 min |
| 8. 真实 deploy 验证 (用户操作) | 🟡 待执行 | 30-45 min |
| **总计** | | **~2.5-3.5 小时** |

---

*Plan 版本：v1.0*
*创建日期：2026-06-22*
*Spec 关联：T-FOLLOW-5 orchestration platform + deploy workflow*
