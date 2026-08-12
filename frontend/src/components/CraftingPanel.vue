<script setup lang="ts">
import { onMounted, computed, ref } from 'vue';
import { useCraftingStore, type CraftResult } from '@/stores/crafting';
import { usePlayerStore } from '@/stores/player';
import { resourceName } from '@/utils/resources';
import type { CraftingRecipe, StringMap, CraftCategory, CardCraftResult, GearCraftResult, ConsumableCraftResult } from '@/types';

const store = useCraftingStore();
const player = usePlayerStore();

// 分类展示顺序
const CATEGORIES: { key: CraftCategory; label: string }[] = [
  { key: 'card', label: '卡牌' },
  { key: 'gear', label: '装备' },
  { key: 'consumable', label: '消耗品' },
];

// 职业中文名
const PROFESSION_NAMES: Record<string, string> = {
  warrior: '战士',
  ranger: '弓手',
  mage: '法师',
};

// 每个配方独立的制造数量选择（装备强制 1：多次制造只叠 bonus 且浪费材料）
const QUANTITIES = [1, 5, 10] as const;
const selectedQty = ref<Record<string, number>>({});
function qtyOf(recipe: CraftingRecipe): number {
  if (recipe.category === 'gear') return 1;
  return selectedQty.value[recipe.id] ?? 1;
}
function setQty(recipe: CraftingRecipe, q: number) {
  selectedQty.value[recipe.id] = q;
}

// 临时通知（制造完成 / 错误）
const notice = ref<string | null>(null);
let noticeTimer: number | null = null;
function showNotice(msg: string) {
  notice.value = msg;
  if (noticeTimer !== null) clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => { notice.value = null; }, 4000);
}

// 玩家当前材料快照（制造 input 存于 players.materials）
const materials = computed<Record<string, number>>(() => player.profile?.materials ?? {});

// 玩家拥有的活角色职业集合（卡牌职业门槛检查）
const playerProfessions = computed(
  () => new Set((player.profile?.characters ?? []).map((c) => c.profession)),
);
function hasProfession(req: string | null): boolean {
  if (!req) return true;
  return playerProfessions.value.has(req);
}

/** 把配方 input 归一为替代料组合数组（单个对象也包成单元素数组） */
function inputSets(recipe: CraftingRecipe): StringMap[] {
  return Array.isArray(recipe.input) ? recipe.input : [recipe.input];
}

/** 配方在指定数量下是否负担得起（任一替代组合满足即可） */
function canAfford(recipe: CraftingRecipe, qty: number): boolean {
  return inputSets(recipe).some((set) =>
    Object.entries(set).every(([m, need]) => (materials.value[m] ?? 0) >= need * qty),
  );
}

/** 第一个负担得起的替代组合索引；都负担不起返回 0（展示首选组合的缺料） */
function affordableIdx(recipe: CraftingRecipe, qty: number): number {
  const idx = inputSets(recipe).findIndex((set) =>
    Object.entries(set).every(([m, need]) => (materials.value[m] ?? 0) >= need * qty),
  );
  return idx >= 0 ? idx : 0;
}

/** 首选组合的缺失材料（键 + 持有/需求数） */
function missingFor(recipe: CraftingRecipe, qty: number) {
  const set = inputSets(recipe)[affordableIdx(recipe, qty)];
  return Object.entries(set)
    .filter(([m, need]) => (materials.value[m] ?? 0) < need * qty)
    .map(([m, need]) => ({ key: m, have: materials.value[m] ?? 0, need: need * qty }));
}

/** 该配方涉及的所有材料键（用于展示当前持有） */
function stockKeys(recipe: CraftingRecipe): string[] {
  const keys = new Set<string>();
  for (const set of inputSets(recipe)) Object.keys(set).forEach((k) => keys.add(k));
  return [...keys];
}

/** 格式化单个替代组合为「铁锭 ×2，煤炭 ×1」 */
function formatSet(set: StringMap, qty: number): string {
  return Object.entries(set)
    .map(([k, v]) => `${resourceName(k)} ×${v * qty}`)
    .join('，');
}

/** 格式化产出（按分类） */
function formatOutput(recipe: CraftingRecipe): string {
  const o = recipe.output as { name: string; quantity?: number; bonus?: number };
  if (recipe.category === 'gear') {
    return `${o.name}（+${Math.round((o.bonus ?? 0) * 100)}%）`;
  }
  return `${o.name} ×${o.quantity ?? 1}`;
}

/** 格式化制造结果为通知文案 */
function formatResult(category: CraftCategory, r: CraftResult): string {
  if (category === 'card') {
    const c = r as CardCraftResult;
    return `获得 ${c.cardName} ×${c.quantity}`;
  }
  if (category === 'gear') {
    const g = r as GearCraftResult;
    return `制造 ${g.gearName}（+${Math.round(g.bonus * 100)}% 采集加成）`;
  }
  const c = r as ConsumableCraftResult;
  return `获得 ${c.consumableName} ×${c.quantity}`;
}

function recipesOf(cat: CraftCategory): CraftingRecipe[] {
  return store.recipes.filter((r) => r.category === cat);
}

function craftDisabled(recipe: CraftingRecipe): boolean {
  return (
    store.actionLoading ||
    !canAfford(recipe, qtyOf(recipe)) ||
    !hasProfession(recipe.profession_required)
  );
}

async function onCraft(recipe: CraftingRecipe) {
  const qty = qtyOf(recipe);
  const result = await store.craft(recipe, qty);
  if (result) {
    showNotice(formatResult(recipe.category, result));
  } else if (store.error) {
    showNotice(store.error);
  }
}

onMounted(async () => {
  await store.loadAll();
});
</script>

<template>
  <div class="crafting">
    <div v-if="store.loading" class="dim">加载中...</div>

    <template v-else>
      <div v-if="store.error" class="error-banner">{{ store.error }}</div>
      <div v-if="notice" class="notice">{{ notice }}</div>

      <div v-if="store.recipes.length === 0" class="dim">暂无制造配方</div>

      <section v-for="cat in CATEGORIES" v-else :key="cat.key" class="cat-section">
        <h3 class="cat-title">{{ cat.label }}</h3>
        <div v-if="recipesOf(cat.key).length === 0" class="dim empty">（无）</div>
        <div v-else class="grid">
          <div v-for="recipe in recipesOf(cat.key)" :key="recipe.id" class="panel recipe-card">
            <div class="card-head">
              <h4>{{ recipe.name }}</h4>
              <span
                v-if="recipe.profession_required"
                :class="['prof-badge', { locked: !hasProfession(recipe.profession_required) }]"
              >需 {{ PROFESSION_NAMES[recipe.profession_required] ?? recipe.profession_required }}</span>
            </div>

            <!-- 消耗：替代料用「或」连接 -->
            <div class="io">
              <span class="io-label dim">消耗</span>
              <span v-for="(set, i) in inputSets(recipe)" :key="i" class="alt-set">
                <span v-if="i > 0" class="dim or"> 或 </span>
                <span :class="{ affordable: canAfford(recipe, qtyOf(recipe)) && i === affordableIdx(recipe, qtyOf(recipe)) }">
                  {{ formatSet(set, qtyOf(recipe)) }}
                </span>
              </span>
            </div>

            <!-- 产出 -->
            <div class="io">
              <span class="io-label dim">产出</span>
              <span>{{ formatOutput(recipe) }}</span>
            </div>

            <!-- 当前持有 -->
            <p class="stock dim">
              持有：
              <span v-for="key in stockKeys(recipe)" :key="key">
                {{ resourceName(key) }} {{ materials[key] ?? 0 }}
              </span>
            </p>

            <!-- 数量选择（装备无） -->
            <div v-if="recipe.category !== 'gear'" class="qty-row">
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

            <!-- 缺料提示（客户端预算校验） -->
            <p v-if="!canAfford(recipe, qtyOf(recipe))" class="warn">
              材料不足：
              <span v-for="m in missingFor(recipe, qtyOf(recipe))" :key="m.key" class="miss">
                {{ resourceName(m.key) }}（{{ m.have }}/{{ m.need }}）
              </span>
            </p>

            <!-- 职业不符提示 -->
            <p v-else-if="!hasProfession(recipe.profession_required)" class="warn">
              需要职业：{{ PROFESSION_NAMES[recipe.profession_required!] ?? recipe.profession_required }}
            </p>

            <button :disabled="craftDisabled(recipe)" @click="onCraft(recipe)">制造</button>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.crafting { display: flex; flex-direction: column; gap: 20px; }

.error-banner {
  background: rgba(229, 83, 75, 0.15); border: 1px solid var(--danger);
  color: var(--danger); padding: 10px 14px; border-radius: 6px; font-size: 14px;
}
.notice {
  background: rgba(62, 207, 107, 0.15); border: 1px solid var(--success);
  color: var(--success); padding: 10px 14px; border-radius: 6px; font-size: 14px;
}

.cat-section { display: flex; flex-direction: column; gap: 10px; }
.cat-title { font-size: 15px; color: var(--text); border-bottom: 1px solid var(--border); padding-bottom: 6px; }
.empty { padding: 8px 0; }

.grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
}
.recipe-card { display: flex; flex-direction: column; gap: 8px; }
.card-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.card-head h4 { margin: 0; font-size: 15px; }
.prof-badge {
  font-size: 12px; padding: 2px 8px; border-radius: 4px;
  background: rgba(76, 141, 255, 0.15); color: var(--accent);
  border: 1px solid var(--accent); white-space: nowrap;
}
.prof-badge.locked { background: rgba(224, 168, 60, 0.15); color: var(--warning); border-color: var(--warning); }

.io { display: flex; gap: 8px; font-size: 13px; line-height: 1.6; }
.io-label { min-width: 32px; }
.alt-set .affordable { color: var(--success); }

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

.warn { color: var(--warning); font-size: 13px; line-height: 1.6; }
.warn .miss { margin-right: 6px; }
</style>
