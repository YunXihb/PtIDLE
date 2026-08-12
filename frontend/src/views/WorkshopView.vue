<script setup lang="ts">
import { ref } from 'vue';
import GatheringPanel from '@/components/GatheringPanel.vue';
import ProcessingPanel from '@/components/ProcessingPanel.vue';
import CraftingPanel from '@/components/CraftingPanel.vue';

// 工坊三子页：采集（T064）/ 加工（T065）/ 制造（T066）
const tabs = [
  { key: 'gathering', label: '采集' },
  { key: 'processing', label: '加工' },
  { key: 'crafting', label: '制造' },
] as const;

const active = ref<(typeof tabs)[number]['key']>('gathering');
</script>

<template>
  <div class="workshop">
    <h2>工坊</h2>
    <div class="tabs">
      <button
        v-for="t in tabs"
        :key="t.key"
        :class="['tab', { active: active === t.key }]"
        @click="active = t.key"
      >
        {{ t.label }}
      </button>
    </div>

    <div class="tab-content">
      <GatheringPanel v-if="active === 'gathering'" />
      <ProcessingPanel v-else-if="active === 'processing'" />
      <CraftingPanel v-else-if="active === 'crafting'" />
    </div>
  </div>
</template>

<style scoped>
.workshop { display: flex; flex-direction: column; gap: 16px; }
.tabs { display: flex; gap: 6px; }
.tab {
  padding: 8px 18px; border-radius: 6px; background: var(--bg-panel-2);
  border: 1px solid var(--border); color: var(--text-dim); font-size: 14px;
}
.tab:hover { color: var(--text); }
.tab.active { color: #fff; background: var(--accent); border-color: var(--accent); }
</style>
