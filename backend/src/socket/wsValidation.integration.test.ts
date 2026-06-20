/**
 * T055 wsValidation 集成测试
 *
 * 真实 Redis Lua + 真实 PG battle row：
 *   - happy path
 *   - 真实 Redis INCR 计数器（跑满 60 后第 61 次被拒）
 *   - 真实 EXPIRE 过期（用 1s 窗口 + sleep 1.5s 加速验证）
 *   - 真实 PG：pending / finished / ongoing 三种状态
 *   - 不在 Socket.IO room: fake socket stub
 *
 * 假设：PG 5433 + Redis 6379 已通过 docker compose 启动
 */

import { redisClient, connectRedis, disconnectRedis } from '../config/redis';
import { queryOne, query, execute } from '../config/database';
import {
  validateOperationContext,
  validateJoinContext,
  checkRateLimit,
  RATE_LIMIT_KEY_PREFIX,
} from './wsValidation';
import type { BattleSocket } from './wsValidation';

// ============== Test Data Setup ==============

let testUserId: string;
let testPlayer1Id: string;
let testPlayer2Id: string;
let testBattleId: string;

const TEST_USERNAME = `wsval-test-${Date.now()}`;

/**
 * 创建一个最小 battle：1 user + 2 players + 1 battle
 * 返回 battleId
 */
async function createTestBattle(status: 'pending' | 'ongoing' | 'finished'): Promise<string> {
  // 1. 创建 user
  const user1 = await queryOne<{ id: string }>(
    `INSERT INTO users (username, password_hash) VALUES ($1, 'fake-hash') RETURNING id`,
    [`${TEST_USERNAME}-u1-${Math.random()}`]
  );
  const user2 = await queryOne<{ id: string }>(
    `INSERT INTO users (username, password_hash) VALUES ($1, 'fake-hash') RETURNING id`,
    [`${TEST_USERNAME}-u2-${Math.random()}`]
  );
  if (!user1 || !user2) throw new Error('Failed to create users');

  // 2. 创建 2 players
  const player1 = await queryOne<{ id: string }>(
    `INSERT INTO players (user_id) VALUES ($1) RETURNING id`,
    [user1.id]
  );
  const player2 = await queryOne<{ id: string }>(
    `INSERT INTO players (user_id) VALUES ($1) RETURNING id`,
    [user2.id]
  );
  if (!player1 || !player2) throw new Error('Failed to create players');

  // 3. 创建 battle
  const battle = await queryOne<{ id: string }>(
    `INSERT INTO battles (player1_id, player2_id, status) VALUES ($1, $2, $3) RETURNING id`,
    [player1.id, player2.id, status]
  );
  if (!battle) throw new Error('Failed to create battle');

  return battle.id;
}

async function deleteTestBattle(battleId: string): Promise<void> {
  // 找到 battle 的 players
  const battle = await queryOne<{ player1_id: string; player2_id: string }>(
    `SELECT player1_id, player2_id FROM battles WHERE id = $1`,
    [battleId]
  );
  if (!battle) return;

  // 先删 battle（解除 FK 约束），再删 players，最后 users CASCADE 删
  await execute(`DELETE FROM battles WHERE id = $1`, [battleId]);
  await execute(`DELETE FROM players WHERE id IN ($1, $2)`, [battle.player1_id, battle.player2_id]);
}

function createMockSocket(battleRoom: string | null): BattleSocket {
  const rooms = new Set<string>();
  rooms.add('socket-id-mock');
  if (battleRoom) rooms.add(battleRoom);
  return {
    rooms,
    data: { userId: 'user-1' },
  } as unknown as BattleSocket;
}

beforeAll(async () => {
  await connectRedis();

  // 真实 DB 联通性自检
  const row = await queryOne<{ now: string }>(`SELECT NOW() as now`);
  if (!row) throw new Error('PG not available');
});

afterAll(async () => {
  // 清理所有测试遗留 battle + players + users（按 username 前缀）
  const battles = await query<{ id: string }>(
    `SELECT b.id FROM battles b
     JOIN players p1 ON b.player1_id = p1.id
     JOIN users u1 ON p1.user_id = u1.id
     WHERE u1.username LIKE $1`,
    [`${TEST_USERNAME}%`]
  );
  for (const b of battles) {
    await deleteTestBattle(b.id);
  }

  // 清理所有 rate limit keys（test prefix）
  const keys = await redisClient.keys(`${RATE_LIMIT_KEY_PREFIX}*`);
  if (keys.length > 0) {
    await redisClient.del(keys);
  }

  await disconnectRedis();
});

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ========================================
// 1. Happy path — 真实 Redis + 真实 PG
// ========================================

describe('validateOperationContext — integration happy path', () => {
  it('case 1: 完整验证通过（真实 Redis INCR + 真实 PG status=ongoing）', async () => {
    testBattleId = await createTestBattle('ongoing');
    try {
      const socket = createMockSocket(`battle:${testBattleId}`);
      const result = await validateOperationContext(socket, {
        battleId: testBattleId,
        userId: 'user-1',
        eventName: 'battle:move',
      });
      expect(result.ok).toBe(true);

      // 真实 Redis：counter 应为 1
      const key = `${RATE_LIMIT_KEY_PREFIX}user-1:battle:move`;
      const count = await redisClient.get(key);
      expect(Number(count)).toBe(1);

      // 真实 Redis：EXPIRE 应设置（约 60s）
      const ttl = await redisClient.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(60);

      // 清理 counter 避免影响其他测试
      await redisClient.del(key);
    } finally {
      await deleteTestBattle(testBattleId);
    }
  });
});

// ========================================
// 2. Rate limit — 真实 Redis Lua 跑满 60 次
// ========================================

describe('validateOperationContext — integration rate limit', () => {
  it('case 2: 真实 Redis INCR 跑满 60 后第 61 次被拒', async () => {
    testBattleId = await createTestBattle('ongoing');
    const userId = `user-rl-${Date.now()}`;
    const key = `${RATE_LIMIT_KEY_PREFIX}${userId}:battle:move`;

    try {
      const socket = createMockSocket(`battle:${testBattleId}`);

      // 前 60 次应通过
      for (let i = 1; i <= 60; i++) {
        const result = await validateOperationContext(socket, {
          battleId: testBattleId,
          userId,
          eventName: 'battle:move',
        });
        expect(result.ok).toBe(true);
      }

      // 第 61 次应被拒
      const rejected = await validateOperationContext(socket, {
        battleId: testBattleId,
        userId,
        eventName: 'battle:move',
      });
      expect(rejected.ok).toBe(false);
      if (!rejected.ok) {
        expect(rejected.reason).toBe('rate_limited');
      }

      // 真实 Redis：counter 应该是 61
      const finalCount = await redisClient.get(key);
      expect(Number(finalCount)).toBe(61);
    } finally {
      await redisClient.del(key);
      await deleteTestBattle(testBattleId);
    }
  });

  it('case 3: 真实 EXPIRE 过期（用 1s 窗口加速）', async () => {
    const userId = `user-exp-${Date.now()}`;
    const key = `${RATE_LIMIT_KEY_PREFIX}${userId}:battle:move`;

    try {
      // 先快速灌满 1 次
      await redisClient.incr(key);
      // 强制 1s TTL（替代 60s 等待）
      await redisClient.expire(key, 1);

      const ttlBefore = await redisClient.ttl(key);
      expect(ttlBefore).toBeGreaterThan(0);

      // 等 1.5s 让 key 过期
      await new Promise(r => setTimeout(r, 1500));

      // 检查 counter 不应阻塞（key 已过期 → count=1 重新开始）
      const result = await checkRateLimit(userId, 'battle:move');
      expect(result.ok).toBe(true);

      const countAfter = await redisClient.get(key);
      expect(Number(countAfter)).toBe(1);
    } finally {
      await redisClient.del(key);
    }
  });

  it('case 4: 不同事件独立计数（真实 Redis keys 隔离）', async () => {
    const userId = `user-iso-${Date.now()}`;
    try {
      // 灌满 battle:move 60 次
      for (let i = 0; i < 60; i++) {
        await redisClient.incr(`${RATE_LIMIT_KEY_PREFIX}${userId}:battle:move`);
        if (i === 0) {
          await redisClient.expire(`${RATE_LIMIT_KEY_PREFIX}${userId}:battle:move`, 60);
        }
      }

      // battle:move 第 61 次应被拒
      const moveResult = await checkRateLimit(userId, 'battle:move');
      expect(moveResult.ok).toBe(false);
      if (!moveResult.ok) expect(moveResult.reason).toBe('rate_limited');

      // battle:play_card 独立计数，应通过
      const cardResult = await checkRateLimit(userId, 'battle:play_card');
      expect(cardResult.ok).toBe(true);
    } finally {
      await redisClient.del([
        `${RATE_LIMIT_KEY_PREFIX}${userId}:battle:move`,
        `${RATE_LIMIT_KEY_PREFIX}${userId}:battle:play_card`,
      ]);
    }
  });
});

// ========================================
// 3. Battle status — 真实 PG
// ========================================

describe('validateOperationContext — integration PG status', () => {
  it("case 5a: 真实 PG status='pending' → battle_not_ongoing", async () => {
    testBattleId = await createTestBattle('pending');
    try {
      const socket = createMockSocket(`battle:${testBattleId}`);
      const result = await validateOperationContext(socket, {
        battleId: testBattleId,
        userId: 'user-1',
        eventName: 'battle:move',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('battle_not_ongoing');
        expect(result.message).toContain('pending');
      }
    } finally {
      await deleteTestBattle(testBattleId);
    }
  });

  it("case 5b: 真实 PG status='finished' → battle_not_ongoing", async () => {
    testBattleId = await createTestBattle('finished');
    try {
      const socket = createMockSocket(`battle:${testBattleId}`);
      const result = await validateOperationContext(socket, {
        battleId: testBattleId,
        userId: 'user-1',
        eventName: 'battle:move',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('battle_not_ongoing');
        expect(result.message).toContain('finished');
      }
    } finally {
      await deleteTestBattle(testBattleId);
    }
  });

  it("case 5c: 真实 PG status='ongoing' → ok (除其他校验外)", async () => {
    testBattleId = await createTestBattle('ongoing');
    try {
      const socket = createMockSocket(`battle:${testBattleId}`);
      const result = await validateOperationContext(socket, {
        battleId: testBattleId,
        userId: 'user-1',
        eventName: 'battle:move',
      });
      expect(result.ok).toBe(true);

      // 清理 counter
      await redisClient.del(`${RATE_LIMIT_KEY_PREFIX}user-1:battle:move`);
    } finally {
      await deleteTestBattle(testBattleId);
    }
  });

  it('case 5d: 真实 PG 不存在的 battleId → battle_not_found', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const socket = createMockSocket(`battle:${fakeId}`);
    const result = await validateOperationContext(socket, {
      battleId: fakeId,
      userId: 'user-1',
      eventName: 'battle:move',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // fakeId 不会在真实 PG 找到,但 socket 必须在 battle room 才能进入 status 检查
      // 此处 room membership 优先 fail（fake socket stub 不在 fakeId room）
      // 实际上 mockSocket 加了 fakeId room,所以会进入 status 检查
      expect(result.reason).toBe('battle_not_found');
    }
  });
});

// ========================================
// 4. Room membership — fake socket stub
// ========================================

describe('validateOperationContext — integration room membership', () => {
  it('case 6a: socket 不在目标 battle room → not_in_room（不查 PG/Redis）', async () => {
    testBattleId = await createTestBattle('ongoing');
    try {
      // socket stub 加入的是 battle:other，不是 testBattleId
      const socket = createMockSocket('battle:other-room');
      const result = await validateOperationContext(socket, {
        battleId: testBattleId,
        userId: 'user-1',
        eventName: 'battle:move',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('not_in_room');
    } finally {
      await deleteTestBattle(testBattleId);
    }
  });
});

// ========================================
// 5. validateJoinContext — 真实 Redis
// ========================================

describe('validateJoinContext — integration', () => {
  it('case 7: 真实 Redis rate limit 应用到 battle:join 事件', async () => {
    const userId = `user-join-${Date.now()}`;
    const key = `${RATE_LIMIT_KEY_PREFIX}${userId}:battle:join`;

    try {
      // 前 60 次通过
      for (let i = 1; i <= 60; i++) {
        const result = await validateJoinContext(userId, 'battle:join');
        expect(result.ok).toBe(true);
      }
      // 第 61 次被拒
      const rejected = await validateJoinContext(userId, 'battle:join');
      expect(rejected.ok).toBe(false);
      if (!rejected.ok) expect(rejected.reason).toBe('rate_limited');
    } finally {
      await redisClient.del(key);
    }
  });
});