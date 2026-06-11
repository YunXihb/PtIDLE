import { redisClient } from '../config/redis';
import { query, queryOne } from '../config/database';
import {
  canUseProfession,
  getTauntRedirect,
  onWarriorAttackCardPlayed,
  applyWarriorTaunt,
  onRangerAttackCardPlayed,
  getRangerDamageBoost,
  attachFireMark,
} from './professionMechanicService';

// ========================================
// 战棋常量
// ========================================

export const BOARD_SIZE = 9; // 9x9 棋盘
export const MAX_COORDINATE = BOARD_SIZE - 1; // 最大坐标值 8
export const MIN_COORDINATE = 0; // 最小坐标值 0

// ========================================
// 类型定义
// ========================================

export interface BoardPosition {
  x: number;
  y: number;
}

export interface BattlePiece {
  character_id: string;
  player_id: string;
  profession: string;
  name: string;
  health: number;
  max_health: number;
  movement: number;
  energy: number;
  max_energy: number;
  position_x: number | null;
  position_y: number | null;
  is_alive: boolean;
}

export interface BattleState {
  battle_id: string;
  board: Map<string, string>; // key: "x,y", value: character_id
  pieces: Map<string, BattlePiece>; // key: character_id
}

// ========================================
// 坐标辅助函数
// ========================================

/**
 * 将坐标转为字符串 key
 */
export function positionToKey(x: number, y: number): string {
  return `${x},${y}`;
}

/**
 * 将字符串 key 转为坐标
 */
export function keyToPosition(key: string): BoardPosition {
  const [x, y] = key.split(',').map(Number);
  return { x, y };
}

/**
 * 验证坐标是否在棋盘范围内
 */
export function isValidCoordinate(x: number, y: number): boolean {
  return (
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= MIN_COORDINATE &&
    x <= MAX_COORDINATE &&
    y >= MIN_COORDINATE &&
    y <= MAX_COORDINATE
  );
}

/**
 * 计算两个坐标之间的曼哈顿距离
 */
export function manhattanDistance(p1: BoardPosition, p2: BoardPosition): number {
  return Math.abs(p1.x - p2.x) + Math.abs(p1.y - p2.y);
}

/**
 * 计算两点之间的直线距离（用于远程攻击判定）
 */
export function euclideanDistance(p1: BoardPosition, p2: BoardPosition): number {
  return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

// ========================================
// 棋盘服务（Redis）
// ========================================

/**
 * 获取 Redis 棋盘位置 key
 */
function getBoardPositionsKey(battleId: string): string {
  return `battle:${battleId}:positions`;
}

/**
 * 获取 Redis 棋子信息 key
 */
function getBattlePiecesKey(battleId: string): string {
  return `battle:${battleId}:pieces`;
}

/**
 * 初始化棋盘
 * @param battleId 对战 ID
 * @returns 初始化的棋盘状态
 */
export async function initializeBoard(battleId: string): Promise<BattleState> {
  // 初始化空棋盘（所有位置为空）
  const board = new Map<string, string>();
  const pieces = new Map<string, BattlePiece>();

  // 清除可能存在的旧数据
  await redisClient.del(getBoardPositionsKey(battleId));
  await redisClient.del(getBattlePiecesKey(battleId));

  return {
    battle_id: battleId,
    board,
    pieces,
  };
}

/**
 * 检查位置是否可用（没有棋子占用）
 * @param battleId 对战 ID
 * @param x 坐标
 * @param y 坐标
 */
export async function isPositionAvailable(
  battleId: string,
  x: number,
  y: number
): Promise<boolean> {
  const key = getBoardPositionsKey(battleId);

  if (!isValidCoordinate(x, y)) {
    return false;
  }

  const existing = await redisClient.hGet(key, positionToKey(x, y));
  return existing === null;
}

/**
 * 获取指定位置的棋子 ID
 * @param battleId 对战 ID
 * @param x 坐标
 * @param y 坐标
 * @returns 棋子 ID 或 null
 */
export async function getCharacterIdAtPosition(
  battleId: string,
  x: number,
  y: number
): Promise<string | null> {
  const key = getBoardPositionsKey(battleId);

  if (!isValidCoordinate(x, y)) {
    return null;
  }

  const characterId = await redisClient.hGet(key, positionToKey(x, y));
  return characterId ?? null;
}

/**
 * 将棋子放置到棋盘位置
 * @param battleId 对战 ID
 * @param characterId 棋子 ID
 * @param x 坐标
 * @param y 坐标
 * @returns 是否成功（失败表示位置已被占用）
 */
export async function placeCharacter(
  battleId: string,
  characterId: string,
  x: number,
  y: number
): Promise<boolean> {
  const positionsKey = getBoardPositionsKey(battleId);

  if (!isValidCoordinate(x, y)) {
    return false;
  }

  // 使用 HSETNX 保证原子性：仅当位置为空时设置
  // 返回 true 表示设置成功，false 表示键已存在
  return await redisClient.hSetNX(positionsKey, positionToKey(x, y), characterId);
}

/**
 * 从棋盘位置移除棋子
 * @param battleId 对战 ID
 * @param x 坐标
 * @param y 坐标
 */
export async function removeCharacterFromPosition(
  battleId: string,
  x: number,
  y: number
): Promise<void> {
  const key = getBoardPositionsKey(battleId);

  if (!isValidCoordinate(x, y)) {
    return;
  }

  await redisClient.hDel(key, positionToKey(x, y));
}

/**
 * 移动棋子到新位置
 * @param battleId 对战 ID
 * @param characterId 棋子 ID
 * @param fromX 起始坐标
 * @param fromY 起始坐标
 * @param toX 目标坐标
 * @param toY 目标坐标
 * @returns 是否成功
 */
export async function moveCharacter(
  battleId: string,
  characterId: string,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number
): Promise<boolean> {
  const positionsKey = getBoardPositionsKey(battleId);
  const fromKey = positionToKey(fromX, fromY);
  const toKey = positionToKey(toX, toY);

  if (!isValidCoordinate(fromX, fromY) || !isValidCoordinate(toX, toY)) {
    return false;
  }

  // 验证起始位置确实是该棋子
  const existingCharId = await redisClient.hGet(positionsKey, fromKey);
  if (existingCharId !== characterId) {
    return false;
  }

  // 验证目标位置是否为空
  const targetOccupied = await redisClient.hGet(positionsKey, toKey);
  if (targetOccupied !== null) {
    return false; // 目标位置已被占用
  }

  // 原子性移动：删除旧位置，设置新位置
  await redisClient.hDel(positionsKey, fromKey);
  await redisClient.hSet(positionsKey, toKey, characterId);

  return true;
}

/**
 * 获取棋盘上所有位置状态
 * @param battleId 对战 ID
 * @returns Map of position key to character id
 */
export async function getAllBoardPositions(
  battleId: string
): Promise<Map<string, string>> {
  const key = getBoardPositionsKey(battleId);

  const positions = await redisClient.hGetAll(key);
  const result = new Map<string, string>();

  for (const [posKey, charId] of Object.entries(positions)) {
    result.set(posKey, charId);
  }

  return result;
}

/**
 * 获取指定棋子的位置
 * @param battleId 对战 ID
 * @param characterId 棋子 ID
 * @returns 位置坐标或 null
 */
export async function getCharacterPosition(
  battleId: string,
  characterId: string
): Promise<BoardPosition | null> {
  const positions = await getAllBoardPositions(battleId);

  for (const [posKey, charId] of positions.entries()) {
    if (charId === characterId) {
      return keyToPosition(posKey);
    }
  }

  return null;
}

/**
 * 清理对战棋盘数据
 * @param battleId 对战 ID
 */
export async function cleanupBattleBoard(battleId: string): Promise<void> {
  await redisClient.del(getBoardPositionsKey(battleId));
  await redisClient.del(getBattlePiecesKey(battleId));
}

// ========================================
// 移动判定逻辑
// ========================================

export interface MovementValidationResult {
  valid: boolean;
  error?: string;
  distance?: number;
  path?: BoardPosition[];
}

/**
 * 获取棋子的移动力
 * 从职业配置中获取
 */
async function getCharacterMovement(
  battleId: string,
  characterId: string
): Promise<number | null> {
  // 从 Redis 获取棋子信息
  const piecesKey = getBattlePiecesKey(battleId);
  const pieceData = await redisClient.hGet(piecesKey, characterId);

  if (pieceData) {
    const piece = JSON.parse(pieceData);
    return piece.movement;
  }

  // 如果 Redis 没有，从数据库获取
  const result = await query<{ movement: number }>(
    'SELECT movement FROM characters WHERE id = $1',
    [characterId]
  );

  return result.length > 0 ? result[0].movement : null;
}

/**
 * BFS 寻路算法
 * @param board 棋盘状态 (position key -> character id)
 * @param start 起始位置
 * @param maxDistance 最大移动距离
 * @returns 可到达的位置及其最短路径
 */
function bfsFindReachablePositions(
  board: Map<string, string>,
  start: BoardPosition,
  maxDistance: number
): Map<string, BoardPosition[]> {
  const reachable = new Map<string, BoardPosition[]>();
  const visited = new Set<string>();
  const queue: { pos: BoardPosition; path: BoardPosition[] }[] = [];

  // 4 个方向移动
  const directions = [
    { dx: 0, dy: -1 }, // 上
    { dx: 0, dy: 1 },  // 下
    { dx: -1, dy: 0 }, // 左
    { dx: 1, dy: 0 },  // 右
  ];

  queue.push({ pos: start, path: [start] });
  visited.add(positionToKey(start.x, start.y));

  while (queue.length > 0) {
    const { pos, path } = queue.shift()!;
    const currentDist = path.length - 1;

    if (currentDist > maxDistance) {
      continue;
    }

    // 记录可到达的位置（不包含起点）
    if (currentDist > 0) {
      reachable.set(positionToKey(pos.x, pos.y), path);
    }

    for (const { dx, dy } of directions) {
      const nx = pos.x + dx;
      const ny = pos.y + dy;
      const key = positionToKey(nx, ny);

      // 检查是否访问过
      if (visited.has(key)) {
        continue;
      }

      // 检查坐标是否有效
      if (!isValidCoordinate(nx, ny)) {
        continue;
      }

      // 检查是否有障碍物（不包含起点，起点击穿）
      if (board.has(key)) {
        continue;
      }

      visited.add(key);
      queue.push({
        pos: { x: nx, y: ny },
        path: [...path, { x: nx, y: ny }],
      });
    }
  }

  return reachable;
}

/**
 * 验证移动是否合法（完整路径检查）
 * @param battleId 对战 ID
 * @param characterId 棋子 ID
 * @param toX 目标坐标
 * @param toY 目标坐标
 * @returns 验证结果
 */
export async function validateMovement(
  battleId: string,
  characterId: string,
  toX: number,
  toY: number
): Promise<MovementValidationResult> {
  // 1. 验证目标坐标是否有效
  if (!isValidCoordinate(toX, toY)) {
    return { valid: false, error: 'Invalid target coordinate' };
  }

  // 2. 获取棋子当前位置
  const currentPos = await getCharacterPosition(battleId, characterId);
  if (!currentPos) {
    return { valid: false, error: 'Character not on board' };
  }

  // 3. 如果目标就是当前位置，无效
  if (currentPos.x === toX && currentPos.y === toY) {
    return { valid: false, error: 'Already at target position' };
  }

  // 4. 获取棋子移动力
  const movement = await getCharacterMovement(battleId, characterId);
  if (movement === null) {
    return { valid: false, error: 'Character movement not found' };
  }

  // 5. 获取棋盘状态
  const board = await getAllBoardPositions(battleId);

  // 6. 目标位置有障碍物
  const targetKey = positionToKey(toX, toY);
  if (board.has(targetKey)) {
    return { valid: false, error: 'Target position is occupied' };
  }

  // 7. BFS 寻路
  const reachable = bfsFindReachablePositions(board, currentPos, movement);

  // 8. 检查目标是否在可达范围内
  if (!reachable.has(targetKey)) {
    const dist = manhattanDistance(currentPos, { x: toX, y: toY });
    if (dist > movement) {
      return { valid: false, error: `Target too far (distance: ${dist}, movement: ${movement})` };
    }
    return { valid: false, error: 'No valid path to target' };
  }

  // 9. 返回成功结果（含路径供前端高亮）
  return {
    valid: true,
    distance: reachable.get(targetKey)!.length - 1,
    path: reachable.get(targetKey),
  };
}

/**
 * 获取棋子可到达的所有位置
 * @param battleId 对战 ID
 * @param characterId 棋子 ID
 * @returns 可到达位置 Map (position key -> path)
 */
export async function getReachablePositions(
  battleId: string,
  characterId: string
): Promise<Map<string, BoardPosition[]>> {
  // 获取棋子当前位置
  const currentPos = await getCharacterPosition(battleId, characterId);
  if (!currentPos) {
    return new Map();
  }

  // 获取棋子移动力
  const movement = await getCharacterMovement(battleId, characterId);
  if (movement === null) {
    return new Map();
  }

  // 获取棋盘状态
  const board = await getAllBoardPositions(battleId);

  // BFS 寻路
  return bfsFindReachablePositions(board, currentPos, movement);
}

// ========================================
// 攻击判定逻辑
// ========================================

export interface CardEffect {
  damage?: number;
  range?: number;
  aoe?: boolean;
  heal?: number;
  shield?: number;
  movement?: number;
}

export interface AttackValidationResult {
  valid: boolean;
  error?: string;
  damage?: number;             // 单体：单一伤害；AOE：基础伤害（未应用 boost）
  targets?: string[];          // 目标 ID 列表
  energyCost?: number;
  forcedTarget?: string;       // T039 嘲讽重定向
  shieldGained?: number;       // T039 warrior 攻击累计触发
  // T040 ranger 机制 1：攻击累计增伤
  damageBoosted?: boolean;     // 本次攻击是否应用了 damage_boost
  damageBoostValue?: number;   // 增伤比例（如 0.5 表示 1.5×）
  primaryTargetId?: string;    // AOE 主体目标（targets[0]）；单体 = targets[0]
  damagePerTarget?: number[];  // AOE 各 target 最终伤害（含 boost 应用到 primary）
  // T041 mage 机制 2：debuff/灼伤系统
  mageMarkApplied?: boolean;   // 单体：本次是否成功附加 1 个 fire mark
  mageMarksApplied?: number;   // AOE：本次成功附加 mark 的 target 数
  mageBurnTriggered?: boolean; // 本次是否触发了 burn 转换（任一 target）
}

/**
 * 从 Redis 或数据库获取棋子完整信息
 */
async function getCharacterPiece(
  battleId: string,
  characterId: string
): Promise<BattlePiece | null> {
  const piecesKey = getBattlePiecesKey(battleId);
  const pieceData = await redisClient.hGet(piecesKey, characterId);

  if (pieceData) {
    return JSON.parse(pieceData);
  }

  // 如果 Redis 没有，从数据库获取
  const result = await query<{
    id: string;
    player_id: string;
    profession: string;
    name: string;
    health: number;
    max_health: number;
    movement: number;
    energy: number;
    max_energy: number;
    position_x: number | null;
    position_y: number | null;
    is_alive: boolean;
  }>(
    `SELECT id, player_id, profession, name, health, max_health, movement,
            energy, max_energy, position_x, position_y, is_alive
     FROM characters WHERE id = $1`,
    [characterId]
  );

  if (!result || result.length === 0) {
    return null;
  }

  const row = result[0];
  return {
    character_id: row.id,
    player_id: row.player_id,
    profession: row.profession,
    name: row.name,
    health: row.health,
    max_health: row.max_health,
    movement: row.movement,
    energy: row.energy,
    max_energy: row.max_energy,
    position_x: row.position_x,
    position_y: row.position_y,
    is_alive: row.is_alive,
  };
}

/**
 * 获取玩家卡牌信息（包含效果、类型、职业）
 * T039：LEFT JOIN card_templates 拿 profession 和 type
 * T1001：source='deck' 走 player_cards；source='public_pool' 走 card_templates
 */
async function getPlayerCard(
  cardId: string,
  source: 'deck' | 'public_pool' = 'deck'
): Promise<{
  id: string;
  player_id: string | null;  // T1001 公共池卡无 player_id
  cost: number;
  effect: CardEffect;
  type: string | null;
  profession: string | null;
} | null> {
  if (source === 'public_pool') {
    // T1001：公共池卡走 card_templates 表（无 player_cards 实例）
    const result = await query<{
      id: string;
      cost: number;
      effect: Record<string, unknown>;
      type: string | null;
      profession: string | null;
    }>(
      `SELECT id, cost, effect, type, profession
       FROM card_templates
       WHERE id = $1 AND is_public_pool = TRUE`,
      [cardId]
    );

    if (!result || result.length === 0) {
      return null;
    }

    const row = result[0];
    return {
      id: row.id,
      player_id: null,  // 公共池无归属
      cost: row.cost,
      effect: row.effect as CardEffect,
      type: row.type,
      profession: row.profession,
    };
  }

  // deck 路径：保持 T039 行为
  const result = await query<{
    id: string;
    player_id: string;
    cost: number;
    effect: Record<string, unknown>;
    type: string | null;
    profession: string | null;
  }>(
    `SELECT pc.id, pc.player_id, pc.cost, pc.effect, pc.type, ct.profession
     FROM player_cards pc
     LEFT JOIN card_templates ct ON pc.card_template_id = ct.id
     WHERE pc.id = $1`,
    [cardId]
  );

  if (!result || result.length === 0) {
    return null;
  }

  const row = result[0];
  return {
    id: row.id,
    player_id: row.player_id,
    cost: row.cost,
    effect: row.effect as CardEffect,
    type: row.type,
    profession: row.profession,
  };
}

/**
 * 计算伤害值
 * 未来可扩展职业加成
 */
function calculateDamage(cardEffect: CardEffect, attackerProfession?: string): number {
  return cardEffect.damage ?? 0;
}

/**
 * 获取范围内所有敌方目标
 * @param battleId 对战 ID
 * @param attackerPos 攻击者位置
 * @param range 射程
 * @param attackerPlayerId 攻击者玩家 ID（排除己方单位）
 * @returns 范围内所有敌方棋子 ID 列表
 */
async function getTargetsInRange(
  battleId: string,
  attackerPos: BoardPosition,
  range: number,
  attackerPlayerId: string
): Promise<string[]> {
  const positions = await getAllBoardPositions(battleId);
  const targets: string[] = [];

  for (const [posKey, charId] of positions.entries()) {
    const targetPos = keyToPosition(posKey);
    const distance = euclideanDistance(attackerPos, targetPos);

    // 检查是否在射程内
    if (distance > range) {
      continue;
    }

    // 获取目标棋子信息，检查是否存活和阵营
    const targetPiece = await getCharacterPiece(battleId, charId);
    if (!targetPiece || !targetPiece.is_alive) {
      continue;
    }

    // 排除己方单位
    if (targetPiece.player_id === attackerPlayerId) {
      continue;
    }

    targets.push(charId);
  }

  return targets;
}

/**
 * 验证单体攻击是否合法
 * @param battleId 对战 ID
 * @param attackerId 攻击者棋子 ID
 * @param cardId 玩家卡牌 ID (player_card_id) 或 卡牌模板 ID（T1001 public_pool）
 * @param targetId 目标棋子 ID
 * @param currentRound 当前 battle round（T039 注入）
 * @param source 卡牌来源（'deck' | 'public_pool'，T1001 注入）
 * @returns 验证结果
 */
export async function validateAttack(
  battleId: string,
  attackerId: string,
  cardId: string,
  targetId: string,
  currentRound: number = 0,
  source: 'deck' | 'public_pool' = 'deck'
): Promise<AttackValidationResult> {
  // 1. 获取攻击者棋子信息
  const attacker = await getCharacterPiece(battleId, attackerId);
  if (!attacker) {
    return { valid: false, error: 'Attacker not found' };
  }

  // 2. 检查攻击者是否存活
  if (!attacker.is_alive) {
    return { valid: false, error: 'Attacker is not alive' };
  }

  // 3. 获取卡牌信息（T1001：source 决定走哪条 SQL 路径）
  const card = await getPlayerCard(cardId, source);
  if (!card) {
    return { valid: false, error: 'Card not found' };
  }

  // 4. 验证卡牌归属（公共池卡无 player_id，跳过此检查）
  if (source === 'deck' && card.player_id !== attacker.player_id) {
    return { valid: false, error: 'Card does not belong to attacker' };
  }

  // 5. T039 职业-卡牌匹配校验
  if (!canUseProfession(attacker.profession, card.profession)) {
    return {
      valid: false,
      error: `Character profession '${attacker.profession}' cannot use card profession '${card.profession}'`,
    };
  }

  // 6. 能量检查
  const energyCost = card.cost;
  if (attacker.energy < energyCost) {
    return {
      valid: false,
      error: `Not enough energy (need ${energyCost}, have ${attacker.energy})`,
      energyCost,
    };
  }

  // 7. 获取目标棋子信息
  const target = await getCharacterPiece(battleId, targetId);
  if (!target) {
    return { valid: false, error: 'Target not found' };
  }

  // 8. 检查目标是否存活
  if (!target.is_alive) {
    return { valid: false, error: 'Target is not alive' };
  }

  // 9. 阵营验证（不能攻击己方单位）
  if (target.player_id === attacker.player_id) {
    return { valid: false, error: 'Cannot attack friendly target' };
  }

  // 10. T039 嘲讽读取：若 target 被嘲讽，必须攻击 source warrior
  const tauntRedirect = await getTauntRedirect(battleId, attackerId, targetId, currentRound);
  if (tauntRedirect.mustRedirectTo && tauntRedirect.mustRedirectTo !== targetId) {
    return {
      valid: false,
      error: `Target '${targetId}' is taunted by '${tauntRedirect.sourceId}', must attack that warrior instead`,
      forcedTarget: tauntRedirect.mustRedirectTo,
    };
  }

  // 11. 射程验证
  const attackerPos = await getCharacterPosition(battleId, attackerId);
  const targetPos = await getCharacterPosition(battleId, targetId);

  if (!attackerPos || !targetPos) {
    return { valid: false, error: 'Character position not found' };
  }

  const distance = euclideanDistance(attackerPos, targetPos);
  const cardEffect = card.effect;

  // 近战卡牌（无 range 字段或 range 为 1）
  const isMelee = !cardEffect.range || cardEffect.range === 1;
  const maxRange = cardEffect.range ?? 1; // 近战默认为 1

  if (isMelee) {
    // 近战：欧几里得距离 ≤ 1.5（相邻格子）
    if (distance > 1.5) {
      return { valid: false, error: `Target out of range (melee range: 1.5, actual: ${distance.toFixed(2)})` };
    }
  } else {
    // 远程：欧几里得距离 ≤ range
    if (distance > maxRange) {
      return { valid: false, error: `Target out of range (range: ${maxRange}, actual: ${distance.toFixed(2)})` };
    }
  }

  // 12. 计算伤害
  const damage = calculateDamage(cardEffect, attacker.profession);

  // 13. T039 warrior 机制 1：攻击累计护盾触发（T1001：公共池卡不计入累计）
  let shieldGained: number | undefined;
  if (
    attacker.profession === 'warrior' &&
    card.type === 'attack' &&
    source !== 'public_pool'
  ) {
    const result = await onWarriorAttackCardPlayed(battleId, attackerId, card.cost, currentRound);
    if (result.shieldGained > 0) {
      shieldGained = result.shieldGained;
    }
  }

  // 14. T040 ranger 机制 1：攻击累计增伤触发 + 读取 boost
  // - 累加 ranger counter；触发时写入 damage_boost effect
  // - 检查 active boost → 标记 damageBoosted=true（应用 1.5× 在 T056 applyDamage 阶段）
  // - 公共池卡不计入累积
  let damageBoosted: boolean | undefined;
  let damageBoostValue: number | undefined;
  if (
    attacker.profession === 'ranger' &&
    card.type === 'attack' &&
    source !== 'public_pool'
  ) {
    await onRangerAttackCardPlayed(battleId, attackerId, currentRound);
    const existingBoost = await getRangerDamageBoost(battleId, attackerId, currentRound);
    if (existingBoost) {
      damageBoosted = true;
      damageBoostValue = existingBoost.value;
    }
  }

  // 15. T041 mage 机制 2：附加 fire mark
  // - mage 攻击命中 target → 附加 1 个 fire mark
  // - 公共池卡不附加 mark
  // - target 已有 active burn → mark 被忽略
  // - 2 mark 触发 burn（attachFireMark 内部处理）
  let mageMarkApplied: boolean | undefined;
  let mageBurnTriggered: boolean | undefined;
  if (
    attacker.profession === 'mage' &&
    card.type === 'attack' &&
    source !== 'public_pool'
  ) {
    const result = await attachFireMark(battleId, targetId, currentRound, source);
    mageMarkApplied = result.marksAdded;
    mageBurnTriggered = result.burnTriggered;
  }

  return {
    valid: true,
    damage,
    targets: [targetId],
    energyCost,
    shieldGained,
    damageBoosted,
    damageBoostValue,
    primaryTargetId: targetId,    // 单体主体 = 唯一 target
    mageMarkApplied,
    mageBurnTriggered,
  };
}

/**
 * 验证 AOE 攻击是否合法
 * @param battleId 对战 ID
 * @param attackerId 攻击者棋子 ID
 * @param cardId 玩家卡牌 ID (player_card_id) 或 卡牌模板 ID（T1001 public_pool）
 * @param source 卡牌来源（'deck' | 'public_pool'，T1001 注入）
 * @returns 验证结果（包含所有有效目标）
 */
export async function validateAOEAttack(
  battleId: string,
  attackerId: string,
  cardId: string,
  source: 'deck' | 'public_pool' = 'deck'
): Promise<AttackValidationResult> {
  // 1. 获取攻击者棋子信息
  const attacker = await getCharacterPiece(battleId, attackerId);
  if (!attacker) {
    return { valid: false, error: 'Attacker not found' };
  }

  // 2. 检查攻击者是否存活
  if (!attacker.is_alive) {
    return { valid: false, error: 'Attacker is not alive' };
  }

  // 3. 获取卡牌信息（T1001：source 决定走哪条 SQL 路径）
  const card = await getPlayerCard(cardId, source);
  if (!card) {
    return { valid: false, error: 'Card not found' };
  }

  // 4. 验证卡牌归属（公共池卡无 player_id，跳过此检查）
  if (source === 'deck' && card.player_id !== attacker.player_id) {
    return { valid: false, error: 'Card does not belong to attacker' };
  }

  // 5. T039 职业-卡牌匹配校验
  if (!canUseProfession(attacker.profession, card.profession)) {
    return {
      valid: false,
      error: `Character profession '${attacker.profession}' cannot use card profession '${card.profession}'`,
    };
  }

  // 6. 能量检查
  const energyCost = card.cost;
  if (attacker.energy < energyCost) {
    return {
      valid: false,
      error: `Not enough energy (need ${energyCost}, have ${attacker.energy})`,
      energyCost,
    };
  }

  // 7. 检查是否为 AOE 卡牌
  if (!card.effect.aoe) {
    return { valid: false, error: 'Card is not an AOE attack' };
  }

  // 8. 获取射程
  const range = card.effect.range ?? 2; // AOE 默认射程 2

  // 9. 获取攻击者位置
  const attackerPos = await getCharacterPosition(battleId, attackerId);
  if (!attackerPos) {
    return { valid: false, error: 'Attacker position not found' };
  }

  // 10. 获取范围内所有敌方目标
  const targets = await getTargetsInRange(battleId, attackerPos, range, attacker.player_id);

  if (targets.length === 0) {
    return { valid: false, error: 'No targets in range' };
  }

  // 11. 计算伤害
  const damage = calculateDamage(card.effect, attacker.profession);

  // 12. T040 ranger 机制 1：攻击累计增伤触发 + 读取 boost
  // - 与单体同模式：累加 + 写 boost（如触发） + 读 active boost
  // - AOE 路径暂 hardcode currentRound=0（T051 衔接时再补参数）
  // - 公共池卡不计入累积
  let damageBoosted: boolean | undefined;
  let damageBoostValue: number | undefined;
  if (
    attacker.profession === 'ranger' &&
    card.type === 'attack' &&
    source !== 'public_pool'
  ) {
    await onRangerAttackCardPlayed(battleId, attackerId, 0);
    const existingBoost = await getRangerDamageBoost(battleId, attackerId, 0);
    if (existingBoost) {
      damageBoosted = true;
      damageBoostValue = existingBoost.value;
    }
  }

  // 13. 计算 AOE 主体目标 + 各 target 伤害
  // - 主体目标 = targets[0]
  // - damagePerTarget[i] = boost 应用到 primary (i===0)，其他保持基础伤害
  const primaryTargetId = targets[0];
  let damagePerTarget: number[] | undefined;
  if (damageBoosted && damageBoostValue !== undefined && primaryTargetId) {
    damagePerTarget = targets.map((t, i) =>
      i === 0 ? Math.ceil(damage * (1 + damageBoostValue)) : damage
    );
  }

  // 14. T041 mage 机制 2：AOE 每个 target 附加 fire mark
  // - mage AOE 攻击命中 → 每个 target 获得 1 个 fire mark
  // - 公共池卡不附加 mark
  // - AOE 路径暂 hardcode currentRound=0（T051 衔接时再补参数）
  let mageMarksApplied: number | undefined;
  let mageBurnTriggered: boolean | undefined;
  if (
    attacker.profession === 'mage' &&
    card.type === 'attack' &&
    source !== 'public_pool'
  ) {
    let count = 0;
    let anyBurnTriggered = false;
    for (const targetId of targets) {
      const result = await attachFireMark(battleId, targetId, 0, source);
      if (result.marksAdded) count++;
      if (result.burnTriggered) anyBurnTriggered = true;
    }
    mageMarksApplied = count;
    mageBurnTriggered = anyBurnTriggered;
  }

  return {
    valid: true,
    damage,
    targets,
    energyCost,
    damageBoosted,
    damageBoostValue,
    primaryTargetId,
    damagePerTarget,
    mageMarksApplied,
    mageBurnTriggered,
  };
}

// ========================================
// T039 Warrior 机制 2：嘲讽（挑战卡）
// ========================================

/**
 * 验证并应用「挑战」卡
 * - warrior 存在 + alive + profession === 'warrior'
 * - cardId 存在 + effect.type === 'taunt'
 * - 能量足够
 * - target 存在 + alive + 是 enemy
 * - target 在 warrior range 内
 * - 写入 taunt effect
 */
export async function validateTauntCard(
  battleId: string,
  warriorId: string,
  cardId: string,
  targetId: string,
  currentRound: number
): Promise<AttackValidationResult> {
  // 1. warrior 存在
  const warrior = await getCharacterPiece(battleId, warriorId);
  if (!warrior) {
    return { valid: false, error: 'Warrior not found' };
  }
  if (!warrior.is_alive) {
    return { valid: false, error: 'Warrior is not alive' };
  }
  if (warrior.profession !== 'warrior') {
    return { valid: false, error: 'Taunt card can only be used by warrior' };
  }

  // 2. card 存在 + 类型校验
  const card = await getPlayerCard(cardId);
  if (!card) {
    return { valid: false, error: 'Card not found' };
  }
  if (card.player_id !== warrior.player_id) {
    return { valid: false, error: 'Card does not belong to warrior' };
  }
  // 卡 effect.type 必须是 'taunt'
  const cardEffectType = (card.effect as { type?: string }).type;
  if (cardEffectType !== 'taunt') {
    return { valid: false, error: 'Card is not a taunt card' };
  }
  // 职业匹配
  if (!canUseProfession(warrior.profession, card.profession)) {
    return {
      valid: false,
      error: `Character profession '${warrior.profession}' cannot use card profession '${card.profession}'`,
    };
  }

  // 3. 能量检查
  const energyCost = card.cost;
  if (warrior.energy < energyCost) {
    return {
      valid: false,
      error: `Not enough energy (need ${energyCost}, have ${warrior.energy})`,
      energyCost,
    };
  }

  // 4. 目标存在 + 存活 + 是 enemy
  const target = await getCharacterPiece(battleId, targetId);
  if (!target) {
    return { valid: false, error: 'Target not found' };
  }
  if (!target.is_alive) {
    return { valid: false, error: 'Target is not alive' };
  }
  if (target.player_id === warrior.player_id) {
    return { valid: false, error: 'Cannot taunt friendly target' };
  }

  // 5. range 检查 + 写入 effect
  const range = (card.effect as { range?: number }).range ?? 3;
  const tauntResult = await applyWarriorTaunt(
    battleId,
    warriorId,
    targetId,
    range,
    currentRound,
    async (b, c) => {
      const pos = await getCharacterPosition(b, c);
      return pos;
    },
    async (b, c) => {
      const p = await getCharacterPiece(b, c);
      if (!p) return null;
      return {
        id: p.character_id,
        profession: p.profession as 'warrior' | 'ranger' | 'mage',
        is_alive: p.is_alive,
        health: p.health,
        max_health: p.max_health,
        position_x: p.position_x,
        position_y: p.position_y,
        player_id: p.player_id,
      };
    }
  );

  if (!tauntResult.success) {
    return { valid: false, error: tauntResult.error };
  }

  return {
    valid: true,
    targets: [targetId],
    energyCost,
  };
}

// ========================================
// T044 撮合：battles 行持久化
// ========================================

/**
 * battles 表的最小行结构（T044 INSERT 必需字段 + 几个 metadata 字段）
 */
export interface PendingBattle {
  id: string;
  player1_id: string;
  player2_id: string;
  status: 'pending' | 'ongoing' | 'finished';
  matched_at: Date;
  started_at: Date | null;
}

/**
 * 创建一场 pending 状态的 battle 行（T044 撮合后写入）。
 *
 * 字段最小化：仅写 player1/2 + status='pending' + matched_at=NOW()。
 * 其余字段依赖 schema DEFAULT（current_round=1, current_step=0, current_actor_id=NULL,
 * current_phase='idle', battle_data='{}', created_at=NOW(), started_at=NULL,
 * winner_id=NULL, duration=0）。
 *
 * 双层防 dup 兜底：
 *   - 调用方先做「OR player1/2」预查询（防 dup 查询）
 *   - 本函数使用 ON CONFLICT (player1_id, player2_id) WHERE status='pending' DO NOTHING
 *     走 partial unique index（migration 007）。如果 INSERT 被 ON CONFLICT 拦截，返回 null。
 *
 * @param p1Id player1（先入队者）的 player_id
 * @param p2Id player2（后入队者）的 player_id
 * @returns 新 battle id；若被 dup index 拦截返回 null
 */
export async function createPendingBattle(
  p1Id: string,
  p2Id: string
): Promise<string | null> {
  const result = await queryOne<{ id: string }>(
    `INSERT INTO battles (player1_id, player2_id, status, matched_at)
     VALUES ($1, $2, 'pending', NOW())
     ON CONFLICT (player1_id, player2_id) WHERE status = 'pending'
     DO NOTHING
     RETURNING id`,
    [p1Id, p2Id]
  );

  return result?.id ?? null;
}

/**
 * 根据 player_id 查询其作为参与方的 pending battle（T044 LOSER 恢复路径）。
 *
 * 返回最新的一行 pending battle（按 matched_at DESC）。
 *
 * @param playerId player_id
 * @returns pending battle 或 null
 */
export async function getPendingBattleByPlayerId(
  playerId: string
): Promise<PendingBattle | null> {
  const result = await queryOne<PendingBattle>(
    `SELECT id, player1_id, player2_id, status, matched_at, started_at
     FROM battles
     WHERE (player1_id = $1 OR player2_id = $1)
       AND status = 'pending'
     ORDER BY matched_at DESC
     LIMIT 1`,
    [playerId]
  );

  return result;
}

/**
 * T046 房间加入鉴权:根据 battleId + userId 验证 user 是该 battle 的参与者。
 *
 * - 仅匹配 status='pending' 的 battle（已开始 / 已结束的不允许 join 房间）
 * - userId 通过 players.user_id 关联到 player1_id / player2_id
 * - 返回 battle 行（不含任何敏感信息，调用方按需展示）
 *
 * @param battleId battle id
 * @param userId users.id（socket.data.userId）
 * @returns pending battle 或 null（不参与者 / battle 不存在 / status 非 pending）
 */
export async function getPendingBattleForJoin(
  battleId: string,
  userId: string
): Promise<PendingBattle | null> {
  const result = await queryOne<PendingBattle>(
    `SELECT b.id, b.player1_id, b.player2_id, b.status, b.matched_at, b.started_at
     FROM battles b
     WHERE b.id = $1
       AND b.status = 'pending'
       AND (
         b.player1_id IN (SELECT id FROM players WHERE user_id = $2)
         OR b.player2_id IN (SELECT id FROM players WHERE user_id = $2)
       )
     LIMIT 1`,
    [battleId, userId]
  );

  return result;
}

/**
 * T047:列出 battle 中所有 character（双边 6 个,3v3 / 不同规模同理）。
 *
 * 单次 SQL 往返,JOIN `players` 拿到 userId,直接返回扁平结构。
 * 主要供 WS broadcaster 用来:
 *   1. 遍历全场 character 状态(`buildBoardState`)
 *   2. 反查某 userId 拥有哪些 characterId(`broadcastFullState` 时筛 ownHand)
 *
 * 注意:不区分 `is_alive` / `battles.status`,broadcaster 拿到列表后自行过滤。
 *
 * @param battleId battle id
 * @returns [{ characterId, playerId, userId, profession, name }, ...],按 character_id 升序
 */
export async function listCharactersInBattle(
  battleId: string
): Promise<
  Array<{
    characterId: string;
    playerId: string;
    userId: string;
    profession: string;
    name: string;
  }>
> {
  const result = await query<{
    character_id: string;
    player_id: string;
    user_id: string;
    profession: string;
    name: string;
  }>(
    `SELECT c.id AS character_id, c.player_id, p.user_id, c.profession, c.name
     FROM characters c
     JOIN players p ON p.id = c.player_id
     WHERE c.player_id IN (
       SELECT player1_id FROM battles WHERE id = $1
       UNION
       SELECT player2_id FROM battles WHERE id = $1
     )
     ORDER BY c.id ASC`,
    [battleId]
  );

  if (!result) {
    return [];
  }

  return result.map((r) => ({
    characterId: r.character_id,
    playerId: r.player_id,
    userId: r.user_id,
    profession: r.profession,
    name: r.name,
  }));
}
