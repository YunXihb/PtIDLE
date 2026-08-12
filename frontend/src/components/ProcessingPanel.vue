<script setup lang="ts">
import { onMounted, computed, ref } from 'vue';
import { useProcessingStore } from '@/stores/processing';
import { usePlayerStore } from '@/stores/player';
import { resourceName } from '@/utils/resources';
import type { ProcessingRecipe } from '@/types';

const store = useProcessingStore();
const player = usePlayerStore();

// 每个配方独立的加工数量选择
const QUANTITIES = [1, 5, 10] as const;
const selectedQty = ref<Record<string, number>>({});
function qtyOf(recipe: ProcessingRecipe): number {
  return selectedQty.value[recipe.type] ?? 1;
}
function setQty(recipe: ProcessingRecipe, q: number) {
  selectedQty.value[recipe.type] = q;
}

// 临时通知（加工完成 / 缺料）
const notice = ref<string | null>(null);
let noticeTimer: number | null = null;
function showNotice(msg: string) {
  notice.value = msg;
  if (noticeTimer !== null) clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => { notice.value = null; }, 4000);
}

// 玩家当前资源 / 材料快照（profile 未加载时兜底空对象）
const resources = computed<Record<string, number>>(() => player.profile?.resources ?? {});
const materials = computed<Record<string, number>>(() => player.profile?.materials ?? {});

/** 配方在指定数量下是否负担得起（input 存于 players.resources） */
function canAfford(recipe: ProcessingRecipe, qty: number): boolean {
  return Object.entries(recipe.input).every(
    ([res, need]) => (resources.value[res] ?? 0) >= need * qty,
  );
}

/** 缺失资源列表（键 + 持有/需求数），供卡片内联提示 */
function missingFor(recipe: ProcessingRecipe, qty: number) {
  return Object.entries(recipe.input)
    .filter(([res, need]) => (resources.value[res] ?? 0) < need * qty)
    .map(([res, need]) => ({ key: res, have: resources.value[res] ?? 0, need: need * qty }));
}

/** 格式化资源映射为「铁矿石 ×2，煤炭 ×1」 */
function formatMap(map: Record<string, number>): string {
  return Object.entries(map)
    .map(([k, v]) => `${resourceName(k)} ×${v}`)
    .join('，');
}

/** 按数量缩放后的输入（资源） */
function scaledInput(recipe: ProcessingRecipe, qty: number): Record<string, number> {
  return Object.fromEntries(
    Object.entries(recipe.input).map(([k, v]) => [k, v * qty]),
  );
}

/** 按数量 + 效率缩放后的输出（材料，向下取整对齐后端） */
function scaledOutput(recipe: ProcessingRecipe, qty: number): Record<string, number> {
  return Object.fromEntries(
    Object.entries(recipe.output).map(([k, v]) => [k, Math.floor(v * qty * recipe.efficiency)]),
  );
}

async function onProcess(recipe: ProcessingRecipe) {
  const qty = qtyOf(recipe);
  const result = await store.process(recipe.type, qty);
  if (result) {
    const gained = formatMap(result.output);
    showNotice(`加工完成：获得 ${gained}`);
  } else if (store.lastMissing.length > 0) {
    // 服务端 400 缺料（通常被客户端预算校验拦截，此为竞态兜底）
    showNotice(`材料不足，缺少：${store.lastMissing.map(resourceName).join('、')}`);
  }
  // 其余错误由 store.error -> error-banner 展示
}

onMounted(async () => {
  await store.loadAll();
});
</script>

<template>
  <div class="processing">
    <div v-if="store.loading" class="dim">加载中...</div>

    <template v-else>
      <div v-if="store.error" class="error-banner">{{ store.error }}</div>
      <div v-if="notice" class="notice">{{ notice }}</div>

      <div v-if="store.recipes.length === 0" class="dim">暂无加工配方</div>

      <div v-else class="grid">
        <div v-for="recipe in store.recipes" :key="recipe.id" class="panel recipe-card">
          <h3>{{ recipe.name }}</h3>

          <!-- 配方：input -> output（单位量） -->
          <div class="recipe-flow">
            <div class="io">
              <span class="io-label dim">消耗</span>
              <div v-for="(amt, key) in recipe.input" :key="`i-${key}`" class="io-row">
                <span>{{ resourceName(String(key)) }}</span>
                <span class="dim">×{{ amt }}</span>
              </div>
            </div>
            <span class="arrow dim">→</span>
            <div class="io">
              <span class="io-label dim">产出</span>
              <div v-for="(amt, key) in recipe.output" :key="`o-${key}`" class="io-row">
                <span>{{ resourceName(String(key)) }}</span>
                <span class="dim">×{{ amt }}</span>
              </div>
            </div>
          </div>

          <!-- 当前持有：输入资源 / 产出材料库存 -->
          <p class="stock dim">
            持有：
            <span v-for="key in Object.keys(recipe.input)" :key="`si-${key}`">
              {{ resourceName(key) }} {{ resources[key] ?? 0 }}
            </span>
            <span v-for="key in Object.keys(recipe.output)" :key="`so-${key}`">
              · {{ resourceName(key) }} {{ materials[key] ?? 0 }}
            </span>
          </p>

          <!-- 数量选择 -->
          <div class="qty-row">
            <span class="dim">数量</span>
            <div class="qty-group">
              <button
                v-for="q in QUANTITIES"
                :key="q"
                :class="['qty', { active: qtyOf(recipe) === q }]"
                @click="setQty(recipe, q)"
              >×{{ q }}</button>
            </div>
          </div>

          <!-- 合计预览 -->
          <p class="preview dim">
            合计消耗 {{ formatMap(scaledInput(recipe, qtyOf(recipe))) }}，
            产出 {{ formatMap(scaledOutput(recipe, qtyOf(recipe))) }}
          </p>

          <!-- 缺料提示（客户端预算校验） -->
          <p v-if="!canAfford(recipe, qtyOf(recipe))" class="warn">
            材料不足：
            <span v-for="m in missingFor(recipe, qtyOf(recipe))" :key="m.key" class="miss">
              {{ resourceName(m.key) }}（{{ m.have }}/{{ m.need }}）
            </span>
          </p>

          <button
            :disabled="store.actionLoading || !canAfford(recipe, qtyOf(recipe))"
            @click="onProcess(recipe)"
          >加工</button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.processing { display: flex; flex-direction: column; gap: 16px; }

.error-banner {
  background: rgba(229, 83, 75, 0.15); border: 1px solid var(--danger);
  color: var(--danger); padding: 10px 14px; border-radius: 6px; font-size: 14px;
}
.notice {
  background: rgba(62, 207, 107, 0.15); border: 1px solid var(--success);
  color: var(--success); padding: 10px 14px; border-radius: 6px; font-size: 14px;
}

.grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
}
.recipe-card { display: flex; flex-direction: column; gap: 10px; }
.recipe-card h3 { margin: 0; }

.recipe-flow { display: flex; align-items: center; gap: 12px; }
.io { display: flex; flex-direction: column; gap: 4px; flex: 1; }
.io-label { font-size: 12px; }
.io-row { display: flex; justify-content: space-between; }
.arrow { font-size: 18px; }

.stock { font-size: 12px; line-height: 1.6; }
.stock span { margin-right: 4px; }

.qty-row { display: flex; align-items: center; gap: 10px; }
.qty-group { display: flex; gap: 6px; }
.qty {
  background: var(--bg-panel-2); color: var(--text-dim);
  border: 1px solid var(--border); padding: 4px 12px; font-size: 13px;
}
.qty:hover { color: var(--text); }
.qty.active { color: #fff; background: var(--accent); border-color: var(--accent); }

.preview { font-size: 12px; line-height: 1.6; }

.warn { color: var(--warning); font-size: 13px; line-height: 1.6; }
.warn .miss { margin-right: 6px; }
</style>
