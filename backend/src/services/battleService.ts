import { redisClient } from '../config/redis';
import { query } from '../config/database';

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
