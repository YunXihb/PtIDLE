import express from 'express';
import cors from 'cors';
import compression from 'compression';
import dotenv from 'dotenv';
import http from 'http';
import { Server as IOServer } from 'socket.io';
import { testConnection as testDb, pool } from './config/database';
import { connectRedis, disconnectRedis, redisClient } from './config/redis';
import authRoutes from './routes/auth';
import battleRoutes from './routes/battle';
import playerRoutes from './routes/player';
import gatheringRoutes from './routes/gathering';
import matchmakingRoutes from './routes/matchmaking';
import skillsRoutes from './routes/skills';
import processingRoutes from './routes/processing';
import craftingRoutes from './routes/crafting';
import warehouseRoutes from './routes/warehouse';
import professionRoutes from './routes/professions';
import characterRoutes from './routes/characters';
import cardRoutes from './routes/cards';
import { initializeGatheringConfig, processDueGatheringTasks } from './services/gatheringService';
import { initializeSocketServer } from './socket/socketServer';
import { checkMigrationsStatus } from './scripts/migrate';
import { errorHandler } from './middleware/errorHandler';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
// CORS：默认全开（开发期），生产用 CORS_ORIGIN 环境变量收敛
const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim())
  : '*';
app.use(cors({ origin: corsOrigin }));
app.use(express.json());
// T082: HTTP 响应压缩（gzip）。API JSON 响应（卡牌模板/玩家数据/战斗状态）可较大，
// 开启后按 Accept-Encoding 协商压缩，显著降低传输体积。静态资源若后续由后端托管同样受益。
app.use(compression());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/battle', battleRoutes);
app.use('/api/player', playerRoutes);
app.use('/api/gathering', gatheringRoutes);
app.use('/api/match', matchmakingRoutes);
app.use('/api/skills', skillsRoutes);
app.use('/api/processing', processingRoutes);
app.use('/api/crafting', craftingRoutes);
app.use('/api/warehouse', warehouseRoutes);
app.use('/api/professions', professionRoutes);
app.use('/api/characters', characterRoutes);
app.use('/api/cards', cardRoutes);

// Health check
app.get('/health', async (_req, res) => {
  let database: 'ok' | 'unknown' | 'down' = 'unknown';
  let redis: 'ok' | 'unknown' | 'down' = 'unknown';

  try {
    const client = await pool.connect();
    await client.query('SELECT NOW()');
    client.release();
    database = 'ok';
  } catch {
    database = 'down';
  }

  try {
    const pong = await redisClient.ping();
    redis = pong === 'PONG' ? 'ok' : 'down';
  } catch {
    redis = 'down';
  }

  const allOk = database === 'ok' && redis === 'ok';
  res.status(allOk ? 200 : 503).json({
    status: allOk ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    services: { database, redis },
  });
});

// 全局错误处理中间件：统一 JSON 错误格式（ApiError 按 status / ZodError 400 / 其它 500）
// 详见 src/middleware/errorHandler.ts
app.use(errorHandler);

// Initialize connections
async function initializeApp() {
  try {
    // Test database connection
    await testDb();

    // T-FOLLOW-2: 启动期检测 migrations 状态（fail-open，缺时只 warn 不阻塞）
    await warnIfMigrationsPending();

    // Connect to Redis
    await connectRedis();

    // Initialize gathering config from database
    await initializeGatheringConfig();

    // 启动采集任务检查定时器（每10秒检查一次）
    startGatheringChecker();

    console.log('✅ All services initialized');
  } catch (error) {
    console.error('❌ Failed to initialize services:', error);
    process.exit(1);
  }
}

/**
 * T-FOLLOW-2: 启动期检查 migrations 状态
 * - 全部已 applied → 静默通过
 * - 有 pending → console.warn 列出 missing 文件 + 提示运行 `npm run db:migrate`
 * - DB 错误 → console.error（fail-open，不阻塞启动）
 */
async function warnIfMigrationsPending(): Promise<void> {
  const status = await checkMigrationsStatus();
  if (!status.ok) {
    // DB 不可达 / 权限不足 — 不阻塞，但提示
    console.error(`[migrations] ⚠️  Failed to check migration status: ${status.error}`);
    console.error(`[migrations]    Server will start anyway. Run 'npm run db:migrate' manually.`);
    return;
  }
  if (status.hasPending) {
    console.warn(`\n[migrations] ⚠️  ${status.pending} pending migration(s) detected:`);
    for (const m of status.missing) {
      console.warn(`[migrations]    ○ ${m}`);
    }
    console.warn(`[migrations]    Run 'npm run db:migrate' to apply.\n`);
  }
  // 全部已 applied → 静默（不刷日志）
}

// T045: 同一 HTTP server 挂 WebSocket,共享端口 + CORS（与 REST 共用 CORS_ORIGIN）
const httpServer = http.createServer(app);
const io = new IOServer(httpServer, {
  cors: { origin: corsOrigin },
});

httpServer.listen(PORT, () => {
  console.log(`HTTP+WS server running on port ${PORT}`);
  initializeApp();
  initializeSocketServer(io);
});

// 采集任务检查定时器（使用 Redis 队列）
async function startGatheringChecker(): Promise<void> {
  // 每10秒检查一次 Redis 队列中的到期任务
  setInterval(async () => {
    try {
      const processed = await processDueGatheringTasks();
      if (processed > 0) {
        console.log(`[Gathering] Processed ${processed} completed tasks from Redis queue`);
      }
    } catch (error) {
      console.error('[Gathering] Error processing gathering tasks from Redis queue:', error);
    }
  }, 10000);
}

// T082: 优雅关闭。Docker 发 SIGTERM（stop/recreate）时清理资源，避免泄漏 PG/Redis 连接
// 与僵尸 socket。io.close() 关闭 Socket.IO + 底层 HTTP server（停止接受新连接）。
let shuttingDown = false;
async function gracefulShutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[shutdown] ${signal} received, closing server...`);
  try {
    io.close();
  } catch (e) {
    console.error('[shutdown] Socket.IO close error:', (e as Error).message);
  }
  try {
    await pool.end();
    console.log('[shutdown] PG pool closed');
  } catch (e) {
    console.error('[shutdown] PG pool close error:', (e as Error).message);
  }
  try {
    await disconnectRedis();
    console.log('[shutdown] Redis disconnected');
  } catch (e) {
    console.error('[shutdown] Redis disconnect error:', (e as Error).message);
  }
  console.log('[shutdown] done, exiting');
  process.exit(0);
}

process.on('SIGTERM', () => { void gracefulShutdown('SIGTERM'); });
process.on('SIGINT', () => { void gracefulShutdown('SIGINT'); });

export default app;
