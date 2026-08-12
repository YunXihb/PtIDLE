import { defineStore } from 'pinia';
import { ref } from 'vue';
import { processingApi } from '@/services/api';
import { usePlayerStore } from './player';
import type { ProcessingRecipe, ProcessResult } from '@/types';

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

export const useProcessingStore = defineStore('processing', () => {
  const recipes = ref<ProcessingRecipe[]>([]);

  const loading = ref(false);       // 初次加载
  const actionLoading = ref(false); // process
  const error = ref<string | null>(null);

  /** 最近一次缺料（400）返回的缺失资源键；供面板定位提示 */
  const lastMissing = ref<string[]>([]);

  async function fetchRecipes() {
    const res = await processingApi.recipes();
    recipes.value = res.data;
  }

  async function loadAll() {
    loading.value = true;
    error.value = null;
    try {
      await fetchRecipes();
    } catch (e) {
      error.value = errMsg(e);
    } finally {
      loading.value = false;
    }
  }

  /**
   * 执行加工。即时扣除资源、产出材料。
   * 成功后刷新玩家 profile（resources + materials 同步）。
   * @returns ProcessResult；缺料（400）返回 null 并把缺失资源写入 lastMissing。
   */
  async function process(recipeType: string, quantity = 1): Promise<ProcessResult | null> {
    actionLoading.value = true;
    error.value = null;
    lastMissing.value = [];
    try {
      const res = await processingApi.process(recipeType, quantity);
      await usePlayerStore().fetchProfile();
      return res.data;
    } catch (e) {
      // 400 Insufficient materials：error 对象带 missing 数组（后端 ApiError.extra 经 errorHandler 展开到顶层）
      if (
        e &&
        typeof e === 'object' &&
        'missing' in e &&
        Array.isArray((e as { missing?: unknown }).missing)
      ) {
        lastMissing.value = (e as { missing: string[] }).missing;
        // 资源可能在渲染后发生变化，同步真实状态
        await usePlayerStore().fetchProfile().catch(() => undefined);
      } else {
        error.value = errMsg(e);
      }
      return null;
    } finally {
      actionLoading.value = false;
    }
  }

  function reset() {
    recipes.value = [];
    loading.value = false;
    actionLoading.value = false;
    error.value = null;
    lastMissing.value = [];
  }

  return {
    recipes, loading, actionLoading, error, lastMissing,
    fetchRecipes, loadAll, process, reset,
  };
});
