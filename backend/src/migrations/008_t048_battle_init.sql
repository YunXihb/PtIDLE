-- 008_t048_battle_init.sql
-- T048 战场初始化：为 characters 表加 battle_id 软绑定 + deck_position + 索引

-- 1. characters 表加 battle_id（软绑定，NULL 表示未入战）
ALTER TABLE characters ADD COLUMN battle_id UUID REFERENCES battles(id) ON DELETE SET NULL;
CREATE INDEX idx_characters_battle_id ON characters(battle_id);

-- 2. characters 表加 deck_position（3v3 中棋子 0/1/2 位序，预留给未来）
ALTER TABLE characters ADD COLUMN deck_position INTEGER;

-- 3. battles.started_at 索引（查询加速）
CREATE INDEX IF NOT EXISTS idx_battles_started_at ON battles(started_at);
