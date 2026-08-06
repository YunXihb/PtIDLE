import { randomUUID } from 'crypto';
import { redisClient } from '../config/redis';
import { queryOne } from '../config/database';
import { getPlayerIdByUserId } from './playerService';
import { countAliveCharacters } from './characterService';
import {
  createPendingBattle,
  getPendingBattleByPlayerId,
  PendingBattle,
} from './battleService';

/**
 * 带错误码的业务异常（T-FIX：controller 不再用 `.includes('中文')` 匹配错误）
 */
export class MatchmakingError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = 'MatchmakingError';
  }
}

/**
 * T042 + T043 范围：实现「加入匹配队列 + 查询队列状态 + 取消匹配」。
 * T044 扩展：实现「撮合两个等待者 + 创建 battles 行 + 通知双方跳战场」。
 *
 * T044 明确不做（Out of Scope）：
 *   1. 撮合超时（撮合后 N 分钟未进入 T048 → 强制退出）       -> T044+
 *   2. 撮合后通过 WS 实时通知 LOSER                           -> T045
 *   3. 撮合后任一方不响应 → 胜者自动胜利                     -> T046+
 *   4. 撮合失败告警 / 监控                                    -> T044+
 *   5. O(1) EXISTS 优化（替代 zRange 全扫）                   -> T044+
 *   6. 撮合失败递归找下一个候选                              -> T044+
 *   7. 撮合锁被占时 client 退避重试                           -> T044+
 *   8. orphan lock 自愈 cron                                 -> T044+
 *
 * 存储：Redis-only 队列（battles 表当前 schema 不支持「在队列中」状态）。
 * 撮合时可用 ZRANGE key 0 0 O(log N) 取出最久等待者。
 */

// 全局匹配队列（sorted set，score = enqueuedAt ms 时间戳）
const MATCHMAKING_QUEUE_KEY = 'idle:matchmaking:queue';

// 单用户去重锁前缀（防止同一玩家并发重复入队）
const MATCHMAKING_LOCK_PREFIX = 'idle:matchmaking:lock:';

// 全局撮合锁（防止并发撮合冲突）
const MATCHMAKING_GLOBAL_LOCK_KEY = 'idle:matchmaking:lock:global';

// 锁 TTL（秒）—— 远大于一般匹配等待时间，足以兜底
const MATCHMAKING_LOCK_TTL = 600;

// 全局撮合锁 TTL（秒）—— 5 秒窗口期，远大于一次 tryMatch 调用时长
const MATCHMAKING_GLOBAL_LOCK_TTL = 5;

export interface MatchQueueEntry {
  userId: string;
  enqueuedAt: number;
}

export interface MatchQueueStatus {
  userId: string;
  enqueuedAt: number;
  waitingSeconds: number;
}

/**
 * 撮合结果（tryMatch 返回值）。
 *
 * - matched: true → 撮合成功（含 battleId + opponentUserId）
 * - matched: false → 撮合失败，rejectionReason 标识具体原因
 */
export type TryMatchResult =
  | {
      matched: true;
      battleId: string;
      opponentUserId: string;
    }
  | {
      matched: false;
      rejectionReason:
        | 'lock_failed'
        | 'no_candidate'
        | 'self_not_eligible'
        | 'opponent_not_eligible';
    };

// ========================================
// Lua 脚本（T044 撮合核心）
// ========================================

/**
 * LUA_PICK_CANDIDATE: 验证 token → 续期锁 → ZRANGE 找最早等待者（排除 self）→ ZREM 候选。
 *
 * 输入（KEYS）：
 *   KEYS[1] = queue sorted set key
 *   KEYS[2] = global lock key
 * 输入（ARGV）：
 *   ARGV[1] = self userId
 *   ARGV[2] = lock token
 *   ARGV[3] = lock TTL（秒）
 *   ARGV[4] = max candidate scan size（默认 50）
 *
 * 返回（数组）：
 *   - {0, 'NOT_HOLDER'}        token 不匹配
 *   - {0, 'NO_CANDIDATE'}      队列无候选
 *   - {1, picked_userId, picked_entry_str}
 */
const LUA_PICK_CANDIDATE = `
local queue_key = KEYS[1]
local lock_key = KEYS[2]
local self_user = ARGV[1]
local token = ARGV[2]
local ttl = tonumber(ARGV[3])
local max_scan = tonumber(ARGV[4])

-- 1. 验证 token 是当前锁持有者
local current = redis.call('GET', lock_key)
if current ~= token then
  return {0, 'NOT_HOLDER'}
end

-- 2. 续期全局锁（避免长 DB 调用期间过期）
redis.call('EXPIRE', lock_key, ttl)

-- 3. ZRANGE 找候选（排除 self）
local entries = redis.call('ZRANGE', queue_key, 0, max_scan - 1)
for i, entry_str in ipairs(entries) do
  -- entry_str 是 JSON: {"userId":"...","enqueuedAt":...}
  local user_id = nil
  local ok, parsed = pcall(cjson.decode, entry_str)
  if ok and type(parsed) == 'table' and parsed.userId then
    user_id = parsed.userId
  end

  if user_id and user_id ~= self_user then
    -- 4. 原子认领：ZREM 候选（先于 DB 查询，避免重复处理）
    local removed = redis.call('ZREM', queue_key, entry_str)
    if removed == 1 then
      return {1, user_id, entry_str}
    end
  end
end

return {0, 'NO_CANDIDATE'}
`;

/**
 * LUA_RELEASE_CLEANUP: 验证 token → ZREM self + DEL self lock + DEL picked lock + DEL global lock。
 *
 * 输入（KEYS）：
 *   KEYS[1] = queue sorted set key
 *   KEYS[2] = self lock key
 *   KEYS[3] = picked lock key（可能不存在，DEL 幂等）
 *   KEYS[4] = global lock key
 * 输入（ARGV）：
 *   ARGV[1] = self userId
 *   ARGV[2] = token
 *   ARGV[3] = self entry_str（从外部传入，匹配 ZRANGE 结果）
 *   ARGV[4] = picked entry_str（从外部传入，可选；nil 时跳过 ZREM picked）
 *
 * 返回：
 *   - {0, 'NOT_HOLDER'}   token 不匹配
 *   - {1}                  清理成功
 */
const LUA_RELEASE_CLEANUP = `
local queue_key = KEYS[1]
local self_lock_key = KEYS[2]
local picked_lock_key = KEYS[3]
local global_lock_key = KEYS[4]
local self_user = ARGV[1]
local token = ARGV[2]
local self_entry_str = ARGV[3]
local picked_entry_str = ARGV[4]

-- 1. 验证 token
local current = redis.call('GET', global_lock_key)
if current ~= token then
  return {0, 'NOT_HOLDER'}
end

-- 2. ZREM self entry（如果还在队列中）
if self_entry_str and self_entry_str ~= '' then
  redis.call('ZREM', queue_key, self_entry_str)
end

-- 3. ZREM picked entry（兜底：LUA_PICK_CANDIDATE 已 ZREM 过，但保险起见再确认）
if picked_entry_str and picked_entry_str ~= '' then
  redis.call('ZREM', queue_key, picked_entry_str)
end

-- 4. 释放所有锁
redis.call('DEL', self_lock_key)
redis.call('DEL', picked_lock_key)
redis.call('DEL', global_lock_key)

return {1}
`;

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
    throw new MatchmakingError('已在匹配队列中', 'ALREADY_IN_QUEUE');
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
 * 查询玩家在匹配队列中的状态。
 *
 * 注：当前实现扫描全队列。队列规模大时可考虑改为查 lock key 存在性。
 *
 * @param userId 玩家用户 ID
 * @returns MatchQueueStatus（含 waitingSeconds）；不在队列返回 null
 */
export async function getMatchmakingStatus(userId: string): Promise<MatchQueueStatus | null> {
  const allEntries = await redisClient.zRange(MATCHMAKING_QUEUE_KEY, 0, -1);

  for (const entryStr of allEntries) {
    const entry = JSON.parse(entryStr) as MatchQueueEntry;
    if (entry.userId === userId) {
      // waitingSeconds clamp 至 ≥0（防时钟回拨）
      const waitingSeconds = Math.max(0, Math.floor((Date.now() - entry.enqueuedAt) / 1000));
      return {
        userId: entry.userId,
        enqueuedAt: entry.enqueuedAt,
        waitingSeconds,
      };
    }
  }

  return null;
}

/**
 * 取消匹配（离开队列 + 释放锁）。
 *
 * 关键顺序：必须「先离队、后释锁」，反向顺序会导致崩溃窗口期内用户重新入队后队列残留旧 entry。
 * 当前顺序的崩溃窗口仅造成「队列已清、锁残留 ≤600s」，自然过期自愈。
 *
 * T044 边界：若玩家已被撮合走（不在队列但 lock 已被 LUA 释放），本函数抛「不在匹配队列中」。
 * 控制器层（matchmakingController.leaveMatchmakingHandler）会再走一次「pending battle」查询，
 * 若有则返 409 Conflict + battleId。
 *
 * @param userId 玩家用户 ID
 * @returns 被移除的 entry（便于审计）
 * @throws Error('不在匹配队列中') 当玩家不在队列时
 */
export async function leaveMatchmaking(userId: string): Promise<MatchQueueEntry> {
  // 1. 先扫描找到该 userId 的 entry（拿到完整 JSON 串，因为 zRem 需要）
  const allEntries = await redisClient.zRange(MATCHMAKING_QUEUE_KEY, 0, -1);

  let targetEntry: MatchQueueEntry | null = null;
  let targetEntryStr: string | null = null;

  for (const entryStr of allEntries) {
    const entry = JSON.parse(entryStr) as MatchQueueEntry;
    if (entry.userId === userId) {
      targetEntry = entry;
      targetEntryStr = entryStr;
      break;
    }
  }

  if (!targetEntry || targetEntryStr === null) {
    throw new MatchmakingError('不在匹配队列中', 'NOT_IN_QUEUE');
  }

  // 2. ZREM 先、DEL lock 后（T042「lock first → zAdd」的天然反序）
  await redisClient.zRem(MATCHMAKING_QUEUE_KEY, targetEntryStr);

  // 3. 释放锁（幂等 —— 即使锁已过期，DEL 也只是返回 0）
  const lockKey = `${MATCHMAKING_LOCK_PREFIX}${userId}`;
  await redisClient.del(lockKey);

  return targetEntry;
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

// ========================================
// T044 撮合：tryMatch + 内部辅助
// ========================================

const MATCH_MIN_ALIVE = 3;
const LUA_CANDIDATE_SCAN_SIZE = 50;

/**
 * 撮合核心：尝试为 triggerUserId 撮合对手。
 *
 * 流程：
 *   1. SETNX global lock（抢到 token 后才能进入撮合）
 *   2. LUA_PICK_CANDIDATE: 验证 token + 续期锁 + ZRANGE 找候选（排除 self）+ ZREM 候选
 *   3. 双 alive 校验（self + picked）
 *   4. 双层防 dup：DB 预查询 + ON CONFLICT 兜底
 *   5. INSERT battles 行（status='pending', matched_at=NOW()）
 *   6. LUA_RELEASE_CLEANUP: 清 queue + lockA + lockB + global
 *
 * p1/p2 决定：FIFO，先入队者为 p1（对应 pickedUserId），后入队者为 p2（对应 triggerUserId）。
 *
 * @param triggerUserId 触发本次撮合的玩家 userId
 * @returns 撮合结果（含 battleId / opponentUserId / rejectionReason）
 */
export async function tryMatch(triggerUserId: string): Promise<TryMatchResult> {
  const token = randomUUID();

  // 1. SETNX global lock
  const lockResult = await redisClient.set(
    MATCHMAKING_GLOBAL_LOCK_KEY,
    token,
    {
      NX: true,
      EX: MATCHMAKING_GLOBAL_LOCK_TTL,
    }
  );

  if (lockResult !== 'OK') {
    return { matched: false, rejectionReason: 'lock_failed' };
  }

  let pickedUserId: string | null = null;
  let pickedEntryStr: string | null = null;
  let selfEntryStr: string | null = null;

  try {
    // 2. LUA_PICK_CANDIDATE
    const pickResult = (await redisClient.eval(LUA_PICK_CANDIDATE, {
      keys: [MATCHMAKING_QUEUE_KEY, MATCHMAKING_GLOBAL_LOCK_KEY],
      arguments: [
        triggerUserId,
        token,
        String(MATCHMAKING_GLOBAL_LOCK_TTL),
        String(LUA_CANDIDATE_SCAN_SIZE),
      ],
    })) as [number, string, string?];

    const [pickCode, pickInfo, pickPayload] = pickResult;

    if (pickCode !== 1) {
      if (pickInfo === 'NOT_HOLDER') {
        // token 不匹配 —— 不应该发生（刚 SETNX 完），保险抛错
        throw new Error('LUA_PICK_CANDIDATE: token mismatch');
      }
      // NO_CANDIDATE
      // 释放全局锁
      await safeReleaseGlobalLock(token);
      return { matched: false, rejectionReason: 'no_candidate' };
    }

    pickedUserId = pickInfo;
    pickedEntryStr = pickPayload ?? null;

    // 拿 self entry_str（用于后续 cleanup）
    selfEntryStr = await findAndGetSelfEntryStr(triggerUserId);

    // 3. 双 alive 校验
    const selfPlayerId = await getPlayerIdByUserId(triggerUserId);
    const pickedPlayerId = await getPlayerIdByUserId(pickedUserId);

    if (!selfPlayerId) {
      // self 没有 player 记录 → 撮合失败 + self 已在 queue 中待清理
      await safeReleaseGlobalLock(token);
      // 触发后续 cleanup
      throw new Error(`Player not found for userId ${triggerUserId}`);
    }

    if (!pickedPlayerId) {
      // picked 没有 player 记录 → 撮合失败 + picked 已被 LUA ZREM
      // 走 cleanup 路径（picked 的 lock 还在 600s 内自然过期）
      await safeReleaseGlobalLock(token);
      // 触发后续 cleanup
      throw new Error(`Player not found for userId ${pickedUserId}`);
    }

    const selfAlive = await countAliveCharacters(selfPlayerId);
    if (selfAlive < MATCH_MIN_ALIVE) {
      // self 不合格 → cleanup self（zRem + del self lock）+ release global
      await cleanupFailedCandidate(
        triggerUserId,
        pickedUserId,
        selfEntryStr,
        pickedEntryStr,
        token
      );
      return { matched: false, rejectionReason: 'self_not_eligible' };
    }

    const pickedAlive = await countAliveCharacters(pickedPlayerId);
    if (pickedAlive < MATCH_MIN_ALIVE) {
      // picked 不合格 → picked 已被 LUA ZREM，只需 del picked lock + release global
      // MVP 简化：不递归找下一个候选
      await cleanupFailedCandidate(
        triggerUserId,
        pickedUserId,
        selfEntryStr,
        pickedEntryStr,
        token
      );
      return { matched: false, rejectionReason: 'opponent_not_eligible' };
    }

    // 4. 双层防 dup：DB 预查询
    //    注意括号：OR 的两个分支都必须 AND status='pending'（否则可能命中已结束对战）
    const existingBattle = await queryOne<{ id: string }>(
      `SELECT id FROM battles
       WHERE ((player1_id = $1 AND player2_id = $2)
           OR (player1_id = $2 AND player2_id = $1))
         AND status = 'pending'
       LIMIT 1`,
      [selfPlayerId, pickedPlayerId]
    );

    if (existingBattle) {
      // 已存在（历史崩溃 / 重复撮合）→ 返回已有 battleId
      // 走 LUA_RELEASE_CLEANUP 清 queue + 所有 lock
      await releaseCleanup(
        triggerUserId,
        pickedUserId,
        selfEntryStr,
        pickedEntryStr,
        token
      );
      return {
        matched: true,
        battleId: existingBattle.id,
        opponentUserId: pickedUserId,
      };
    }

    // 5. INSERT battles 行（p1=先入队者=picked，p2=后入队者=trigger）
    const battleId = await createPendingBattle(pickedPlayerId, selfPlayerId);

    if (!battleId) {
      // 被 unique partial index 拦截（ON CONFLICT DO NOTHING）→ 返 dup 行的 id
      const dupBattle = await queryOne<{ id: string }>(
        `SELECT id FROM battles
         WHERE player1_id IN ($1, $2) AND player2_id IN ($1, $2)
           AND status = 'pending'
         ORDER BY matched_at DESC
         LIMIT 1`,
        [pickedPlayerId, selfPlayerId]
      );

      await releaseCleanup(
        triggerUserId,
        pickedUserId,
        selfEntryStr,
        pickedEntryStr,
        token
      );

      if (!dupBattle) {
        throw new Error('unique index conflict but no dup row found');
      }

      return {
        matched: true,
        battleId: dupBattle.id,
        opponentUserId: pickedUserId,
      };
    }

    // 6. LUA_RELEASE_CLEANUP
    await releaseCleanup(
      triggerUserId,
      pickedUserId,
      selfEntryStr,
      pickedEntryStr,
      token
    );

    return {
      matched: true,
      battleId,
      opponentUserId: pickedUserId,
    };
  } catch (err) {
    // 异常路径：保险释放全局锁
    await safeReleaseGlobalLock(token);
    throw err;
  }
}

/**
 * 释放全局撮合锁（异常 / no_candidate 路径使用）。
 * 验证 token 后再 DEL，避免误删他人锁。
 */
async function safeReleaseGlobalLock(token: string): Promise<void> {
  try {
    const luaRelease = `
      local lock_key = KEYS[1]
      local token = ARGV[1]
      local current = redis.call('GET', lock_key)
      if current == token then
        redis.call('DEL', lock_key)
        return 1
      end
      return 0
    `;
    await redisClient.eval(luaRelease, {
      keys: [MATCHMAKING_GLOBAL_LOCK_KEY],
      arguments: [token],
    });
  } catch (err) {
    // 异常路径不抛错（避免掩盖原始异常）
    console.error('safeReleaseGlobalLock failed:', err);
  }
}

/**
 * 找到 self 在 queue 中的 entry_str（用于 cleanup 时 ZREM）。
 */
async function findAndGetSelfEntryStr(userId: string): Promise<string | null> {
  const allEntries = await redisClient.zRange(MATCHMAKING_QUEUE_KEY, 0, -1);
  for (const entryStr of allEntries) {
    try {
      const entry = JSON.parse(entryStr) as MatchQueueEntry;
      if (entry.userId === userId) {
        return entryStr;
      }
    } catch {
      // 跳过非法 JSON
      continue;
    }
  }
  return null;
}

/**
 * 撮合失败时清理：ZREM self/picked entry + DEL 所有 lock + DEL global lock。
 * picked_entry_str 已在 LUA_PICK_CANDIDATE 中 ZREM，但 LUA 中再 ZREM 一次是幂等。
 */
async function cleanupFailedCandidate(
  selfUserId: string,
  pickedUserId: string,
  selfEntryStr: string | null,
  _pickedEntryStr: string | null,
  token: string
): Promise<void> {
  const selfLockKey = `${MATCHMAKING_LOCK_PREFIX}${selfUserId}`;
  const pickedLockKey = `${MATCHMAKING_LOCK_PREFIX}${pickedUserId}`;

  // 先 ZREM self（如果还在 queue 中）
  if (selfEntryStr) {
    await redisClient.zRem(MATCHMAKING_QUEUE_KEY, selfEntryStr);
  }

  // 释放 self lock
  await redisClient.del(selfLockKey);

  // 释放 picked lock（cleanup 路径需要把 picked 的锁也释放）
  await redisClient.del(pickedLockKey);

  // 释放 global lock
  await safeReleaseGlobalLock(token);
}

/**
 * 撮合成功后的清理：LUA_RELEASE_CLEANUP 一把梭（清 queue + 所有 lock + global lock）。
 */
async function releaseCleanup(
  selfUserId: string,
  pickedUserId: string,
  selfEntryStr: string | null,
  pickedEntryStr: string | null,
  token: string
): Promise<void> {
  const selfLockKey = `${MATCHMAKING_LOCK_PREFIX}${selfUserId}`;
  const pickedLockKey = `${MATCHMAKING_LOCK_PREFIX}${pickedUserId}`;

  const cleanupResult = (await redisClient.eval(LUA_RELEASE_CLEANUP, {
    keys: [
      MATCHMAKING_QUEUE_KEY,
      selfLockKey,
      pickedLockKey,
      MATCHMAKING_GLOBAL_LOCK_KEY,
    ],
    arguments: [
      selfUserId,
      token,
      selfEntryStr ?? '',
      pickedEntryStr ?? '',
    ],
  })) as [number, string];

  if (cleanupResult[0] !== 1) {
    // NOT_HOLDER
    throw new Error('LUA_RELEASE_CLEANUP: token mismatch');
  }
}

// ========================================
// 控制器层辅助：LOSER 恢复查询
// ========================================

/**
 * T044 控制器层辅助：根据 userId 查询其作为参与方的 pending battle（用于 GET /queue 兜底）。
 *
 * @param userId 玩家 userId
 * @returns pending battle 或 null
 */
export async function getUserPendingBattle(userId: string): Promise<PendingBattle | null> {
  const playerId = await getPlayerIdByUserId(userId);
  if (!playerId) {
    return null;
  }
  return getPendingBattleByPlayerId(playerId);
}
