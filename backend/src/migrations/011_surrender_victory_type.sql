-- PtIDLE 数据库 migration 011
-- 对战互动: 认输(退出判负) 的 victory_type
-- 日期: 2026-08-18

-- ========================================
-- 1. player_battle_history.victory_type 增加 'surrender'
-- ========================================
-- 战棋互动: 玩家退出对战 -> 对方胜利, victory_type='surrender'
-- (battles.victory_type 无 CHECK 约束, 仅此处需改)
ALTER TABLE player_battle_history
  DROP CONSTRAINT player_battle_history_victory_type_check;

ALTER TABLE player_battle_history
  ADD CONSTRAINT player_battle_history_victory_type_check
  CHECK (victory_type IN ('kill_threshold', 'base_threshold', 'draw', 'surrender'));
