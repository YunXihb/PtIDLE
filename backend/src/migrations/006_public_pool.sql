-- PtIDLE 数据库 migration 006
-- T1001 战棋公共池系统
-- 日期: 2026-06-10

-- ========================================
-- 1. card_templates 加 is_public_pool 列
-- ========================================
ALTER TABLE card_templates
  ADD COLUMN IF NOT EXISTS is_public_pool BOOLEAN NOT NULL DEFAULT FALSE;

-- 加索引加速公共池查询
CREATE INDEX IF NOT EXISTS idx_card_templates_public_pool
  ON card_templates(is_public_pool) WHERE is_public_pool = TRUE;

-- ========================================
-- 2. 标记公共池卡牌
-- ========================================
-- 当前公共池仅含「轻击」（template_no=1, common, attack）
UPDATE card_templates
SET is_public_pool = TRUE
WHERE name = '轻击';

-- 注释
COMMENT ON COLUMN card_templates.is_public_pool IS
  '是否进入战棋公共池（无限复用，用于牌库抽空时补足）';
