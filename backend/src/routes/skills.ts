import { Router } from 'express';
import { getAllGatheringSkills, getGatheringSkillByType } from '../services/skillService';
import { ok, fail } from '../utils/http';

const router = Router();

// 获取所有采集技能
router.get('/gathering', async (req, res) => {
  try {
    const skills = await getAllGatheringSkills();
    ok(res, skills);
  } catch (error) {
    console.error('Error fetching gathering skills:', error);
    fail(res, 500, 'Failed to fetch gathering skills');
  }
});

// 获取单个采集技能
router.get('/gathering/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const skill = await getGatheringSkillByType(type);

    if (!skill) {
      fail(res, 404, 'Skill not found');
      return;
    }

    ok(res, skill);
  } catch (error) {
    console.error('Error fetching gathering skill:', error);
    fail(res, 500, 'Failed to fetch gathering skill');
  }
});

export default router;
