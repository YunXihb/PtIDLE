-- PtIDLE 数据库 migration 012
-- 修复: battles.victory_type CHECK 约束缺少 'surrender'
-- 日期: 2026-08-22

-- ========================================
-- 背景
-- ========================================
-- migration 010 给 battles.victory_type 加了 CHECK (kill/base/draw)。
-- migration 011 注释误判「battles.victory_type 无 CHECK 约束」，只改了
-- player_battle_history 表，漏改 battles 表。导致认输结算
-- recordVictory UPDATE battles SET victory_type='surrender' 被 CHECK 拒绝，
-- 前端收到 battle:surrender:error internal_error。

ALTER TABLE battles
  DROP CONSTRAINT battles_victory_type_check;

ALTER TABLE battles
  ADD CONSTRAINT battles_victory_type_check
  CHECK (victory_type IN ('kill_threshold', 'base_threshold', 'draw', 'surrender'));
