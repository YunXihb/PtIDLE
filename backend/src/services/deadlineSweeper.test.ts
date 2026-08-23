// 到期扫描器单测 (T1014)
// mock 策略: 依赖的 battle 服务全部 jest.mock（startBattle/executeEndStep/
// getSessionState/readDeploymentState/database），redis 用内存 Map 模拟
// string + zset（zRangeByScore/zScore/zRem 真实排序语义），battleDeadlineService
// 用真实实现（与被测 sweeper 共享同一 mock redis）

const mockQueryOne = jest.fn();
const mockStartBattle = jest.fn();
const mockExecuteEndStep = jest.fn();
const mockGetSessionState = jest.fn();
const mockReadDeploymentState = jest.fn();

jest.mock('../config/database', () => ({
  queryOne: mockQueryOne,
  query: jest.fn(),
  execute: jest.fn(),
}));
jest.mock('./deploymentService', () => ({
  readDeploymentState: mockReadDeploymentState,
}));
jest.mock('./battleInitializationService', () => ({
  startBattle: mockStartBattle,
}));
jest.mock('./battleActionService', () => ({
  executeEndStep: mockExecuteEndStep,
}));
jest.mock('./battleSessionService', () => ({
  getSessionState: mockGetSessionState,
}));
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
      zRangeByScore: async (_k: string, min: number, max: number) =>
        [...zset.entries()]
          .filter(([, s]) => s >= min && s <= max)
          .sort((a, b) => a[1] - b[1])
          .map(([m]) => m),
      __store: store,
      __zset: zset,
    },
  };
});

import { redisClient } from '../config/redis';
import { redisKey } from '../utils/redisKeys';
import { sweepDeadlines, startDeadlineSweeper, stopDeadlineSweeper } from './deadlineSweeper';
import {
  deadlineMember,
  DEADLINE_RETRY_BACKOFF_MS,
  StepDeadlineRecord,
} from './battleDeadlineService';
import type { DeploymentState } from './deploymentService';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const store = (redisClient as any).__store as Map<string, string>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const zset = (redisClient as any).__zset as Map<string, number>;

const BATTLE_ID = 'b1';
const IO = {} as never; // 被测路径只透传给 mock 的 startBattle/executeEndStep

const PAST = Date.now() - 60_000;

function seedStepRecord(battleId: string, step: number, actorId: string, deadlineMs: number): void {
  const record: StepDeadlineRecord = {
    battleId,
    step,
    actorId,
    deadline: new Date(deadlineMs).toISOString(),
  };
  store.set(redisKey.stepDeadline(battleId), JSON.stringify(record));
}

function seedDeploymentState(finalized: boolean): DeploymentState {
  const state = {
    battleId: BATTLE_ID,
    deadline: new Date(PAST).toISOString(),
    p1: { playerId: 'pl1', confirmed: false, draft: null },
    p2: { playerId: 'pl2', confirmed: false, draft: null },
    finalized: finalized ? { p1: { pieces: [] }, p2: { pieces: [] } } : null,
  } as unknown as DeploymentState;
  mockReadDeploymentState.mockResolvedValue(state);
  return state;
}

describe('deadlineSweeper (T1014)', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    store.clear();
    zset.clear();
    mockStartBattle.mockResolvedValue({ success: true });
    mockExecuteEndStep.mockResolvedValue({ success: true });
  });

  describe('布置到期 -> startBattle', () => {
    it('pending + 布置状态存在 -> 触发 startBattle 并清索引', async () => {
      zset.set(deadlineMember.deployment(BATTLE_ID), PAST);
      mockQueryOne.mockResolvedValue({ status: 'pending' });
      seedDeploymentState(false);

      await sweepDeadlines(IO);

      expect(mockStartBattle).toHaveBeenCalledWith(IO, BATTLE_ID);
      expect(zset.has(deadlineMember.deployment(BATTLE_ID))).toBe(false);
    });

    it('对局已 ongoing（确认路径已开战）-> 仅清索引，不触发', async () => {
      zset.set(deadlineMember.deployment(BATTLE_ID), PAST);
      mockQueryOne.mockResolvedValue({ status: 'ongoing' });
      seedDeploymentState(false);

      await sweepDeadlines(IO);

      expect(mockStartBattle).not.toHaveBeenCalled();
      expect(zset.has(deadlineMember.deployment(BATTLE_ID))).toBe(false);
    });

    it('布置状态已清理（开战成功竞态漏删）-> 仅清索引', async () => {
      zset.set(deadlineMember.deployment(BATTLE_ID), PAST);
      mockQueryOne.mockResolvedValue({ status: 'pending' });
      mockReadDeploymentState.mockResolvedValue(null);

      await sweepDeadlines(IO);

      expect(mockStartBattle).not.toHaveBeenCalled();
      expect(zset.has(deadlineMember.deployment(BATTLE_ID))).toBe(false);
    });

    it('startBattle 失败 -> 退避 10s 后重试（索引重置）', async () => {
      zset.set(deadlineMember.deployment(BATTLE_ID), PAST);
      mockQueryOne.mockResolvedValue({ status: 'pending' });
      seedDeploymentState(false);
      mockStartBattle.mockResolvedValue({ success: false, failedStep: 2, error: 'boom' });
      const before = Date.now();

      await sweepDeadlines(IO);

      const score = zset.get(deadlineMember.deployment(BATTLE_ID));
      expect(score).toBeDefined();
      expect(score!).toBeGreaterThanOrEqual(before + DEADLINE_RETRY_BACKOFF_MS);
      // 记录仍保留，重试时 startBattle/finalize 幂等
    });

    it('startBattle busy（确认路径并发）-> 静默退避重试', async () => {
      zset.set(deadlineMember.deployment(BATTLE_ID), PAST);
      mockQueryOne.mockResolvedValue({ status: 'pending' });
      seedDeploymentState(false);
      mockStartBattle.mockResolvedValue({ success: false, failedStep: 0, error: 'start_already_in_progress' });
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const before = Date.now();

      await sweepDeadlines(IO);

      expect(errorSpy).not.toHaveBeenCalled();
      const score = zset.get(deadlineMember.deployment(BATTLE_ID));
      expect(score!).toBeGreaterThanOrEqual(before + DEADLINE_RETRY_BACKOFF_MS);
      errorSpy.mockRestore();
    });
  });

  describe('步时到期 -> executeEndStep', () => {
    it('记录与 session 匹配 -> 触发 executeEndStep（不传 userId）', async () => {
      zset.set(deadlineMember.step(BATTLE_ID), PAST);
      seedStepRecord(BATTLE_ID, 3, 'char-x', PAST);
      mockGetSessionState.mockResolvedValue({
        currentStep: 3,
        currentActorId: 'char-x',
        currentPhase: 'move',
      });

      await sweepDeadlines(IO);

      expect(mockExecuteEndStep).toHaveBeenCalledWith(IO, BATTLE_ID);
      // 索引条目已认领移除（executeEndStep 内的激活会重写新条目）
      expect(zset.has(deadlineMember.step(BATTLE_ID))).toBe(false);
    });

    it('session step/actor 失配（手动已推进）-> 仅清旧记录，不触发', async () => {
      zset.set(deadlineMember.step(BATTLE_ID), PAST);
      seedStepRecord(BATTLE_ID, 3, 'char-x', PAST);
      mockGetSessionState.mockResolvedValue({
        currentStep: 4,
        currentActorId: 'char-y',
        currentPhase: 'move',
      });

      await sweepDeadlines(IO);

      expect(mockExecuteEndStep).not.toHaveBeenCalled();
      expect(store.has(redisKey.stepDeadline(BATTLE_ID))).toBe(false);
      expect(zset.has(deadlineMember.step(BATTLE_ID))).toBe(false);
    });

    it('认领期间记录被新一步激活重写（deadline 未来）-> 恢复索引条目', async () => {
      zset.set(deadlineMember.step(BATTLE_ID), PAST);
      const future = Date.now() + 90_000;
      seedStepRecord(BATTLE_ID, 4, 'char-y', future);

      await sweepDeadlines(IO);

      expect(mockExecuteEndStep).not.toHaveBeenCalled();
      expect(zset.get(deadlineMember.step(BATTLE_ID))).toBe(future);
    });

    it('score 已被激活重置为未来 -> 认领自检跳过', async () => {
      zset.set(deadlineMember.step(BATTLE_ID), Date.now() + 90_000);

      await sweepDeadlines(IO);

      expect(mockExecuteEndStep).not.toHaveBeenCalled();
      // 未到期，条目不进入 zRangeByScore 结果，无需处理
    });

    it('session 不存在 -> 清理记录与索引', async () => {
      zset.set(deadlineMember.step(BATTLE_ID), PAST);
      seedStepRecord(BATTLE_ID, 0, 'char-a', PAST);
      mockGetSessionState.mockResolvedValue(null);

      await sweepDeadlines(IO);

      expect(mockExecuteEndStep).not.toHaveBeenCalled();
      expect(store.has(redisKey.stepDeadline(BATTLE_ID))).toBe(false);
      expect(zset.has(deadlineMember.step(BATTLE_ID))).toBe(false);
    });

    it('phase = finished（战斗结束 finishSession 漏清兜底）-> 清理', async () => {
      zset.set(deadlineMember.step(BATTLE_ID), PAST);
      seedStepRecord(BATTLE_ID, 0, 'char-a', PAST);
      mockGetSessionState.mockResolvedValue({ currentStep: 0, currentActorId: 'char-a', currentPhase: 'finished' });

      await sweepDeadlines(IO);

      expect(mockExecuteEndStep).not.toHaveBeenCalled();
      expect(store.has(redisKey.stepDeadline(BATTLE_ID))).toBe(false);
    });

    it('记录已被清理（战斗结束）-> 认领后直接结束', async () => {
      zset.set(deadlineMember.step(BATTLE_ID), PAST);
      // 不 seed step_deadline key

      await sweepDeadlines(IO);

      expect(mockExecuteEndStep).not.toHaveBeenCalled();
      expect(mockGetSessionState).not.toHaveBeenCalled();
    });

    it('executeEndStep 失败 -> 退避重试', async () => {
      zset.set(deadlineMember.step(BATTLE_ID), PAST);
      seedStepRecord(BATTLE_ID, 0, 'char-a', PAST);
      mockGetSessionState.mockResolvedValue({ currentStep: 0, currentActorId: 'char-a', currentPhase: 'move' });
      mockExecuteEndStep.mockResolvedValue({ success: false, error: 'activate_failed' });
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const before = Date.now();

      await sweepDeadlines(IO);

      const score = zset.get(deadlineMember.step(BATTLE_ID));
      expect(score!).toBeGreaterThanOrEqual(before + DEADLINE_RETRY_BACKOFF_MS);
      errorSpy.mockRestore();
    });
  });

  describe('杂项', () => {
    it('未知 member 格式 -> 清理索引', async () => {
      zset.set('garbage-member', PAST);

      await sweepDeadlines(IO);

      expect(zset.has('garbage-member')).toBe(false);
      expect(mockStartBattle).not.toHaveBeenCalled();
      expect(mockExecuteEndStep).not.toHaveBeenCalled();
    });

    it('单条处理抛错不影响其余条目（隔离）', async () => {
      zset.set(deadlineMember.deployment(BATTLE_ID), PAST);
      zset.set(deadlineMember.step('b2'), PAST);
      seedStepRecord('b2', 0, 'char-a', PAST);
      mockQueryOne.mockResolvedValue({ status: 'pending' });
      mockReadDeploymentState.mockRejectedValue(new Error('redis boom'));
      mockGetSessionState.mockResolvedValue({ currentStep: 0, currentActorId: 'char-a', currentPhase: 'move' });
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

      await sweepDeadlines(IO);

      // deploy 条目抛错被隔离；step 条目仍正常触发
      expect(mockExecuteEndStep).toHaveBeenCalledWith(IO, 'b2');
      errorSpy.mockRestore();
    });

    it('上一轮未完成时跳过本轮（防堆积）', async () => {
      zset.set(deadlineMember.step(BATTLE_ID), PAST);
      seedStepRecord(BATTLE_ID, 0, 'char-a', PAST);
      mockGetSessionState.mockResolvedValue({ currentStep: 0, currentActorId: 'char-a', currentPhase: 'move' });

      // 第一轮挂起（executeEndStep 返回受控 pending promise）
      let release!: () => void;
      const gate = new Promise<void>((r) => { release = r; });
      mockExecuteEndStep.mockImplementationOnce(() => gate.then(() => ({ success: true })));

      const first = sweepDeadlines(IO);
      // 刷新 microtask 链，让第一轮真正走到挂起点
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setImmediate(r));
      }
      expect(mockExecuteEndStep).toHaveBeenCalledTimes(1);

      const second = sweepDeadlines(IO); // 应立即返回（不再触发 executeEndStep）
      await second;
      expect(mockExecuteEndStep).toHaveBeenCalledTimes(1);
      release();
      await first;
    });
  });

  describe('生命周期', () => {
    afterEach(() => {
      stopDeadlineSweeper();
    });

    it('start 启动 interval，stop 清除；重复 start 幂等', async () => {
      jest.useFakeTimers();
      try {
        startDeadlineSweeper(IO);
        startDeadlineSweeper(IO); // 幂等

        // 到期条目在 interval 触发时被处理
        zset.set(deadlineMember.step(BATTLE_ID), PAST);
        seedStepRecord(BATTLE_ID, 0, 'char-a', PAST);
        mockGetSessionState.mockResolvedValue({ currentStep: 0, currentActorId: 'char-a', currentPhase: 'move' });

        await jest.advanceTimersByTimeAsync(1000);
        expect(mockExecuteEndStep).toHaveBeenCalledTimes(1);

        stopDeadlineSweeper();
        await jest.advanceTimersByTimeAsync(5000);
        expect(mockExecuteEndStep).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
