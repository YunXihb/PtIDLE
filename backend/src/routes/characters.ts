import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { createCharacter, getCharactersByUserId } from '../services/characterService';

const router = Router();

// 获取玩家所有棋子
router.get('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const characters = await getCharactersByUserId(userId);

    res.json({
      success: true,
      data: characters,
    });
  } catch (error) {
    console.error('Error fetching characters:', error);
    res.status(500).json({ error: 'Failed to fetch characters' });
  }
});

// 创建棋子
router.post('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { name, profession } = req.body;

    // 验证输入
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ error: 'Character name is required' });
      return;
    }

    if (!profession || !['warrior', 'ranger', 'mage'].includes(profession)) {
      res.status(400).json({ error: 'Invalid profession. Must be warrior, ranger, or mage' });
      return;
    }

    const result = await createCharacter(userId, name.trim(), profession);

    if (!result.success) {
      if (result.error === 'Player not found') {
        res.status(404).json({ error: result.error });
        return;
      }
      if (result.error?.includes('Maximum character limit')) {
        res.status(400).json({ error: result.error });
        return;
      }
      res.status(400).json({ error: result.error });
      return;
    }

    res.status(201).json({
      success: true,
      data: result.character,
    });
  } catch (error) {
    console.error('Error creating character:', error);
    res.status(500).json({ error: 'Failed to create character' });
  }
});

export default router;
