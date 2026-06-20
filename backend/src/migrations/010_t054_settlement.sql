-- PtIDLE 数据库迁移脚本
-- 版本: 010
-- 日期: 2026-06-20
-- 描述: T054 对战结算 API - 玩家战绩累计 + 对战历史表 + 幂等标记
--   - players 加 wins/losses/draws 三计数
--   - battles 加 settled_at 标记（幂等检测键）
--   - 新建 player_battle_history 表

-- ========================================
-- 1. players 加胜场/败场/平局三计数
-- ========================================

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS wins INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS losses INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS draws INTEGER NOT NULL DEFAULT 0;

-- ========================================
-- 2. battles 加 settled_at 标记
--    T054 写入,用于幂等检测(非空 = 已结算过)
-- ========================================

ALTER TABLE battles
  ADD COLUMN IF NOT EXISTS settled_at TIMESTAMP WITH TIME ZONE;

-- ========================================
-- 3. 对战历史表
-- ========================================

CREATE TABLE IF NOT EXISTS player_battle_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  battle_id UUID NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
  result VARCHAR(10) NOT NULL CHECK (result IN ('win', 'loss', 'draw')),
  opponent_player_id UUID REFERENCES players(id),
  victory_type VARCHAR(20) NOT NULL CHECK (victory_type IN ('kill_threshold', 'base_threshold', 'draw')),
  my_stars INTEGER NOT NULL,
  opponent_stars INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_pbh_player_battle UNIQUE (player_id, battle_id)
);

CREATE INDEX IF NOT EXISTS idx_pbh_player_created
  ON player_battle_history(player_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pbh_battle
  ON player_battle_history(battle_id);

-- ========================================
-- 4. 注释
-- ========================================

COMMENT ON COLUMN players.wins IS '胜场数(T054 累加)';
COMMENT ON COLUMN players.losses IS '败场数(T054 累加)';
COMMENT ON COLUMN players.draws IS '平局数(T054 累加)';
COMMENT ON COLUMN battles.settled_at IS '对战结算时间(T054 写入,幂等检测键)';
