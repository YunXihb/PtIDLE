// ========================================
// T052 胜负判定服务
// ========================================
// 提供对战胜利判定：
//   - applyKillStars: 捕获本步新增死亡 → 给击杀方 +1 star
//   - applyBaseStars: 扫描 2 个据点 → 占领方 +1 star
//   - checkWinCondition: 判定 win/draw/not_over
//   - recordVictory: 持久化 winner + finishSession + 广播 battle:end
//
// 数据存储：
//   - Redis: battle:{id}:stars:p1/p2 (STRING), battle:{id}:bases (STRING JSON), battle:{id}:alive_p1/p2 (STRING)
//   - DB: battles.p1_stars, p2_stars, winner_player_id, victory_type (migration 009)
//
// 调用方:
//   - T051 executeEndStep: 调 applyKillStars + checkWinCondition + recordVictory
//   - T051 executeRoundEnd: 调 applyBaseStars + checkWinCondition + recordVictory
//
// 范围外:
//   - 卡牌消耗: T053
//   - 战斗结算 API: T054
//   - 伤害权威化: T056

import type { Server as IOServer } from 'socket.io';
import { query, execute } from '../config/database';
import { redisClient } from '../config/redis';
import { listCharactersInBattle } from './battleService';
import { finishSession } from './battleSessionService';
// 注：query/execute/redisClient/listCharactersInBattle/finishSession 将在 Task 3-6 实现中使用，
//      骨架阶段先 import 占位，避免后续任务频繁改动 import 段。

// ========================================
// 常量
// ========================================

/**
 * 棋盘上的固定据点（3v3 模式，9x9 棋盘对角线）
 */
export const BASES: ReadonlyArray<{ x: number; y: number; key: string }> = [
  { x: 3, y: 3, key: '3,3' },
  { x: 6, y: 6, key: '6,6' },
] as const;

/**
 * 据点占领范围半径（Chebyshev 距离 ≤ BASE_RADIUS，等价 5x5 正方形）
 */
export const BASE_RADIUS = 2;

/**
 * 胜利阈值（达到即获胜）
 */
export const WIN_THRESHOLD = 6;

// ========================================
// 类型
// ========================================

export type Side = 'p1' | 'p2';
export type BaseOwner = Side | 'neutral';
export type VictoryType = 'kill_threshold' | 'base_threshold' | 'draw';
/**
 * 胜利进度来源类型（用于区分击杀加星 vs 据点加星）
 * T052 范围：仅作类型导出；Task 3-4 的 applyKillStars / applyBaseStars 在内部使用
 * 未来扩展：可用于胜负事件 telemetry、replay 回放等
 */
export type StarSource = 'kill' | 'base';

export type BasesState = Record<string, BaseOwner>;

export interface KillStarDelta {
  p1Delta: number; // 本步 p1 stars 增量（p1 击杀对方 N 棋 → +N）
  p2Delta: number; // 本步 p2 stars 增量（p2 击杀对方 N 棋 → +N）
  p1StarsAfter: number;
  p2StarsAfter: number;
}

export interface BaseStarDelta {
  p1Delta: number;
  p2Delta: number;
  p1StarsAfter: number;
  p2StarsAfter: number;
  bases: BasesState;
}

export type WinCheckResult =
  | { status: 'win'; winnerSide: Side; p1Stars: number; p2Stars: number }
  | { status: 'draw'; p1Stars: number; p2Stars: number }
  | { status: 'not_over'; p1Stars: number; p2Stars: number };

export type RecordVictoryOutcome = Extract<WinCheckResult, { status: 'win' | 'draw' }>;

// ========================================
// Redis key 辅助
// ========================================

function starsKey(battleId: string, side: Side): string {
  return `battle:${battleId}:stars:${side}`;
}

function aliveKey(battleId: string, side: Side): string {
  return `battle:${battleId}:alive_${side}`;
}

function basesKey(battleId: string): string {
  return `battle:${battleId}:bases`;
}

function piecesKey(battleId: string): string {
  return `battle:${battleId}:pieces`;
}

function positionsKey(battleId: string): string {
  return `battle:${battleId}:positions`;
}

// ========================================
// 公共函数（Task 3-6 逐步实现）
// ========================================

/**
 * T052 §3.1: 应用击杀 star — 见 Task 3 完整实现
 */
export async function applyKillStars(
  battleId: string,
  preStepAliveMap: Record<string, boolean>
): Promise<KillStarDelta> {
  throw new Error('applyKillStars: not implemented');
}

/**
 * T052 §3.1: 应用据点 star — 见 Task 4 完整实现
 */
export async function applyBaseStars(battleId: string): Promise<BaseStarDelta> {
  throw new Error('applyBaseStars: not implemented');
}

/**
 * T052 §3.1: 检查胜利条件 — 见 Task 5 完整实现
 */
export async function checkWinCondition(battleId: string): Promise<WinCheckResult> {
  throw new Error('checkWinCondition: not implemented');
}

/**
 * T052 §3.1: 记录胜利（持久化 + finishSession + 广播）— 见 Task 6 完整实现
 */
export async function recordVictory(
  io: IOServer,
  battleId: string,
  outcome: RecordVictoryOutcome
): Promise<void> {
  throw new Error('recordVictory: not implemented');
}

// ========================================
// 内部 helper（Task 3, 4 使用）
// ========================================

/**
 * 内部：把 stars 累加写回 Redis（INCRBY）+ DB（UPDATE）
 */
async function persistStars(
  battleId: string,
  side: Side,
  incrementBy: number
): Promise<{ newStars: number }> {
  throw new Error('persistStars: not implemented');
}

/**
 * 内部：把 pN alive 计数 -1
 */
async function decrementAlive(battleId: string, side: Side): Promise<void> {
  throw new Error('decrementAlive: not implemented');
}
