import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { testConnection as testDb } from './config/database';
import { connectRedis } from './config/redis';
import authRoutes from './routes/auth';
import playerRoutes from './routes/player';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/player', playerRoutes);

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

export default app;
