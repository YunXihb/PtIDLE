-- PtIDLE 数据库 migration 005
-- T039 战士「挑战」嘲讽卡 seed
-- 日期: 2026-06-10

-- 现有 7 张卡 (template_no 1-7)，下一张 template_no=8
INSERT INTO card_templates (
  name, description, type, cost, effect, profession, template_no, max_quantity
) VALUES (
  '挑战',
  '嘲讽3格内一个敌方单位，该单位本回合所有攻击必须指定该战士',
  'tactical',
  1,
  '{"type":"taunt","range":3,"duration":1,"target":"single_enemy"}'::jsonb,
  'warrior',
  8,
  5
) ON CONFLICT DO NOTHING;
