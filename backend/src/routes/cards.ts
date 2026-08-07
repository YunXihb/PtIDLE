import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { getAllCardTemplates, getCardTemplateById, getPlayerCards, getPublicPoolCards } from '../services/cardService';
import { query } from '../config/database';
import { ok, fail } from '../utils/http';

const router = Router();

// 获取所有卡牌模板（无需认证）
router.get('/', async (_req, res) => {
  try {
    const cardTemplates = await getAllCardTemplates();

    ok(res, cardTemplates);
  } catch (error) {
    console.error('Error fetching card templates:', error);
    fail(res, 500, 'Failed to fetch card templates');
  }
});

// T1001：获取战棋公共池卡牌（无需认证；放 /:id 之前以避免被贪婪匹配）
router.get('/public-pool', async (_req, res) => {
  try {
    const poolCards = await getPublicPoolCards();
    ok(res, poolCards);
  } catch (error) {
    console.error('Error fetching public pool cards:', error);
    fail(res, 500, 'Failed to fetch public pool cards');
  }
});

// 获取单个卡牌模板（无需认证）
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const cardTemplate = await getCardTemplateById(id);

    if (!cardTemplate) {
      fail(res, 404, 'Card template not found');
      return;
    }

    ok(res, cardTemplate);
  } catch (error) {
    console.error('Error fetching card template:', error);
    fail(res, 500, 'Failed to fetch card template');
  }
});

// 获取玩家拥有的所有卡牌（需要认证）
router.get('/my/list', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      fail(res, 401, 'Unauthorized');
      return;
    }

    // 获取玩家 ID
    const playerResult = await query<{ id: string }>(
      'SELECT id FROM players WHERE user_id = $1',
      [userId]
    );

    if (playerResult.length === 0) {
      fail(res, 404, 'Player not found');
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
    fail(res, 500, 'Failed to fetch player cards');
  }
});

export default router;
