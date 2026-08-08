import { defineStore } from 'pinia';
import { ref } from 'vue';
import { gatheringApi, skillApi } from '@/services/api';
import { usePlayerStore } from './player';
import type { GatheringSkill, GatheringTask, GatheringEfficiency, SkillType } from '@/types';

/**
 * 从拦截器 reject 出来的错误对象中取 message。
 * http.ts 对 4xx/5xx reject 的是 response.data（即 { success:false, error, ... }）。
 */
function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'error' in e) {
    return String((e as { error?: unknown }).error);
  }
  return '操作失败';
}
function isMsg(e: unknown, frag: string): boolean {
  return errMsg(e).toLowerCase().includes(frag.toLowerCase());
}

export const useGatheringStore = defineStore('gathering', () => {
  const skills = ref<GatheringSkill[]>([]);
  const efficiency = ref<GatheringEfficiency[]>([]);
  const totalBonus = ref(0);
  const activeTask = ref<GatheringTask | null>(null);

  const loading = ref(false);       // 初次加载
  const actionLoading = ref(false); // start/complete/cancel
  const error = ref<string | null>(null);

  async function fetchSkills() {
    const res = await skillApi.gathering();
    skills.value = res.data;
  }

  async function fetchEfficiency() {
    const res = await gatheringApi.efficiency();
    efficiency.value = res.data.efficiency;
    totalBonus.value = res.data.totalBonus;
  }

  /** 拉取当前活跃任务；无任务时 activeTask 置 null */
  async function fetchStatus() {
    const res = await gatheringApi.status();
    activeTask.value = res.data;
  }

  async function loadAll() {
    loading.value = true;
    error.value = null;
    try {
      await Promise.all([fetchSkills(), fetchEfficiency(), fetchStatus()]);
    } catch (e) {
      error.value = errMsg(e);
    } finally {
      loading.value = false;
    }
  }

  /** 开始采集；若已有活跃任务（400）则静默刷新状态 */
  async function start(skillType: SkillType) {
    actionLoading.value = true;
    error.value = null;
    try {
      const res = await gatheringApi.start(skillType);
      activeTask.value = res.data;
    } catch (e) {
      if (isMsg(e, 'Already has active')) {
        await fetchStatus();
      } else {
        error.value = errMsg(e);
      }
    } finally {
      actionLoading.value = false;
    }
  }

  /**
   * 领取收获（手动完成）。
   * @returns 完成的任务（含 result.resources/overflowed）；若已被定时器自动完成或尚未到期则返回 null。
   * 两种情况都刷新玩家资源。
   */
  async function complete(): Promise<GatheringTask | null> {
    actionLoading.value = true;
    error.value = null;
    try {
      const res = await gatheringApi.complete();
      activeTask.value = null;
      await usePlayerStore().fetchProfile();
      return res.data;
    } catch (e) {
      // 400: 未到期 或 已被定时器自动完成 -> 同步状态 + 资源
      if (isMsg(e, 'not yet completed') || isMsg(e, 'No active')) {
        await fetchStatus();
        await usePlayerStore().fetchProfile();
        return null;
      }
      error.value = errMsg(e);
      return null;
    } finally {
      actionLoading.value = false;
    }
  }

  /** 取消采集；若无活跃任务（400）则清空本地状态 */
  async function cancel() {
    actionLoading.value = true;
    error.value = null;
    try {
      await gatheringApi.cancel();
      activeTask.value = null;
    } catch (e) {
      if (isMsg(e, 'No active')) {
        activeTask.value = null;
      } else {
        error.value = errMsg(e);
      }
    } finally {
      actionLoading.value = false;
    }
  }

  function reset() {
    skills.value = [];
    efficiency.value = [];
    totalBonus.value = 0;
    activeTask.value = null;
    loading.value = false;
    actionLoading.value = false;
    error.value = null;
  }

  return {
    skills, efficiency, totalBonus, activeTask,
    loading, actionLoading, error,
    fetchSkills, fetchEfficiency, fetchStatus, loadAll,
    start, complete, cancel, reset,
  };
});
