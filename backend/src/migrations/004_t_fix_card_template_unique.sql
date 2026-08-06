-- PtIDLE 数据库 migration 004
-- T-FIX: 卡牌模板唯一性约束（此前缺失，导致种子数据的 ON CONFLICT DO NOTHING 失效）
-- 日期: 2026-08-06

-- 背景:
--   card_templates 自 002 起有 template_no 编码，但从未加 UNIQUE 约束。
--   005/006 等种子的 `ON CONFLICT DO NOTHING` 因无冲突目标而不生效，
--   一旦迁移系统被绕过重跑会产生重复行（同名卡 / 同编码卡）。
--   此外 002 把新卡 template_no 默认设为 0，历史数据中可能有多张未命名编码的卡
--   共享 template_no=0，直接建约束会失败 → 先回填再建约束。

-- 1. 回填未分配的 template_no（避免 0 值重复导致唯一约束失败）
--    仅处理 template_no = 0 的行，按 created_at 顺序分配不冲突的编码。
DO $$
DECLARE
  r RECORD;
  next_no INTEGER;
BEGIN
  FOR r IN
    SELECT id FROM card_templates
    WHERE template_no = 0 OR template_no IS NULL
    ORDER BY created_at ASC
  LOOP
    SELECT COALESCE(MAX(template_no), 0) + 1 INTO next_no FROM card_templates;
    UPDATE card_templates SET template_no = next_no WHERE id = r.id;
  END LOOP;
END $$;

-- 2. template_no 唯一约束（幂等）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_card_templates_template_no'
  ) THEN
    ALTER TABLE card_templates
      ADD CONSTRAINT uq_card_templates_template_no UNIQUE (template_no);
  END IF;
END $$;

-- 3. name 唯一约束（幂等；name 用于 seed 冲突目标）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_card_templates_name'
  ) THEN
    ALTER TABLE card_templates
      ADD CONSTRAINT uq_card_templates_name UNIQUE (name);
  END IF;
END $$;

-- 4. gathering_skills.name 唯一约束（001 种子 ON CONFLICT DO NOTHING 之前失效，补约束）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_gathering_skills_name'
  ) THEN
    ALTER TABLE gathering_skills
      ADD CONSTRAINT uq_gathering_skills_name UNIQUE (name);
  END IF;
END $$;

-- 5. processing_recipes.name 唯一约束（同上）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_processing_recipes_name'
  ) THEN
    ALTER TABLE processing_recipes
      ADD CONSTRAINT uq_processing_recipes_name UNIQUE (name);
  END IF;
END $$;
