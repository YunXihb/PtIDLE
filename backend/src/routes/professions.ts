import { Router } from 'express';
import { getAllProfessions, getProfessionByName } from '../services/professionService';
import { ok, fail } from '../utils/http';

const router = Router();

// 获取所有职业
router.get('/', async (req, res) => {
  try {
    const professions = await getAllProfessions();
    ok(res, professions);
  } catch (error) {
    console.error('Error fetching professions:', error);
    fail(res, 500, 'Failed to fetch professions');
  }
});

// 获取单个职业
router.get('/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const profession = await getProfessionByName(name);

    if (!profession) {
      fail(res, 404, 'Profession not found');
      return;
    }

    ok(res, profession);
  } catch (error) {
    console.error('Error fetching profession:', error);
    fail(res, 500, 'Failed to fetch profession');
  }
});

export default router;
