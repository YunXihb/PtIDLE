import { httpGet, httpPost, httpPut, httpDelete } from './http';
import type {
  User, LoginResponse, PlayerProfile, OfflineClaimResult, Warehouse,
  Character, DeckCard, CardTemplate, PlayerCard, Pagination,
  Profession, GatheringSkill, GatheringTask, GatheringEfficiency,
  ProcessingRecipe, ProcessResult, CraftingRecipe, CardCraftResult,
  GearCraftResult, ConsumableCraftResult, MatchQueueEntry, MatchQueueStatus,
  SettlementResult,
} from '@/types';

// 信封：{ success: true, data: T }
interface Env<T> { success: true; data: T }
// 带额外顶层字段的信封
type EnvExtra<T, E extends object = object> = Env<T> & E;

// ============ Auth ============
export const authApi = {
  register: (username: string, password: string) =>
    httpPost<Env<User>>('/auth/register', { username, password }),
  login: (username: string, password: string) =>
    httpPost<Env<LoginResponse>>('/auth/login', { username, password }),
};

// ============ Player ============
export const playerApi = {
  profile: () => httpGet<Env<PlayerProfile>>('/player/profile'),
  offlineClaim: () => httpPost<Env<OfflineClaimResult>>('/player/offline-claim'),
};

// ============ Gathering ============
export const gatheringApi = {
  start: (skillType: string, characterId?: string) =>
    httpPost<Env<GatheringTask>>('/gathering/start', { skillType, characterId }),
  status: () => httpGet<Env<GatheringTask | null> & { message?: string }>('/gathering/status'),
  complete: () => httpPost<Env<GatheringTask>>('/gathering/complete'),
  cancel: () => httpPost<Env<null>>('/gathering/cancel'),
  efficiency: () => httpGet<Env<{ efficiency: GatheringEfficiency[]; totalBonus: number }>>('/gathering/efficiency'),
};

// ============ Matchmaking ============
export const matchApi = {
  join: () => httpPost<EnvExtra<MatchQueueEntry, { matched: boolean }>>('/match/queue'),
  status: () => httpGet<Env<MatchQueueStatus>>('/match/queue'),
  leave: () => httpDelete<EnvExtra<MatchQueueEntry, { status?: string }>>('/match/queue'),
};

// ============ Processing ============
export const processingApi = {
  recipes: () => httpGet<Env<ProcessingRecipe[]>>('/processing/recipes'),
  process: (recipeType: string, quantity = 1) =>
    httpPost<Env<ProcessResult>>('/processing/process', { recipeType, quantity }),
};

// ============ Crafting ============
export const craftingApi = {
  recipes: () => httpGet<Env<CraftingRecipe[]>>('/crafting/recipes'),
  recipesByCategory: (category: string) =>
    httpGet<Env<CraftingRecipe[]>>(`/crafting/recipes/${category}`),
  craftCard: (recipeId: string, quantity = 1) =>
    httpPost<Env<CardCraftResult>>('/crafting/card', { recipeId, quantity }),
  craftGear: (recipeId: string, quantity = 1) =>
    httpPost<Env<GearCraftResult>>('/crafting/gear', { recipeId, quantity }),
  craftConsumable: (recipeId: string, quantity = 1) =>
    httpPost<Env<ConsumableCraftResult>>('/crafting/consumable', { recipeId, quantity }),
};

// ============ Characters ============
export const characterApi = {
  list: () => httpGet<Env<Character[]>>('/characters'),
  create: (name: string, profession: string) =>
    httpPost<Env<Character>>('/characters', { name, profession }),
  rename: (id: string, name: string) =>
    httpPut<Env<Character>>(`/characters/${id}/name`, { name }),
  deck: (id: string) => httpGet<Env<DeckCard[]>>(`/characters/${id}/deck`),
  assignCard: (id: string, cardId: string) =>
    httpPut<Env<{ character_deck_id?: string }>>(`/characters/${id}/deck`, { cardId, action: 'assign' }),
  removeCard: (id: string, cardId: string) =>
    httpPut<Env<Record<string, never>>>(`/characters/${id}/deck`, { cardId, action: 'remove' }),
};

// ============ Cards ============
export const cardApi = {
  templates: () => httpGet<Env<CardTemplate[]>>('/cards'),
  template: (id: string) => httpGet<Env<CardTemplate>>(`/cards/${id}`),
  publicPool: () => httpGet<Env<CardTemplate[]>>('/cards/public-pool'),
  myList: (page = 1, pageSize = 50) =>
    httpGet<EnvExtra<PlayerCard[], { pagination: Pagination }>>('/cards/my/list', {
      params: { page, pageSize },
    }),
};

// ============ Warehouse / Professions / Skills ============
export const warehouseApi = {
  get: () => httpGet<Env<Warehouse>>('/warehouse'),
};
export const professionApi = {
  list: () => httpGet<Env<Profession[]>>('/professions'),
};
export const skillApi = {
  gathering: () => httpGet<Env<GatheringSkill[]>>('/skills/gathering'),
};

// ============ Battle ============
export const battleApi = {
  result: (battleId: string) =>
    httpPost<Env<SettlementResult>>('/battle/result', { battleId }),
};
