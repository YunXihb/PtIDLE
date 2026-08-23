-- PtIDLE 数据库 migration 013
-- T1010: battles.current_phase CHECK 约束加 'deployment'
-- 日期: 2026-08-23

-- ========================================
-- 背景
-- ========================================
-- T1010 系列（对战布置与计时）引入布置阶段：双方 auto-join 完成后
-- 进入 120s 布置环节（选 3 出战棋子 + 本方行摆位 + 每棋子配卡），
-- 双方确认或超时后才进入战斗（现有 idle -> ... -> finished 流程）。
-- migration 003 建的 current_phase CHECK 不含 'deployment'，
-- 不加则布置期 UPDATE battles SET current_phase='deployment' 会被拒。

ALTER TABLE battles
  DROP CONSTRAINT battles_current_phase_check;

ALTER TABLE battles
  ADD CONSTRAINT battles_current_phase_check
  CHECK (current_phase IN ('deployment', 'idle', 'draw', 'move', 'play', 'end_step', 'end_round', 'finished'));

COMMENT ON COLUMN battles.current_phase IS '当前阶段：deployment(布置)/idle/draw/move/play/end_step/end_round/finished';
