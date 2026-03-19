import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { testConnection as testDb } from './config/database';
import { connectRedis } from './config/redis';
import authRoutes from './routes/auth';
import playerRoutes from './routes/player';
import gatheringRoutes from './routes/gathering';
import skillsRoutes from './routes/skills';
import processingRoutes from './routes/processing';
import craftingRoutes from './routes/crafting';
import warehouseRoutes from './routes/warehouse';
import professionRoutes from './routes/professions';
import { query } from './config/database';
import { checkAndCompleteGathering, initializeGatheringConfig, processDueGatheringTasks } from './services/gatheringService';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/player', playerRoutes);
app.use('/api/gathering', gatheringRoutes);
app.use('/api/skills', skillsRoutes);
app.use('/api/processing', processingRoutes);
app.use('/api/crafting', craftingRoutes);
app.use('/api/warehouse', warehouseRoutes);
app.use('/api/professions', professionRoutes);

// Health check
app.get('/health', async (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      database: 'unknown',
      redis: 'unknown'
    }
  });
});

// Initialize connections
async function initializeApp() {
  try {
    // Test database connection
    await testDb();

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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  initializeApp();
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

export default app;
