// ========================================
// 类型定义（对齐后端 API 契约 + WS 协议）
// ========================================

export type StringMap = Record<string, number>;

// ---------- API 信封 ----------
export interface ApiEnvelope<T> { success: true; data: T }
export interface ApiErrorEnvelope { success: false; error: string; [k: string]: unknown }
export interface Pagination { page: number; pageSize: number; total: number; totalPages: number }

// ---------- 认证 ----------
export interface User { id: string; username: string; created_at: string; last_login: string | null }
export interface LoginResponse { token: string; user: User }

// ---------- 玩家 ----------
export interface CharacterSummary {
  id: string; name: string; profession: string;
  health: number; max_health: number; movement: number;
  energy: number; max_energy: number;
  position_x: number | null; position_y: number | null; is_alive: boolean;
}
export interface PlayerProfile {
  id: string; user_id: string; username: string;
  resources: StringMap; materials: StringMap;
  production_gear: Record<string, unknown>;
  warehouse_limits: StringMap; idle_queue: unknown[];
  last_offline: string | null;
  characters: CharacterSummary[];
}
export interface OfflineClaimResult {
  offlineTime: number; earned: StringMap; stored: StringMap;
  overflowed: StringMap; lastOffline: string;
}
export interface Warehouse {
  resources: StringMap; materials: StringMap; storageLimits: StringMap;
}

// ---------- 棋子 ----------
export interface Character extends CharacterSummary { player_id: string; created_at: string }
export type CardType = 'attack' | 'defense' | 'tactical';
export interface DeckCard {
  deck_id: string; card_id: string; name: string;
  type: CardType; cost: number; effect: Record<string, unknown>;
  template_no: number; card_sequence: number; assigned_at: string;
}

// ---------- 卡牌 ----------
export interface CardTemplate {
  id: string; name: string; description: string | null; type: CardType;
  cost: number; effect: Record<string, unknown>; profession: string | null;
  template_no: number; max_quantity: number; is_public_pool: boolean;
}
export interface PlayerCard {
  id: string; player_id: string; card_template_id: string | null;
  template_no: number; card_sequence: number; name: string; type: CardType;
  cost: number; effect: Record<string, unknown>; quantity: number; created_at: string;
}

// ---------- 职业 / 技能 ----------
export interface Profession { id: string; name: string; base_health: number; base_movement: number; base_energy: number; description: string | null }
export type SkillType = 'mining' | 'woodcutting' | 'herbalism';
export interface GatheringSkill { id: string; name: string; type: SkillType; yields: StringMap; base_yield: number }

// ---------- 采集 ----------
export interface GatheringTask {
  id: string; skillType: SkillType; characterId?: string;
  startedAt: string; duration: number; status: 'active' | 'completed' | 'cancelled';
  result?: { resources: StringMap; overflowed: StringMap };
  progress?: number; elapsedSeconds?: number;
}
export interface GatheringEfficiency {
  skillType: SkillType; baseYield: number; gearBonus: number; effectiveYield: number;
  primaryResource: string; byproduct: string; byproductChance: number;
}

// ---------- 加工 / 制造 ----------
export type ProcessingType = 'smelting' | 'carpentry' | 'grinding';
export interface ProcessingRecipe { id: string; name: string; type: ProcessingType; input: StringMap; output: StringMap; efficiency: number }
export interface ProcessResult { recipe: string; type: string; quantity: number; input: StringMap; output: StringMap; resources: StringMap; materials: StringMap }
export type CraftCategory = 'card' | 'gear' | 'consumable';
export interface CraftingRecipe { id: string; name: string; category: CraftCategory; input: StringMap | StringMap[]; output: Record<string, unknown>; profession_required: string | null }
export interface CardCraftResult { cardName: string; quantity: number; materialsUsed: StringMap; playerCardId: string }
export interface GearCraftResult { gearName: string; bonus: number; materialsUsed: StringMap }
export interface ConsumableCraftResult { consumableName: string; quantity: number; effect: Record<string, unknown>; materialsUsed: StringMap; playerConsumableId: string }

// ---------- 匹配 / 对战 ----------
export interface MatchQueueEntry { userId: string; enqueuedAt: number }
export interface MatchQueueStatus {
  inQueue: boolean; userId?: string; enqueuedAt?: number; waitingSeconds?: number;
  matched?: boolean; battleId?: string; matchedAt?: number;
}
export type PlayerResult = 'win' | 'loss' | 'draw';
export type VictoryType = 'kill_threshold' | 'base_threshold' | 'draw';
export interface PlayerStats { wins: number; losses: number; draws: number }
export interface SettlementResult {
  battleId: string; status: 'finished'; yourResult: PlayerResult;
  winner: { userId: string; side: 'p1' | 'p2' } | null;
  victoryType: VictoryType; p1Stars: number; p2Stars: number;
  p1UserId: string; p2UserId: string;
  duration: number; startedAt: string; finishedAt: string;
  yourStats: PlayerStats; opponentStats: PlayerStats;
}

// ========================================
// WS 协议类型
// ========================================
export type BattlePhase = 'idle' | 'draw' | 'move' | 'play' | 'end_step' | 'end_round' | 'finished';
export type Side = 'p1' | 'p2';

export interface HandCard {
  deck_id: string; card_id: string; name: string;
  type: CardType; cost: number; effect: Record<string, unknown>;
  template_no: number; source: 'deck' | 'public_pool';
}

export interface StatusEffect {
  type: string; value?: number; duration_rounds: number;
  source_id?: string; target_id?: string;
  expire_round: number; created_round: number; effect_id: string;
}

export interface CharacterStatus {
  characterId: string; name: string;
  profession: 'warrior' | 'ranger' | 'mage';
  health: number; maxHealth: number; energy: number; maxEnergy: number;
  position: { x: number; y: number } | null;
  isAlive: boolean;
  effects: StatusEffect[]; totalShield: number;
  isTaunted: boolean; taunting: string[];
}

export interface BoardStateEvent {
  battleId: string; currentRound: number; currentStep: number;
  currentPhase: BattlePhase; currentActorId: string | null;
  characters: CharacterStatus[]; p1Stars: number; p2Stars: number;
  bases: { '2,2': Side | 'neutral'; '6,6': Side | 'neutral' };
}

export interface FullStateEvent {
  battleId: string; board: BoardStateEvent;
  ownHand: Record<string, HandCard[]>;
}

export interface SessionStateEvent {
  battleId: string; currentRound: number; currentStep: number;
  currentActorId: string | null; currentPhase: BattlePhase;
}

export interface BattleEndEvent {
  battleId: string; winnerUserId: string | null; winnerSide: Side | null;
  victoryType: VictoryType; p1Stars: number; p2Stars: number;
  p1UserId: string | null; p2UserId: string | null;
}

export interface MatchMatchedEvent { battleId: string; opponentUserId: string }
export interface JoinOkEvent { battleId: string; opponentInRoom: boolean }
