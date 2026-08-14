<script setup lang="ts">
import { onMounted, computed, ref } from 'vue';
import { usePlayerStore } from '@/stores/player';
import { CARD_TYPE_META, effectSummary } from '@/utils/cards';
import type { CardType, PlayerCard } from '@/types';

const player = usePlayerStore();

const loading = ref(false);
const error = ref<string | null>(null);
const page = ref(1);
const pageSize = 50;
const selectedType = ref<CardType | 'all'>('all');

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'error' in e) {
    return String((e as { error?: unknown }).error);
  }
  return '加载失败';
}

const cards = computed<PlayerCard[]>(() => player.myCards);
const pagination = computed(() => player.cardPagination);

/** 按选中类型筛选（作用于当前已加载页） */
const filteredCards = computed(() => {
  if (selectedType.value === 'all') return cards.value;
  return cards.value.filter((c) => c.type === selectedType.value);
});

/** 各类型计数（当前页） */
const typeCounts = computed(() => {
  const counts: Record<CardType, number> = { attack: 0, defense: 0, tactical: 0 };
  for (const c of cards.value) {
    counts[c.type] += 1;
  }
  return counts;
});

const total = computed(() => pagination.value?.total ?? cards.value.length);
const totalPages = computed(() => pagination.value?.totalPages ?? 1);
const hasPrev = computed(() => page.value > 1);
const hasNext = computed(() => page.value < totalPages.value);

const filterTabs: { key: CardType | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'attack', label: CARD_TYPE_META.attack.label },
  { key: 'defense', label: CARD_TYPE_META.defense.label },
  { key: 'tactical', label: CARD_TYPE_META.tactical.label },
];

function tabCount(key: CardType | 'all'): number {
  if (key === 'all') return cards.value.length;
  return typeCounts.value[key];
}

async function load() {
  loading.value = true;
  error.value = null;
  try {
    await player.fetchMyCards(page.value, pageSize);
  } catch (e) {
    error.value = errMsg(e);
  } finally {
    loading.value = false;
  }
}

async function goToPage(p: number) {
  if (p < 1 || p > totalPages.value || p === page.value) return;
  page.value = p;
  await load();
}

/** 获得时间简短展示 */
function formatDate(s: string | undefined): string {
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

onMounted(load);
</script>

<template>
  <div class="cards">
    <div class="head">
      <h2>卡牌库</h2>
      <button class="secondary" :disabled="loading" @click="load">
        {{ loading ? '刷新中...' : '刷新' }}
      </button>
    </div>

    <div v-if="loading && cards.length === 0" class="dim">加载中...</div>

    <template v-else>
      <div v-if="error" class="error-banner">{{ error }}</div>

      <div v-if="cards.length === 0" class="dim empty">
        暂无卡牌。可通过工坊「制造」获取卡牌。
      </div>

      <template v-else>
        <!-- 类型筛选 -->
        <div class="filter-tabs">
          <button
            v-for="tab in filterTabs"
            :key="tab.key"
            class="tab"
            :class="{ active: selectedType === tab.key }"
            @click="selectedType = tab.key"
          >
            {{ tab.label }}
            <span class="tab-count">{{ tabCount(tab.key) }}</span>
          </button>
        </div>

        <div v-if="filteredCards.length === 0" class="dim empty">
          该类型暂无卡牌。
        </div>

        <!-- 卡牌 grid -->
        <div v-else class="card-grid">
          <div
            v-for="card in filteredCards"
            :key="card.id"
            class="card"
            :style="{ '--card-color': CARD_TYPE_META[card.type].color }"
          >
            <div class="card-top">
              <span class="card-type" :style="{ background: CARD_TYPE_META[card.type].color }">
                {{ CARD_TYPE_META[card.type].label }}
              </span>
              <span class="card-cost">⚡{{ card.cost }}</span>
            </div>
            <div class="card-name">{{ card.name }}</div>
            <div class="card-effect">{{ effectSummary(card.effect) }}</div>
            <div class="card-foot">
              <span v-if="card.quantity > 1" class="qty">×{{ card.quantity }}</span>
              <span v-else class="qty-placeholder"></span>
              <span class="dim date">{{ formatDate(card.created_at) }}</span>
            </div>
          </div>
        </div>

        <!-- 分页 -->
        <div v-if="totalPages > 1" class="pager">
          <button class="secondary" :disabled="!hasPrev || loading" @click="goToPage(page - 1)">
            上一页
          </button>
          <span class="dim">
            第 {{ page }} / {{ totalPages }} 页 · 共 {{ total }} 张
          </span>
          <button class="secondary" :disabled="!hasNext || loading" @click="goToPage(page + 1)">
            下一页
          </button>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.cards { display: flex; flex-direction: column; gap: 16px; }

.head { display: flex; justify-content: space-between; align-items: center; }
.head h2 { margin: 0; }

.error-banner {
  background: rgba(229, 83, 75, 0.15); border: 1px solid var(--danger);
  color: var(--danger); padding: 10px 14px; border-radius: 6px; font-size: 14px;
}

.empty { padding: 8px 0; }

.filter-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
.tab {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 12px; border-radius: 6px;
  background: var(--bg-panel-2); border: 1px solid var(--border);
  color: var(--text-dim); font-size: 13px; cursor: pointer;
}
.tab:hover { color: var(--text); }
.tab.active { color: #fff; background: var(--accent); border-color: var(--accent); }
.tab-count {
  font-size: 11px; opacity: 0.8;
  background: rgba(0, 0, 0, 0.2); padding: 0 6px; border-radius: 8px;
}

.card-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
}
.card {
  display: flex; flex-direction: column; gap: 6px;
  background: var(--bg-panel-2); border: 1px solid var(--border);
  border-left: 3px solid var(--card-color);
  border-radius: 6px; padding: 10px 12px;
}
.card-top { display: flex; justify-content: space-between; align-items: center; }
.card-type {
  font-size: 11px; color: #fff; padding: 1px 8px; border-radius: 8px;
}
.card-cost { font-size: 13px; font-weight: 600; color: var(--warning); }
.card-name { font-size: 15px; font-weight: 600; }
.card-effect { font-size: 12px; color: var(--text-dim); }
.card-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 2px; }
.qty {
  font-size: 12px; font-weight: 700; color: var(--accent);
  background: rgba(0, 0, 0, 0.2); padding: 0 8px; border-radius: 8px;
}
.qty-placeholder { width: 1px; }
.date { font-size: 11px; }

.pager {
  display: flex; align-items: center; justify-content: center; gap: 16px;
  margin-top: 4px;
}
</style>
