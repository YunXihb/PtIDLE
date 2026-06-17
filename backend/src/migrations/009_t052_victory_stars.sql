-- PtIDLE 数据库迁移脚本
-- 版本: 009
-- 日期: 2026-06-17
-- 描述: T052 胜负判定 - battles 表新增胜利进度字段
--   - p1_stars: p1 累计胜利进度 (0-6)
--   - p2_stars: p2 累计胜利进度 (0-6)
--   - winner_player_id: 胜利玩家 player_id (平局时 NULL)
--   - victory_type: 胜利类型 kill_threshold | base_threshold | draw

-- ========================================
-- 1. 添加胜利进度字段
-- ========================================

ALTER TABLE battles ADD COLUMN IF NOT EXISTS p1_stars INTEGER DEFAULT 0;
ALTER TABLE battles ADD COLUMN IF NOT EXISTS p2_stars INTEGER DEFAULT 0;
ALTER TABLE battles ADD COLUMN IF NOT EXISTS winner_player_id UUID REFERENCES players(id);
ALTER TABLE battles ADD COLUMN IF NOT EXISTS victory_type VARCHAR(20)
  CHECK (victory_type IN ('kill_threshold', 'base_threshold', 'draw'));

-- ========================================
-- 2. 注释
-- ========================================

COMMENT ON COLUMN battles.p1_stars IS 'p1 累计胜利进度 (0-6)';
COMMENT ON COLUMN battles.p2_stars IS 'p2 累计胜利进度 (0-6)';
COMMENT ON COLUMN battles.winner_player_id IS '胜利玩家 player_id（平局时 NULL）';
COMMENT ON COLUMN battles.victory_type IS '胜利类型: kill_threshold | base_threshold | draw';
