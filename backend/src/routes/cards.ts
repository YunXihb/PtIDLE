import { Router } from 'express';
import { getAllCardTemplates, getCardTemplateById } from '../services/cardService';

const router = Router();

// 获取所有卡牌模板
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

// 获取单个卡牌模板
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

export default router;
