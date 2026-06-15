// T048 单测：TDZ 顺序，jest.mock 必须在所有 import 之前
const mockInitializeBoard = jest.fn();
const mockPlaceCharacter = jest.fn();
const mockSetEnergy = jest.fn();

const mockDrawCards = jest.fn();

const mockInitSession = jest.fn();
const mockGetOrder = jest.fn();

const mockQuery = jest.fn();
const mockQueryOne = jest.fn();

const mockRedisClient = {
  set: jest.fn(),
  del: jest.fn(),
  hGet: jest.fn(),
  hSet: jest.fn(),
};

jest.mock('./battleService', () => ({
  initializeBoard: mockInitializeBoard,
  placeCharacter: mockPlaceCharacter,
  setCharacterEnergy: mockSetEnergy,
}));
jest.mock('./handService', () => ({
  drawCards: mockDrawCards,
}));
jest.mock('./battleSessionService', () => ({
  initializeSession: mockInitSession,
  getActivationOrder: mockGetOrder,
}));
jest.mock('../config/database', () => ({
  query: mockQuery,
  queryOne: mockQueryOne,
  execute: jest.fn(),
}));
jest.mock('../config/redis', () => ({
  redisClient: mockRedisClient,
}));

import { initBattleField, cleanupPartialInit } from './battleInitializationService';

const mockBroadcast = jest.fn();
const FAKE_IO: any = { to: jest.fn().mockReturnThis(), emit: mockBroadcast };

const P1_CHARS = [
  { id: 'c1', player_id: 'p1', user_id: 'u1', name: 'W1', profession: 'warrior', health: 20, max_health: 20, movement: 2, energy: 0, max_energy: 3, is_alive: true },
  { id: 'c2', player_id: 'p1', user_id: 'u1', name: 'R1', profession: 'ranger',  health: 15, max_health: 15, movement: 3, energy: 0, max_energy: 3, is_alive: true },
  { id: 'c3', player_id: 'p1', user_id: 'u1', name: 'M1', profession: 'mage',    health: 12, max_health: 12, movement: 2, energy: 0, max_energy: 3, is_alive: true },
];
const P2_CHARS = [
  { id: 'c4', player_id: 'p2', user_id: 'u2', name: 'W2', profession: 'warrior', health: 20, max_health: 20, movement: 2, energy: 0, max_energy: 3, is_alive: true },
  { id: 'c5', player_id: 'p2', user_id: 'u2', name: 'R2', profession: 'ranger',  health: 15, max_health: 15, movement: 3, energy: 0, max_energy: 3, is_alive: true },
  { id: 'c6', player_id: 'p2', user_id: 'u2', name: 'M2', profession: 'mage',    health: 12, max_health: 12, movement: 2, energy: 0, max_energy: 3, is_alive: true },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockInitializeBoard.mockResolvedValue({} as any);
  mockPlaceCharacter.mockResolvedValue({} as any);
  mockSetEnergy.mockResolvedValue(undefined);
  mockDrawCards.mockResolvedValue({} as any);
  mockInitSession.mockResolvedValue(undefined);
  mockGetOrder.mockReturnValue(['c1', 'c4', 'c2', 'c5', 'c3', 'c6']);
  // mockQueryOne for loadBattleCharacters: battles row + p1 chars + p2 chars
  mockQueryOne.mockResolvedValueOnce({ player1_id: 'p1', player2_id: 'p2' });
  mockQuery.mockResolvedValueOnce(P1_CHARS);  // p1 chars query
  mockQuery.mockResolvedValueOnce(P2_CHARS);  // p2 chars query
  mockQuery.mockResolvedValueOnce({ rowCount: 1 });  // UPDATE characters.battle_id
  // mockQuery for UPDATE battles status=ongoing
  mockQuery.mockResolvedValueOnce({ rowCount: 1 });
});

describe('loadBattleCharacters (via initBattleField happy path)', () => {
  // 测试会在 Task 5 中添加，本 task 只建立 mock 基础设施
  it('placeholder — actual tests in Task 5+', () => {
    expect(true).toBe(true);
  });
});
