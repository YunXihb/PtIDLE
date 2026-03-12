import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { getWarehouseData } from '../services/warehouseService';

const router = Router();

// 获取玩家仓库数据
router.get('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const warehouse = await getWarehouseData(userId);

    if (!warehouse) {
      res.status(404).json({ error: 'Player not found' });
      return;
    }

    res.json({
      success: true,
      data: {
        resources: warehouse.resources,
        materials: warehouse.materials,
        storageLimits: warehouse.storageLimits,
      },
    });
  } catch (error) {
    console.error('Error fetching warehouse data:', error);
    res.status(500).json({ error: 'Failed to fetch warehouse data' });
  }
});

export default router;
