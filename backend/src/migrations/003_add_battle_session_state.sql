-- PtIDLE 数据库迁移脚本
-- 版本: 003
-- 日期: 2026-06-09
-- 描述: 扩展 battles 表以支持回合流程控制（T036）
--   - 添加 current_round, current_step, current_actor_id, current_phase, updated_at 字段
--   - current_phase 枚举: idle, draw, move, play, end_step, end_round, finished

-- ========================================
-- 1. 添加回合流程状态字段
-- ========================================

-- 当前回合数（从 1 开始）
ALTER TABLE battles ADD COLUMN IF NOT EXISTS current_round INTEGER DEFAULT 1;

-- 当前激活步骤索引（蛇形激活顺序中的位置：3v3 时 0-5）
ALTER TABLE battles ADD COLUMN IF NOT EXISTS current_step INTEGER DEFAULT 0;

-- 当前激活的棋子 ID
ALTER TABLE battles ADD COLUMN IF NOT EXISTS current_actor_id UUID REFERENCES characters(id);

-- 当前阶段
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'battles' AND column_name = 'current_phase'
    ) THEN
        ALTER TABLE battles
        ADD COLUMN current_phase VARCHAR(20) DEFAULT 'idle'
        CHECK (current_phase IN ('idle', 'draw', 'move', 'play', 'end_step', 'end_round', 'finished'));
    END IF;
END $$;

-- 记录更新时间（用于 T036 状态机持久化）
ALTER TABLE battles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

-- ========================================
-- 2. 现有数据默认值
-- ========================================

-- 已存在的 ongoing 状态 battle 默认在第 1 回合第 0 步 idle 阶段
UPDATE battles
SET current_round = 1, current_step = 0, current_phase = 'idle', updated_at = CURRENT_TIMESTAMP
WHERE current_round IS NULL OR current_step IS NULL OR current_phase IS NULL;

-- 设置字段为 NOT NULL（已有数据已填充默认值）
ALTER TABLE battles ALTER COLUMN current_round SET DEFAULT 1;
ALTER TABLE battles ALTER COLUMN current_step SET DEFAULT 0;
ALTER TABLE battles ALTER COLUMN current_phase SET DEFAULT 'idle';

-- ========================================
-- 3. 索引
-- ========================================

CREATE INDEX IF NOT EXISTS idx_battles_current_actor ON battles(current_actor_id);
CREATE INDEX IF NOT EXISTS idx_battles_status ON battles(status);

-- ========================================
-- 注释
-- ========================================
COMMENT ON COLUMN battles.current_round IS '当前回合数（从 1 开始）';
COMMENT ON COLUMN battles.current_step IS '当前激活步骤索引（蛇形激活顺序中的位置，3v3 时 0-5）';
COMMENT ON COLUMN battles.current_actor_id IS '当前激活的棋子 ID';
COMMENT ON COLUMN battles.current_phase IS '当前阶段：idle/draw/move/play/end_step/end_round/finished';
COMMENT ON COLUMN battles.updated_at IS '最后更新时间';
