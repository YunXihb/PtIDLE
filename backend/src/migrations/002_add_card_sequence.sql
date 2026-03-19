-- PtIDLE 数据库迁移脚本
-- 版本: 002
-- 日期: 2026-03-19
-- 描述: 添加卡牌自动排列功能（template_no 编码、card_sequence 序号、索引优化）

-- ========================================
-- 1. 为 card_templates 添加 template_no 字段（卡牌种类固定编码）
-- ========================================
ALTER TABLE card_templates ADD COLUMN IF NOT EXISTS template_no INTEGER;

-- 为现有卡牌模板设置固定编码（基于插入顺序）
-- 轻击=1, 移动=2, 重击=3, 精准射击=4, 火球术=5, 防御=6, 治疗=7
UPDATE card_templates SET template_no = 1 WHERE name = '轻击';
UPDATE card_templates SET template_no = 2 WHERE name = '移动';
UPDATE card_templates SET template_no = 3 WHERE name = '重击';
UPDATE card_templates SET template_no = 4 WHERE name = '精准射击';
UPDATE card_templates SET template_no = 5 WHERE name = '火球术';
UPDATE card_templates SET template_no = 6 WHERE name = '防御';
UPDATE card_templates SET template_no = 7 WHERE name = '治疗';

-- 设置 NOT NULL 约束（添加非空约束需要先设置默认值）
ALTER TABLE card_templates ALTER COLUMN template_no SET DEFAULT 0;
ALTER TABLE card_templates ALTER COLUMN template_no SET NOT NULL;

-- 为后续新卡牌设置默认值
ALTER TABLE card_templates ALTER COLUMN template_no SET DEFAULT 0;

-- ========================================
-- 2. 为 player_cards 添加 card_sequence 字段（该玩家拥有该种卡牌的序号）
-- ========================================
ALTER TABLE player_cards ADD COLUMN IF NOT EXISTS card_sequence INTEGER;

-- ========================================
-- 3. 创建序列为 card_sequence 自动编号做准备
-- 注意: 每个玩家的每种卡牌模板独立计数
-- ========================================

-- ========================================
-- 4. 添加/更新索引以支持高效查询
-- ========================================

-- 为 card_templates 的 template_no 添加索引（支持排序）
CREATE INDEX IF NOT EXISTS idx_card_templates_template_no ON card_templates(template_no);

-- 为 player_cards 添加复合索引 (player_id, card_template_id) 支持玩家卡牌查询
CREATE INDEX IF NOT EXISTS idx_player_cards_player_template ON player_cards(player_id, card_template_id);

-- 为 player_cards 添加复合索引 (player_id, card_sequence) 支持按序号排序查询
CREATE INDEX IF NOT EXISTS idx_player_cards_player_sequence ON player_cards(player_id, card_sequence);

-- 为 player_cards 添加索引 (player_id, created_at DESC) 支持按时间倒序查询
CREATE INDEX IF NOT EXISTS idx_player_cards_player_created ON player_cards(player_id, created_at DESC);

-- 注释
COMMENT ON COLUMN card_templates.template_no IS '卡牌模板固定编码，同一种类的卡牌共享相同编码';
COMMENT ON COLUMN player_cards.card_sequence IS '该玩家拥有该种卡牌的序号，同一玩家同种卡牌递增';

-- ========================================
-- 5. 为 card_templates 添加 max_quantity 字段（单组卡牌数量上限，默认5）
-- ========================================
ALTER TABLE card_templates ADD COLUMN IF NOT EXISTS max_quantity INTEGER DEFAULT 5;

-- 更新现有卡牌模板的上限
UPDATE card_templates SET max_quantity = 5 WHERE max_quantity IS NULL OR max_quantity = 0;

ALTER TABLE card_templates ALTER COLUMN max_quantity SET NOT NULL;
ALTER TABLE card_templates ALTER COLUMN max_quantity SET DEFAULT 5;

COMMENT ON COLUMN card_templates.max_quantity IS '该种卡牌的单组数量上限';
