import { defineStore } from 'pinia';
import { ref } from 'vue';
import { craftingApi } from '@/services/api';
import { usePlayerStore } from './player';
import type {
  CraftingRecipe,
  CardCraftResult,
  GearCraftResult,
  ConsumableCraftResult,
} from '@/types';

/**
 * 从拦截器 reject 出来的错误对象中取 message。
 * http.ts 对 4xx/5xx reject 的是 response.data（即 { success:false, error }）。
 */
function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'error' in e) {
    return String((e as { error?: unknown }).error);
  }
  return '操作失败';
}

export type CraftResult = CardCraftResult | GearCraftResult | ConsumableCraftResult;

export const useCraftingStore = defineStore('crafting', () => {
  const recipes = ref<CraftingRecipe[]>([]);

  const loading = ref(false);       // 初次加载
  const actionLoading = ref(false); // craft
  const error = ref<string | null>(null);

  async function loadAll() {
    loading.value = true;
    error.value = null;
    try {
      const res = await craftingApi.recipes();
      recipes.value = res.data;
    } catch (e) {
      error.value = errMsg(e);
    } finally {
      loading.value = false;
    }
  }

  /**
   * 执行制造。按 recipe.category 分发到 card/gear/consumable 端点。
   * 后端用 result.success 模式（非 throw ApiError），缺料/职业不符/超上限等错误
   * 经 fail() 回 400/403，error 为字符串文案（**无 missing 数组**，与 processing 不同）。
   * 响应只含 materialsUsed，**不含 materials 快照** -> 成功/失败都刷玩家 profile 保真。
   * @returns 制造结果；失败返回 null 并把错误文案写入 error。
   */
  async function craft(recipe: CraftingRecipe, quantity = 1): Promise<CraftResult | null> {
    actionLoading.value = true;
    error.value = null;
    try {
      let res: { data: CraftResult };
      if (recipe.category === 'card') {
        res = await craftingApi.craftCard(recipe.id, quantity);
      } else if (recipe.category === 'gear') {
        res = await craftingApi.craftGear(recipe.id, quantity);
      } else {
        res = await craftingApi.craftConsumable(recipe.id, quantity);
      }
      await usePlayerStore().fetchProfile();
      return res.data;
    } catch (e) {
      error.value = errMsg(e);
      // 材料可能在渲染后变化，同步真实状态（如卡牌超上限等场景）
      await usePlayerStore().fetchProfile().catch(() => undefined);
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
  }

  return {
    recipes, loading, actionLoading, error,
    loadAll, craft, reset,
  };
});
