import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { getAllCardTemplates, getCardTemplateById, getPlayerCards } from '../services/cardService';
import { query } from '../config/database';

const router = Router();

// 获取所有卡牌模板（无需认证）
router.get('/', async (_req, res) => {
  try {
    const cardTemplates = await getAllCardTemplates();

    res.json({
      success: true,
      data: cardTemplates,
    });
  } catch (error) {
    console.error('Error fetching card templates:', error);
    res.status(500).json({ error: 'Failed to fetch card templates' });
  }
});

// 获取单个卡牌模板（无需认证）
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const cardTemplate = await getCardTemplateById(id);

    if (!cardTemplate) {
      res.status(404).json({ error: 'Card template not found' });
      return;
    }

    res.json({
      success: true,
      data: cardTemplate,
    });
  } catch (error) {
    console.error('Error fetching card template:', error);
    res.status(500).json({ error: 'Failed to fetch card template' });
  }
});

// 获取玩家拥有的所有卡牌（需要认证）
router.get('/my/list', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // 获取玩家 ID
    const playerResult = await query<{ id: string }>(
      'SELECT id FROM players WHERE user_id = $1',
      [userId]
    );

    if (playerResult.length === 0) {
      res.status(404).json({ error: 'Player not found' });
      return;
    }

    const playerId = playerResult[0].id;

    // 获取分页参数
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 50;

    // 查询玩家卡牌
    const result = await getPlayerCards({ playerId, page, pageSize });

    res.json({
      success: true,
      data: result.cards,
      pagination: {
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        totalPages: result.totalPages,
      },
    });
  } catch (error) {
    console.error('Error fetching player cards:', error);
    res.status(500).json({ error: 'Failed to fetch player cards' });
  }
});

export default router;
