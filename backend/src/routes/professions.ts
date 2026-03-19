import { Router } from 'express';
import { getAllProfessions, getProfessionByName } from '../services/professionService';

const router = Router();

// 获取所有职业
router.get('/', async (req, res) => {
  try {
    const professions = await getAllProfessions();
    res.json({ success: true, data: professions });
  } catch (error) {
    console.error('Error fetching professions:', error);
    res.status(500).json({ error: 'Failed to fetch professions' });
  }
});

// 获取单个职业
router.get('/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const profession = await getProfessionByName(name);

    if (!profession) {
      res.status(404).json({ error: 'Profession not found' });
      return;
    }

    res.json({ success: true, data: profession });
  } catch (error) {
    console.error('Error fetching profession:', error);
    res.status(500).json({ error: 'Failed to fetch profession' });
  }
});

export default router;
