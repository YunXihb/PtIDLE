-- T044 撮合元数据
-- 版本: 007
-- 日期: 2026-06-11

-- ========================================
-- battles 表新增撮合 / 启动时间字段
-- ========================================

ALTER TABLE battles ADD COLUMN IF NOT EXISTS matched_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE battles ADD COLUMN IF NOT EXISTS started_at TIMESTAMP WITH TIME ZONE;

-- 历史数据回填：撮合时间 = 创建时间（实际业务上同步发生）
UPDATE battles SET matched_at = created_at WHERE matched_at IS NULL;

-- ========================================
-- 索引（撮合查询 / 防 dup）
-- ========================================

-- GET /queue 兜底查询索引（LOSER 恢复路径）
CREATE INDEX IF NOT EXISTS idx_battles_p1_pending
  ON battles(player1_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_battles_p2_pending
  ON battles(player2_id) WHERE status = 'pending';

-- 双层防 dup 兜底：partial unique index
-- 同对玩家在同一时刻只能有一场 pending battle
CREATE UNIQUE INDEX IF NOT EXISTS idx_battles_pending_unique_p1p2
  ON battles(player1_id, player2_id) WHERE status = 'pending';

-- ========================================
-- 字段注释
-- ========================================

COMMENT ON COLUMN battles.matched_at IS '撮合成功时间（T044 写入）';
COMMENT ON COLUMN battles.started_at IS '双方首次进入战场时间（T048 写入）';
