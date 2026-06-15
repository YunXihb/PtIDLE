/**
 * T048 战场初始化 Orchestrator
 *
 * 负责 3v3 战棋对战初始化全流程：
 * 1. initializeBoard
 * 2. placeCharacter × 6 (默认位置)
 * 3. setCharacterEnergy × 6
 * 4. drawCards × 6
 * 5. initializeSession
 * 6. UPDATE battles status='ongoing'
 * 7. broadcastFullState × 2
 *
 * 失败时通过 cleanupPartialInit 阶梯式反向清理。
 */

import type { Server as IOServer } from 'socket.io';
import * as battleService from './battleService';
import * as handService from './handService';
import * as battleSessionService from './battleSessionService';
import { query, queryOne } from '../config/database';
import { redisClient } from '../config/redis';

// ─── 公共类型 ──────────────────────────────────────────────
export type InitResult =
  | { success: true; startedAt: Date; actorId: string }
  | { success: false; failedStep: number; error: string };

interface CharacterRow {
  id: string;
  player_id: string;
  user_id: string;       // JOIN users 拿到的字段，用于 broadcastFullState
  name: string;
  profession: string;
  health: number;
  max_health: number;
  movement: number;
  energy: number;
  max_energy: number;
  is_alive: boolean;
}

// ─── 3v3 默认位置常量（硬编码）──────────────────────────
const DEFAULT_P1_POSITIONS_3V3: Array<{ x: number; y: number }> = [
  { x: 6, y: 0 }, { x: 7, y: 0 }, { x: 8, y: 0 },
];
const DEFAULT_P2_POSITIONS_3V3: Array<{ x: number; y: number }> = [
  { x: 0, y: 8 }, { x: 1, y: 8 }, { x: 2, y: 8 },
];

// ─── 主入口 ────────────────────────────────────────────────
export async function initBattleField(io: IOServer, battleId: string): Promise<InitResult> {
  throw new Error('initBattleField: not yet implemented');
}

// ─── 反向清理 ──────────────────────────────────────────────
export async function cleanupPartialInit(battleId: string, lastSuccessfulStep: number): Promise<void> {
  throw new Error('cleanupPartialInit: not yet implemented');
}

// ─── 内部辅助：取前 3 个 alive 棋子 + 绑定 battle_id ──────
async function loadBattleCharacters(battleId: string): Promise<{
  p1Chars: CharacterRow[];
  p2Chars: CharacterRow[];
}> {
  throw new Error('loadBattleCharacters: not yet implemented');
}
