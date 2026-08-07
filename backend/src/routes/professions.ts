import { Router } from 'express';
import { getAllProfessions, getProfessionByName } from '../services/professionService';
import { ok, fail } from '../utils/http';

const router = Router();

// 获取所有职业
router.get('/', async (_req, res, next) => {
  try {
    const professions = await getAllProfessions();
    ok(res, professions);
  } catch (error) {
    next(error);
  }
});

// 获取单个职业
router.get('/:name', async (req, res, next) => {
  try {
    const { name } = req.params;
    const profession = await getProfessionByName(name);

    if (!profession) {
      fail(res, 404, 'Profession not found');
      return;
    }

    ok(res, profession);
  } catch (error) {
    next(error);
  }
});

export default router;
