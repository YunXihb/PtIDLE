<script setup lang="ts">
import { onMounted, computed, ref } from 'vue';
import { usePlayerStore } from '@/stores/player';
import { resourceName } from '@/utils/resources';
import type { StringMap } from '@/types';

const player = usePlayerStore();

const loading = ref(false);
const error = ref<string | null>(null);

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'error' in e) {
    return String((e as { error?: unknown }).error);
  }
  return '加载失败';
}

const warehouse = computed(() => player.warehouse);

/** 按 value 降序的条目（数量多的在前） */
function sortedEntries(map: StringMap | undefined): [string, number][] {
  return Object.entries(map ?? {}).sort((a, b) => b[1] - a[1]);
}

const resourceEntries = computed(() => sortedEntries(warehouse.value?.resources));
const materialEntries = computed(() => sortedEntries(warehouse.value?.materials));

const resourceTotal = computed(() => resourceEntries.value.reduce((s, [, v]) => s + v, 0));
const materialTotal = computed(() => materialEntries.value.reduce((s, [, v]) => s + v, 0));

const resourceLimit = computed(() => warehouse.value?.storageLimits?.resource ?? 0);
const materialLimit = computed(() => warehouse.value?.storageLimits?.material ?? 0);

function pct(used: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

/** 用量条颜色：>=100% 危险 / >=80% 警告 / 其余正常 */
function barClass(used: number, limit: number): string {
  if (limit <= 0) return 'bar';
  const ratio = used / limit;
  if (ratio >= 1) return 'bar danger';
  if (ratio >= 0.8) return 'bar warn';
  return 'bar';
}

async function load() {
  loading.value = true;
  error.value = null;
  try {
    await player.fetchWarehouse();
  } catch (e) {
    error.value = errMsg(e);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="warehouse">
    <div class="head">
      <h2>仓库</h2>
      <button class="secondary" :disabled="loading" @click="load">{{ loading ? '刷新中...' : '刷新' }}</button>
    </div>

    <div v-if="loading && !warehouse" class="dim">加载中...</div>

    <template v-else>
      <div v-if="error" class="error-banner">{{ error }}</div>

      <div v-if="!warehouse" class="dim">暂无数据</div>

      <template v-else>
        <!-- 资源 -->
        <section class="panel cat-section">
          <div class="cat-head">
            <h3>资源</h3>
            <span class="dim usage">
              {{ resourceTotal }}<span v-if="resourceLimit > 0"> / {{ resourceLimit }}</span>
              <span v-if="resourceLimit > 0" class="pct">（{{ pct(resourceTotal, resourceLimit) }}%）</span>
            </span>
          </div>
          <div v-if="resourceLimit > 0" class="progress">
            <div :class="barClass(resourceTotal, resourceLimit)" :style="{ width: pct(resourceTotal, resourceLimit) + '%' }"></div>
          </div>
          <div v-if="resourceEntries.length === 0" class="dim empty">（无）</div>
          <div v-else class="item-grid">
            <div v-for="[key, count] in resourceEntries" :key="key" class="item" :class="{ zero: count === 0 }">
              <span class="item-name">{{ resourceName(key) }}</span>
              <span class="item-count">{{ count }}</span>
            </div>
          </div>
        </section>

        <!-- 材料 -->
        <section class="panel cat-section">
          <div class="cat-head">
            <h3>材料</h3>
            <span class="dim usage">
              {{ materialTotal }}<span v-if="materialLimit > 0"> / {{ materialLimit }}</span>
              <span v-if="materialLimit > 0" class="pct">（{{ pct(materialTotal, materialLimit) }}%）</span>
            </span>
          </div>
          <div v-if="materialLimit > 0" class="progress">
            <div :class="barClass(materialTotal, materialLimit)" :style="{ width: pct(materialTotal, materialLimit) + '%' }"></div>
          </div>
          <div v-if="materialEntries.length === 0" class="dim empty">（无）</div>
          <div v-else class="item-grid">
            <div v-for="[key, count] in materialEntries" :key="key" class="item" :class="{ zero: count === 0 }">
              <span class="item-name">{{ resourceName(key) }}</span>
              <span class="item-count">{{ count }}</span>
            </div>
          </div>
        </section>
      </template>
    </template>
  </div>
</template>

<style scoped>
.warehouse { display: flex; flex-direction: column; gap: 16px; }

.head { display: flex; justify-content: space-between; align-items: center; }
.head h2 { margin: 0; }

.error-banner {
  background: rgba(229, 83, 75, 0.15); border: 1px solid var(--danger);
  color: var(--danger); padding: 10px 14px; border-radius: 6px; font-size: 14px;
}

.cat-section { display: flex; flex-direction: column; gap: 12px; }
.cat-head { display: flex; justify-content: space-between; align-items: baseline; }
.cat-head h3 { margin: 0; font-size: 15px; }
.usage { font-size: 13px; }
.usage .pct { margin-left: 4px; }

.progress {
  height: 8px; background: var(--bg-panel-2); border-radius: 4px; overflow: hidden;
  border: 1px solid var(--border);
}
.bar { height: 100%; transition: width 0.3s ease; background: var(--accent); }
.bar.warn { background: var(--warning); }
.bar.danger { background: var(--danger); }

.empty { padding: 4px 0; }

.item-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 8px;
}
.item {
  display: flex; justify-content: space-between; align-items: center;
  background: var(--bg-panel-2); border: 1px solid var(--border);
  border-radius: 6px; padding: 8px 12px;
}
.item.zero { opacity: 0.45; }
.item-name { font-size: 13px; }
.item-count { font-size: 14px; font-weight: 600; }
</style>
