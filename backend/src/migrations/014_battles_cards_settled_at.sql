-- PtIDLE 数据库 migration 014
-- T1018: battles.cards_settled_at —— 卡牌库存扣减幂等标记
-- 日期: 2026-10-20

-- ========================================
-- 背景
-- ========================================
-- 卡牌消耗改为「两级扣减」模型（用户 T1018 决策）：
--   - 对局内（出牌时实时扣）：从对局卡组快照移除该牌 + 记入本局消耗清单
--     （Redis battle:{id}:consumed_cards），防止同一张牌本局被多次消耗。
--   - 对局外（对局结束时一次性扣）：按本局消耗清单 DELETE player_cards，
--     释放玩家的卡牌数量上限额度（card_templates.max_quantity）。
--
-- 库存扣减需要一个独立的幂等标记：
--   - battles.settled_at       -> T054 玩家胜负战绩 + player_battle_history 入账
--   - battles.cards_settled_at -> 本局卡牌库存扣减（新增，与上一者相互独立）
--
-- 为什么不用 settled_at：
--   settled_at 由客户端调用 POST /api/battle/result 时置位（战绩入账路径），
--   而卡牌库存扣减挂在服务端权威的「对局结束」（recordVictory）路径。
--   两者触发时机与语义都不同，共用一个标记会导致其中一方被误跳过。

ALTER TABLE battles
  ADD COLUMN IF NOT EXISTS cards_settled_at TIMESTAMPTZ;

COMMENT ON COLUMN battles.cards_settled_at IS
  '该局卡牌库存扣减幂等标记（非空=已按本局消耗清单扣过 player_cards）；与 settled_at（战绩入账）相互独立';
