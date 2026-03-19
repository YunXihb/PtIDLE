-- PtIDLE 数据库初始化脚本
-- 版本: 001
-- 日期: 2026-03-10

-- 启用 UUID 扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ========================================
-- 用户表
-- ========================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP WITH TIME ZONE
);

-- ========================================
-- 玩家表（扩展用户信息）
-- ========================================
CREATE TABLE IF NOT EXISTS players (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- 资源（JSON）
    resources JSONB DEFAULT '{"iron_ore": 0, "coal": 0, "wood": 0, "sap": 0, "herb": 0, "mushroom": 0}',

    -- 材料（JSON）
    materials JSONB DEFAULT '{"iron_ingot": 0, "plank": 0, "herb_powder": 0}',

    -- 生产装备（JSON）
    production_gear JSONB DEFAULT '{}',

    -- 仓库上限配置（JSON）
    warehouse_limits JSONB DEFAULT '{"resource": 1000, "material": 500, "gear": 50}',

    -- 挂机队列（JSON）
    idle_queue JSONB DEFAULT '[]',

    -- 最后离线时间
    last_offline TIMESTAMP WITH TIME ZONE,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ========================================
-- 棋子表
-- ========================================
CREATE TABLE IF NOT EXISTS characters (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,

    name VARCHAR(50) NOT NULL,
    profession VARCHAR(20) NOT NULL CHECK (profession IN ('warrior', 'ranger', 'mage')),

    -- 职业属性（数值待数值策划确认）
    health INTEGER DEFAULT 10,
    max_health INTEGER DEFAULT 10,
    movement INTEGER DEFAULT 2,
    energy INTEGER DEFAULT 3,
    max_energy INTEGER DEFAULT 3,

    -- 位置（战斗中使用）
    position_x INTEGER,
    position_y INTEGER,

    -- 状态
    is_alive BOOLEAN DEFAULT TRUE,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ========================================
-- 卡牌定义表（模板）
-- ========================================
CREATE TABLE IF NOT EXISTS card_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    name VARCHAR(100) NOT NULL,
    description TEXT,
    type VARCHAR(20) NOT NULL CHECK (type IN ('attack', 'defense', 'tactical')),
    cost INTEGER NOT NULL DEFAULT 1,

    -- 效果（JSON）
    effect JSONB NOT NULL DEFAULT '{}',

    -- 职业限制
    profession VARCHAR(20) CHECK (profession IN ('warrior', 'ranger', 'mage', 'common')),

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ========================================
-- 玩家卡牌表（玩家拥有的卡牌）
-- ========================================
CREATE TABLE IF NOT EXISTS player_cards (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,

    card_template_id UUID REFERENCES card_templates(id),

    -- 卡牌实例数据
    name VARCHAR(100) NOT NULL,
    type VARCHAR(20) NOT NULL,
    cost INTEGER NOT NULL,
    effect JSONB DEFAULT '{}',

    -- 数量（用于消耗品）
    quantity INTEGER DEFAULT 1,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ========================================
-- 棋子卡牌分配表（棋子牌库）
-- ========================================
CREATE TABLE IF NOT EXISTS character_deck (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    player_card_id UUID NOT NULL REFERENCES player_cards(id) ON DELETE CASCADE,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(character_id, player_card_id)
);

-- ========================================
-- 玩家消耗品表（玩家拥有的消耗品）
-- ========================================
CREATE TABLE IF NOT EXISTS player_consumables (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,

    -- 消耗品名称
    name VARCHAR(100) NOT NULL,

    -- 效果（JSON）
    effect JSONB DEFAULT '{}',

    -- 数量
    quantity INTEGER DEFAULT 1,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ========================================
-- 采集技能表
-- ========================================
CREATE TABLE IF NOT EXISTS gathering_skills (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    name VARCHAR(50) NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('mining', 'woodcutting', 'herbalism')),

    -- 产出（JSON）
    yields JSONB NOT NULL DEFAULT '{}',

    -- 基础效率
    base_yield INTEGER DEFAULT 1,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ========================================
-- 加工配方表
-- ========================================
CREATE TABLE IF NOT EXISTS processing_recipes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    name VARCHAR(100) NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('smelting', 'carpentry', 'grinding')),

    -- 输入材料（JSON）
    input JSONB NOT NULL DEFAULT '{}',

    -- 输出材料（JSON）
    output JSONB NOT NULL DEFAULT '{}',

    -- 效率系数
    efficiency DECIMAL(5,2) DEFAULT 1.0,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ========================================
-- 制造配方表
-- ========================================
CREATE TABLE IF NOT EXISTS crafting_recipes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    name VARCHAR(100) NOT NULL,
    category VARCHAR(20) NOT NULL CHECK (category IN ('card', 'gear', 'consumable')),

    -- 输入材料（JSON）
    input JSONB NOT NULL DEFAULT '{}',

    -- 输出物品（JSON）
    output JSONB NOT NULL DEFAULT '{}',

    -- 职业要求
    profession_required VARCHAR(20),

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ========================================
-- 职业属性表
-- ========================================
CREATE TABLE IF NOT EXISTS professions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    name VARCHAR(20) UNIQUE NOT NULL CHECK (name IN ('warrior', 'ranger', 'mage')),

    -- 属性
    base_health INTEGER NOT NULL,
    base_movement INTEGER NOT NULL,
    base_energy INTEGER NOT NULL,

    -- 描述
    description TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ========================================
-- 对战记录表
-- ========================================
CREATE TABLE IF NOT EXISTS battles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- 对战双方
    player1_id UUID NOT NULL REFERENCES players(id),
    player2_id UUID NOT NULL REFERENCES players(id),

    -- 胜负
    winner_id UUID REFERENCES players(id),

    -- 持续时间（秒）
    duration INTEGER DEFAULT 0,

    -- 状态
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'ongoing', 'finished')),

    -- 战斗数据（JSON）
    battle_data JSONB DEFAULT '{}',

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMP WITH TIME ZONE
);

-- ========================================
-- 索引
-- ========================================
CREATE INDEX IF NOT EXISTS idx_players_user_id ON players(user_id);
CREATE INDEX IF NOT EXISTS idx_characters_player_id ON characters(player_id);
CREATE INDEX IF NOT EXISTS idx_player_cards_player_id ON player_cards(player_id);
CREATE INDEX IF NOT EXISTS idx_character_deck_character_id ON character_deck(character_id);
CREATE INDEX IF NOT EXISTS idx_battles_player1_id ON battles(player1_id);
CREATE INDEX IF NOT EXISTS idx_battles_player2_id ON battles(player2_id);

-- ========================================
-- 初始化数据
-- ========================================

-- 插入职业数据（待数值策划确认后修改）
INSERT INTO professions (name, base_health, base_movement, base_energy, description) VALUES
    ('warrior', 20, 2, 3, '战士 - 高血量，近战坦克'),
    ('ranger', 15, 3, 3, '弓手 - 中等血量，远程单体'),
    ('mage', 12, 2, 3, '法师 - 低血量，远程AOE')
ON CONFLICT (name) DO NOTHING;

-- 插入采集技能
INSERT INTO gathering_skills (name, type, yields, base_yield) VALUES
    ('采矿', 'mining', '{"iron_ore": 1, "coal": 0.3}', 1),
    ('伐木', 'woodcutting', '{"wood": 1, "sap": 0.2}', 1),
    ('草药学', 'herbalism', '{"herb": 1, "mushroom": 0.3}', 1)
ON CONFLICT DO NOTHING;

-- 插入加工配方
INSERT INTO processing_recipes (name, type, input, output, efficiency) VALUES
    ('冶炼', 'smelting', '{"iron_ore": 2, "coal": 1}', '{"iron_ingot": 1}', 1.0),
    ('木工', 'carpentry', '{"wood": 2}', '{"plank": 1}', 1.0),
    ('研磨', 'grinding', '{"herb": 2}', '{"herb_powder": 1}', 1.0)
ON CONFLICT DO NOTHING;

-- 插入基础卡牌模板（示例）
INSERT INTO card_templates (name, description, type, cost, effect, profession) VALUES
    ('轻击', '造成2点伤害', 'attack', 1, '{"damage": 2}', 'common'),
    ('移动', '移动1格', 'tactical', 0, '{"movement": 1}', 'common'),
    ('重击', '造成4点伤害', 'attack', 2, '{"damage": 4}', 'warrior'),
    ('精准射击', '造成3点伤害', 'attack', 1, '{"damage": 3, "range": 3}', 'ranger'),
    ('火球术', '造成3点AOE伤害', 'attack', 2, '{"damage": 3, "aoe": true}', 'mage'),
    ('防御', '获得3点护盾', 'defense', 1, '{"shield": 3}', 'common'),
    ('治疗', '恢复3点生命', 'tactical', 1, '{"heal": 3}', 'common')
ON CONFLICT DO NOTHING;

-- 插入制造配方
INSERT INTO crafting_recipes (name, category, input, output, profession_required) VALUES
    ('基础移动卡', 'card', '{"iron_ingot": 1}', '{"name": "移动", "quantity": 1}', NULL),
    ('基础轻击卡', 'card', '{"iron_ingot": 2}', '{"name": "轻击", "quantity": 1}', NULL),
    ('战士重击卡', 'card', '{"iron_ingot": 3}', '{"name": "重击", "quantity": 1}', 'warrior'),
    ('弓手精准射击卡', 'card', '{"iron_ingot": 3, "plank": 1}', '{"name": "精准射击", "quantity": 1}', 'ranger'),
    ('法师火球卡', 'card', '{"iron_ingot": 3, "herb_powder": 1}', '{"name": "火球术", "quantity": 1}', 'mage'),
    ('矿镐', 'gear', '{"iron_ingot": 5, "plank": 2}', '{"name": "矿镐", "bonus": 0.5}', NULL),
    ('伐木斧', 'gear', '{"iron_ingot": 3, "plank": 3}', '{"name": "伐木斧", "bonus": 0.5}', NULL),
    ('采集手套', 'gear', '{"plank": 5}', '{"name": "采集手套", "bonus": 0.3}', NULL),
    ('回血药', 'consumable', '[{"iron_ingot": 1}, {"plank": 1}]', '{"name": "回血药", "quantity": 1, "effect": {"heal": 5}}', NULL)
ON CONFLICT DO NOTHING;

-- 注释
COMMENT ON TABLE users IS '用户账户表';
COMMENT ON TABLE players IS '玩家数据表';
COMMENT ON TABLE characters IS '棋子表';
COMMENT ON TABLE card_templates IS '卡牌模板表';
COMMENT ON TABLE player_cards IS '玩家卡牌表';
COMMENT ON TABLE character_deck IS '棋子牌库分配表';
COMMENT ON TABLE gathering_skills IS '采集技能表';
COMMENT ON TABLE processing_recipes IS '加工配方表';
COMMENT ON TABLE crafting_recipes IS '制造配方表';
COMMENT ON TABLE professions IS '职业属性表';
COMMENT ON TABLE battles IS '对战记录表';
