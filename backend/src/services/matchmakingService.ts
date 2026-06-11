import { redisClient } from '../config/redis';

/**
 * T042 范围：仅实现「加入匹配队列」。
 *
 * 明确不做（Out of Scope）：
 *   1. 队列状态查询 / 取消匹配                  -> T043
 *   2. 撮合算法（2 玩家配对 + 3v3 校验）        -> T044
 *   3. 创建 battles 行（需 schema 调整）        -> T044
 *   4. 角色选择 / loadout 校验                  -> T044/T048
 *   5. 匹配超时 / 强制取消                       -> T044+
 *   6. WebSocket 推送「匹配成功」                -> T045+
 *   7. 持久化到 players 表（如 in_matchmaking） -> 后续
 *
 * 存储：Redis-only（battles 表当前 schema 不支持「在队列中」状态）。
 * 撮合时（T044）可用 ZRANGE key 0 0 O(log N) 取出最久等待者。
 */

// 全局匹配队列（sorted set，score = enqueuedAt ms 时间戳）
const MATCHMAKING_QUEUE_KEY = 'idle:matchmaking:queue';

// 单用户去重锁前缀（防止同一玩家并发重复入队）
const MATCHMAKING_LOCK_PREFIX = 'idle:matchmaking:lock:';

// 锁 TTL（秒）—— 远大于一般匹配等待时间，足以兜底
const MATCHMAKING_LOCK_TTL = 600;

export interface MatchQueueEntry {
  userId: string;
  enqueuedAt: number;
}

/**
 * 将玩家加入匹配队列。
 *
 * 关键顺序：必须「先抢锁、后入队」，反向顺序会导致并发场景下同一玩家入队两次。
 *
 * @param userId 玩家用户 ID
 * @returns 入队记录（含入队时间戳）
 * @throws Error('已在匹配队列中') 当玩家已在队列时
 */
export async function enqueueMatchmaking(userId: string): Promise<MatchQueueEntry> {
  const lockKey = `${MATCHMAKING_LOCK_PREFIX}${userId}`;

  // 1. 原子去重：SET NX EX —— 仅当 key 不存在时设置成功
  const lockResult = await redisClient.set(lockKey, '1', {
    NX: true,
    EX: MATCHMAKING_LOCK_TTL,
  });

  if (lockResult !== 'OK') {
    throw new Error('已在匹配队列中');
  }

  // 2. 抢到锁后入队（score = 入队时间戳，便于 T044 取最久等待者）
  const enqueuedAt = Date.now();
  const entry: MatchQueueEntry = { userId, enqueuedAt };

  await redisClient.zAdd(MATCHMAKING_QUEUE_KEY, {
    score: enqueuedAt,
    value: JSON.stringify(entry),
  });

  return entry;
}

/**
 * 检查玩家是否已在匹配队列中。
 *
 * 注：当前实现扫描全队列。队列规模大时可考虑改为查 lock key 存在性。
 *
 * @param userId 玩家用户 ID
 * @returns true 表示在队列中
 */
export async function isPlayerInQueue(userId: string): Promise<boolean> {
  const allEntries = await redisClient.zRange(MATCHMAKING_QUEUE_KEY, 0, -1);

  for (const entryStr of allEntries) {
    const entry = JSON.parse(entryStr) as MatchQueueEntry;
    if (entry.userId === userId) {
      return true;
    }
  }

  return false;
}

/**
 * 获取匹配队列统计信息。
 */
export async function getMatchmakingQueueStats(): Promise<{
  pendingPlayers: number;
  oldestEnqueuedAt: number | null;
  newestEnqueuedAt: number | null;
}> {
  const pendingPlayers = await redisClient.zCard(MATCHMAKING_QUEUE_KEY);

  let oldestEnqueuedAt: number | null = null;
  let newestEnqueuedAt: number | null = null;

  if (pendingPlayers > 0) {
    const oldest = await redisClient.zRange(MATCHMAKING_QUEUE_KEY, 0, 0);
    const newest = await redisClient.zRange(MATCHMAKING_QUEUE_KEY, -1, -1);

    if (oldest.length > 0) {
      oldestEnqueuedAt = (JSON.parse(oldest[0]) as MatchQueueEntry).enqueuedAt;
    }
    if (newest.length > 0) {
      newestEnqueuedAt = (JSON.parse(newest[0]) as MatchQueueEntry).enqueuedAt;
    }
  }

  return {
    pendingPlayers,
    oldestEnqueuedAt,
    newestEnqueuedAt,
  };
}

/**
 * 清空匹配队列（测试用）。
 *
 * 注：仅清队列本身，不清各玩家的 lock keys。若测试需要同时清理锁，
 * 应在测试 afterEach 中手动 del lock key 或使用 redis.flushDb()。
 */
export async function clearMatchmakingQueue(): Promise<void> {
  await redisClient.del(MATCHMAKING_QUEUE_KEY);
}
