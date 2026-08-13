// ========================================
// 移动范围计算（客户端 BFS，对齐后端 bfsFindReachablePositions）
// 后端: battleService.bfsFindReachablePositions -- 4 方向(上下左右,无对角),
//   maxDistance=movement, 阻塞=getAllBoardPositions(含死棋, 死亡不移除位置),
//   起点穿透, 返回可达格(不含起点)
//
// 前端 occupancy 信号: board.characters 中 position!=null 的格(与后端
//   getAllBoardPositions 同源 -- getCharacterStatus.position 即从此 hash 派生)
//
// 注: 客户端范围仅为 UX 提示, 服务端 validateMovement 会再次校验,
//   不匹配时回 battle:move:error 优雅降级
// ========================================

export interface BoardPos {
  x: number;
  y: number;
}

const BOARD_SIZE = 9;
const DIRECTIONS = [
  { dx: 0, dy: -1 }, // 上
  { dx: 0, dy: 1 }, // 下
  { dx: -1, dy: 0 }, // 左
  { dx: 1, dy: 0 }, // 右
];

function inBounds(x: number, y: number): boolean {
  return x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE;
}

/**
 * BFS 计算从 start 出发、移动力 movement 内可达的格子集合。
 * @param occupied "x,y" key 集合(被棋子占据的格, 含当前 actor 自身位置)
 * @param start 起始坐标
 * @param movement 移动力(最大步数)
 * @returns 可达格 "x,y" key 集合(不含起点)
 */
export function computeReachableCells(
  occupied: Set<string>,
  start: BoardPos,
  movement: number
): Set<string> {
  const reachable = new Set<string>();
  if (movement <= 0) return reachable;

  const visited = new Set<string>();
  const queue: { pos: BoardPos; dist: number }[] = [];
  const startKey = `${start.x},${start.y}`;

  queue.push({ pos: start, dist: 0 });
  visited.add(startKey);

  while (queue.length > 0) {
    const { pos, dist } = queue.shift()!;
    // 记录可达(不含起点)
    if (dist > 0) reachable.add(`${pos.x},${pos.y}`);
    // 已达最大步数, 不再扩展
    if (dist >= movement) continue;

    for (const { dx, dy } of DIRECTIONS) {
      const nx = pos.x + dx;
      const ny = pos.y + dy;
      const k = `${nx},${ny}`;
      if (visited.has(k)) continue;
      if (!inBounds(nx, ny)) continue;
      if (occupied.has(k)) continue; // 阻塞
      visited.add(k);
      queue.push({ pos: { x: nx, y: ny }, dist: dist + 1 });
    }
  }

  return reachable;
}
