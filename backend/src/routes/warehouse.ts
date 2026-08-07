import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { getWarehouseData } from '../services/warehouseService';
import { ok, fail } from '../utils/http';

const router = Router();

// 获取玩家仓库数据
router.get('/', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      fail(res, 401, 'Unauthorized');
      return;
    }

    const warehouse = await getWarehouseData(userId);

    if (!warehouse) {
      fail(res, 404, 'Player not found');
      return;
    }

    ok(res, {
      resources: warehouse.resources,
      materials: warehouse.materials,
      storageLimits: warehouse.storageLimits,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
