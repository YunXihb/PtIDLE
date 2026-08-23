// 对局计时服务单测 (T1014)
// redis 用内存 Map 模拟 string + zset，真实复现 arm/clear 语义

jest.mock('../config/redis', () => {
  const store = new Map<string, string>();
  const zset = new Map<string, number>();
  return {
    redisClient: {
      get: async (k: string) => store.get(k) ?? null,
      set: async (k: string, v: string) => {
        store.set(k, v);
        return 'OK';
      },
      del: async (k: string) => {
        store.delete(k);
        return 1;
      },
      zAdd: async (_k: string, m: { score: number; value: string }) => {
        zset.set(m.value, m.score);
        return 1;
      },
      zRem: async (_k: string, ...members: string[]) => {
        let n = 0;
        for (const m of members) {
          if (zset.delete(m)) n++;
        }
        return n;
      },
      zScore: async (_k: string, member: string) => zset.get(member) ?? null,
      __store: store,
      __zset: zset,
    },
  };
});

import { redisClient } from '../config/redis';
import { redisKey } from '../utils/redisKeys';
import {
  armStepDeadline,
  clearStepDeadline,
  getStepDeadline,
  armDeploymentDeadline,
  clearDeploymentDeadline,
  deadlineMember,
  parseDeadlineMember,
  STEP_DURATION_MS,
} from './battleDeadlineService';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const store = (redisClient as any).__store as Map<string, string>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const zset = (redisClient as any).__zset as Map<string, number>;

const BATTLE_ID = 'b1';

describe('battleDeadlineService (T1014)', () => {
  beforeEach(() => {
    store.clear();
    zset.clear();
  });

  describe('armStepDeadline / clearStepDeadline / getStepDeadline', () => {
    it('arm 写入步时记录 + 索引条目（score ≈ now + 90s）', async () => {
      const before = Date.now();
      const record = await armStepDeadline(BATTLE_ID, 2, 'char-x');
      const after = Date.now();

      expect(record).not.toBeNull();
      expect(record!.battleId).toBe(BATTLE_ID);
      expect(record!.step).toBe(2);
      expect(record!.actorId).toBe('char-x');

      // 记录 key 可读回
      const loaded = await getStepDeadline(BATTLE_ID);
      expect(loaded).toEqual(record);

      // 索引条目 score 在 [before+90s, after+90s]
      const score = zset.get(deadlineMember.step(BATTLE_ID));
      expect(score).toBeGreaterThanOrEqual(before + STEP_DURATION_MS);
      expect(score).toBeLessThanOrEqual(after + STEP_DURATION_MS);

      // 记录 deadline 与 score 一致
      expect(Date.parse(record!.deadline)).toBe(score);
    });

    it('clear 同时删除记录 key 与索引条目', async () => {
      await armStepDeadline(BATTLE_ID, 0, 'char-a');
      await clearStepDeadline(BATTLE_ID);

      expect(await getStepDeadline(BATTLE_ID)).toBeNull();
      expect(zset.has(deadlineMember.step(BATTLE_ID))).toBe(false);
      expect(store.has(redisKey.stepDeadline(BATTLE_ID))).toBe(false);
    });

    it('get 对损坏 JSON 返回 null（防御性解析）', async () => {
      store.set(redisKey.stepDeadline(BATTLE_ID), '{not-json');
      expect(await getStepDeadline(BATTLE_ID)).toBeNull();
    });

    it('get 对不存在的 key 返回 null', async () => {
      expect(await getStepDeadline('nope')).toBeNull();
    });
  });

  describe('armDeploymentDeadline / clearDeploymentDeadline', () => {
    it('arm/clear 操作索引条目', async () => {
      const deadline = Date.now() + 120_000;
      await armDeploymentDeadline(BATTLE_ID, deadline);
      expect(zset.get(deadlineMember.deployment(BATTLE_ID))).toBe(deadline);

      await clearDeploymentDeadline(BATTLE_ID);
      expect(zset.has(deadlineMember.deployment(BATTLE_ID))).toBe(false);
    });
  });

  describe('parseDeadlineMember', () => {
    it('解析 deploy/step 两种 member', () => {
      expect(parseDeadlineMember('deploy:b1')).toEqual({ type: 'deploy', battleId: 'b1' });
      expect(parseDeadlineMember('step:b2')).toEqual({ type: 'step', battleId: 'b2' });
    });

    it('非法 member 返回 null', () => {
      expect(parseDeadlineMember('other:b1')).toBeNull();
      expect(parseDeadlineMember('deploy:')).toBeNull();
      expect(parseDeadlineMember('no-colon')).toBeNull();
      expect(parseDeadlineMember('')).toBeNull();
    });
  });
});
