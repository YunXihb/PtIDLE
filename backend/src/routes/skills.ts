import { Router } from 'express';
import { getAllGatheringSkills, getGatheringSkillByType } from '../services/skillService';
import { ok, fail } from '../utils/http';

const router = Router();

// 获取所有采集技能
router.get('/gathering', async (_req, res, next) => {
  try {
    const skills = await getAllGatheringSkills();
    ok(res, skills);
  } catch (error) {
    next(error);
  }
});

// 获取单个采集技能
router.get('/gathering/:type', async (req, res, next) => {
  try {
    const { type } = req.params;
    const skill = await getGatheringSkillByType(type);

    if (!skill) {
      fail(res, 404, 'Skill not found');
      return;
    }

    ok(res, skill);
  } catch (error) {
    next(error);
  }
});

export default router;
