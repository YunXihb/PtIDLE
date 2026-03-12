import { Router } from 'express';
import { getAllGatheringSkills, getGatheringSkillByType } from '../services/skillService';

const router = Router();

// 获取所有采集技能
router.get('/gathering', async (req, res) => {
  try {
    const skills = await getAllGatheringSkills();
    res.json({ success: true, data: skills });
  } catch (error) {
    console.error('Error fetching gathering skills:', error);
    res.status(500).json({ error: 'Failed to fetch gathering skills' });
  }
});

// 获取单个采集技能
router.get('/gathering/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const skill = await getGatheringSkillByType(type);

    if (!skill) {
      res.status(404).json({ error: 'Skill not found' });
      return;
    }

    res.json({ success: true, data: skill });
  } catch (error) {
    console.error('Error fetching gathering skill:', error);
    res.status(500).json({ error: 'Failed to fetch gathering skill' });
  }
});

export default router;
