<script setup lang="ts">
import { onMounted, computed, ref, watch } from 'vue';
import { usePlayerStore } from '@/stores/player';
import { cardApi } from '@/services/api';
import { CARD_TYPE_META, effectSummary } from '@/utils/cards';
import type { Character, DeckCard, CardType } from '@/types';

const player = usePlayerStore();

const loading = ref(false);
const error = ref<string | null>(null);
const selectedId = ref<string | null>(null);
const deck = ref<DeckCard[]>([]);
const deckLoading = ref(false);
const deckError = ref<string | null>(null);

// 卡牌职业映射: card_template_id -> profession (用于前端预筛可分配卡牌)
const cardProfessionMap = ref<Map<string, string | null>>(new Map());

// 创建棋子
const showCreate = ref(false);
const newName = ref('');
const newProfession = ref('warrior');
const creating = ref(false);

// 改名
const renamingId = ref<string | null>(null);
const renameValue = ref('');

const PROFESSION_META: Record<string, { label: string; color: string }> = {
  warrior: { label: '战士', color: 'var(--danger)' },
  ranger: { label: '弓手', color: 'var(--success)' },
  mage: { label: '法师', color: 'var(--accent)' },
};
function profMeta(p: string) {
  return PROFESSION_META[p] ?? { label: p, color: 'var(--text-dim)' };
}

const DECK_MAX = 10;
const CHAR_MAX = 9;

const characters = computed<Character[]>(() => player.characters);
const selected = computed(() => characters.value.find((c) => c.id === selectedId.value) ?? null);
const deckFull = computed(() => deck.value.length >= DECK_MAX);

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'error' in e) {
    return String((e as { error?: unknown }).error);
  }
  return '操作失败';
}

/** 前端复刻后端 canUseProfession: 无 profession / 'common' 通用, 否则须严格匹配 */
function canUse(charProf: string, cardProf: string | null | undefined): boolean {
  if (!cardProf) return true;
  if (cardProf === 'common') return true;
  return charProf === cardProf;
}

/** 可分配卡牌: 按职业预筛 + 排除已分配给当前棋子的 */
const assignableCards = computed(() => {
  if (!selected.value) return [];
  const charProf = selected.value.profession;
  const assignedIds = new Set(deck.value.map((d) => d.card_id));
  return player.myCards.filter((c) => {
    if (assignedIds.has(c.id)) return false;
    const cardProf = c.card_template_id ? cardProfessionMap.value.get(c.card_template_id) : undefined;
    return canUse(charProf, cardProf);
  });
});

async function loadTemplates() {
  try {
    const res = await cardApi.templates();
    const m = new Map<string, string | null>();
    for (const t of res.data) m.set(t.id, t.profession);
    cardProfessionMap.value = m;
  } catch {
    // 降级: 不按职业筛, 后端仍会校验
  }
}

async function load() {
  loading.value = true;
  error.value = null;
  try {
    await Promise.all([
      player.fetchCharacters(),
      loadTemplates(),
      player.myCards.length === 0 ? player.fetchMyCards() : Promise.resolve(),
    ]);
    if (!selectedId.value && characters.value.length > 0) {
      selectedId.value = characters.value[0].id;
    }
  } catch (e) {
    error.value = errMsg(e);
  } finally {
    loading.value = false;
  }
}

async function loadDeck() {
  if (!selectedId.value) {
    deck.value = [];
    return;
  }
  deckLoading.value = true;
  deckError.value = null;
  try {
    deck.value = await player.fetchDeck(selectedId.value);
  } catch (e) {
    deckError.value = errMsg(e);
    deck.value = [];
  } finally {
    deckLoading.value = false;
  }
}

watch(selectedId, loadDeck);

function select(id: string) {
  selectedId.value = id;
  renamingId.value = null;
}

async function create() {
  const name = newName.value.trim();
  if (!name) return;
  creating.value = true;
  error.value = null;
  try {
    await player.createCharacter(name, newProfession.value);
    newName.value = '';
    showCreate.value = false;
    if (characters.value.length > 0) {
      selectedId.value = characters.value[characters.value.length - 1].id;
    }
  } catch (e) {
    error.value = errMsg(e);
  } finally {
    creating.value = false;
  }
}

function startRename(c: Character) {
  renamingId.value = c.id;
  renameValue.value = c.name;
}
function cancelRename() {
  renamingId.value = null;
}
async function confirmRename() {
  if (!renamingId.value) return;
  const name = renameValue.value.trim();
  if (!name) return;
  error.value = null;
  try {
    await player.renameCharacter(renamingId.value, name);
    renamingId.value = null;
  } catch (e) {
    error.value = errMsg(e);
  }
}

async function assign(cardId: string) {
  if (!selectedId.value || deckFull.value) return;
  deckError.value = null;
  try {
    await player.assignCard(selectedId.value, cardId);
    await loadDeck();
  } catch (e) {
    deckError.value = errMsg(e);
  }
}

async function removeCard(cardId: string) {
  if (!selectedId.value) return;
  deckError.value = null;
  try {
    await player.removeCard(selectedId.value, cardId);
    await loadDeck();
  } catch (e) {
    deckError.value = errMsg(e);
  }
}

onMounted(load);
</script>

<template>
  <div class="chars">
    <div class="head">
      <h2>棋子管理</h2>
      <div class="head-actions">
        <button class="secondary" :disabled="loading" @click="load">
          {{ loading ? '刷新中...' : '刷新' }}
        </button>
        <button v-if="characters.length < CHAR_MAX && !showCreate" @click="showCreate = true">
          + 创建棋子
        </button>
      </div>
    </div>

    <div v-if="loading && characters.length === 0" class="dim">加载中...</div>

    <template v-else>
      <div v-if="error" class="error-banner">{{ error }}</div>

      <!-- 创建表单 -->
      <form v-if="showCreate" class="create-form" @submit.prevent="create">
        <input v-model="newName" placeholder="棋子名称" maxlength="20" />
        <select v-model="newProfession">
          <option value="warrior">战士</option>
          <option value="ranger">弓手</option>
          <option value="mage">法师</option>
        </select>
        <button type="submit" :disabled="creating || !newName.trim()">
          {{ creating ? '创建中...' : '确认' }}
        </button>
        <button type="button" class="secondary" @click="showCreate = false">取消</button>
      </form>

      <!-- 棋子列表 -->
      <div v-if="characters.length === 0" class="dim empty">暂无棋子。点击「创建棋子」添加。</div>
      <div v-else class="char-grid">
        <div
          v-for="c in characters"
          :key="c.id"
          class="char-card"
          :class="{ selected: c.id === selectedId, dead: !c.is_alive }"
          @click="select(c.id)"
        >
          <div class="char-top">
            <span class="prof-tag" :style="{ background: profMeta(c.profession).color }">
              {{ profMeta(c.profession).label }}
            </span>
            <span v-if="!c.is_alive" class="dead-tag">阵亡</span>
          </div>
          <div v-if="renamingId === c.id" class="rename-row" @click.stop>
            <input v-model="renameValue" maxlength="20" @keyup.enter="confirmRename" />
            <button class="sm" @click="confirmRename">确定</button>
            <button class="sm secondary" @click="cancelRename">取消</button>
          </div>
          <div v-else class="char-name-row">
            <span class="char-name">{{ c.name }}</span>
            <button class="sm-link" @click.stop="startRename(c)">改名</button>
          </div>
          <div class="char-stats">
            <span>❤️ {{ c.health }}/{{ c.max_health }}</span>
            <span>⚡ {{ c.energy }}/{{ c.max_energy }}</span>
            <span>👣 {{ c.movement }}</span>
          </div>
        </div>
      </div>

      <!-- 选中棋子牌组面板 -->
      <section v-if="selected" class="deck-panel">
        <div class="deck-head">
          <h3>{{ selected.name }} 的牌组</h3>
          <span class="dim">{{ deck.length }} / {{ DECK_MAX }} 张</span>
        </div>

        <div v-if="deckLoading && deck.length === 0" class="dim">加载牌组中...</div>
        <div v-else-if="deckError" class="error-banner">{{ deckError }}</div>

        <!-- 当前牌组 -->
        <div v-if="!deckLoading || deck.length > 0" class="deck-section">
          <div v-if="deck.length === 0" class="dim empty">（暂无卡牌）</div>
          <div v-else class="deck-grid">
            <div
              v-for="d in deck"
              :key="d.deck_id"
              class="mini-card"
              :style="{ '--card-color': CARD_TYPE_META[d.type as CardType].color }"
            >
              <div class="mini-top">
                <span class="mini-type" :style="{ background: CARD_TYPE_META[d.type as CardType].color }">
                  {{ CARD_TYPE_META[d.type as CardType].label }}
                </span>
                <span class="mini-cost">⚡{{ d.cost }}</span>
              </div>
              <div class="mini-name">{{ d.name }}</div>
              <div class="mini-effect">{{ effectSummary(d.effect) }}</div>
              <button class="sm danger-btn" @click="removeCard(d.card_id)">移除</button>
            </div>
          </div>
        </div>

        <!-- 可分配卡牌 -->
        <div class="assign-section">
          <h4>可分配卡牌</h4>
          <div v-if="deckFull" class="dim empty">牌组已满，无法继续分配。</div>
          <div v-else-if="player.myCards.length === 0" class="dim empty">
            暂无卡牌。可通过工坊「制造」获取卡牌。
          </div>
          <div v-else-if="assignableCards.length === 0" class="dim empty">
            没有可分配给该职业的卡牌。
          </div>
          <div v-else class="assign-grid">
            <div
              v-for="c in assignableCards"
              :key="c.id"
              class="mini-card assignable"
              :style="{ '--card-color': CARD_TYPE_META[c.type].color }"
              @click="assign(c.id)"
            >
              <div class="mini-top">
                <span class="mini-type" :style="{ background: CARD_TYPE_META[c.type].color }">
                  {{ CARD_TYPE_META[c.type].label }}
                </span>
                <span class="mini-cost">⚡{{ c.cost }}</span>
                <span v-if="c.quantity > 1" class="qty">×{{ c.quantity }}</span>
              </div>
              <div class="mini-name">{{ c.name }}</div>
              <div class="mini-effect">{{ effectSummary(c.effect) }}</div>
              <button class="sm">分配</button>
            </div>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.chars { display: flex; flex-direction: column; gap: 16px; }

.head { display: flex; justify-content: space-between; align-items: center; }
.head h2 { margin: 0; }
.head-actions { display: flex; gap: 8px; }

.error-banner {
  background: rgba(229, 83, 75, 0.15); border: 1px solid var(--danger);
  color: var(--danger); padding: 10px 14px; border-radius: 6px; font-size: 14px;
}

.create-form {
  display: flex; gap: 8px; flex-wrap: wrap; align-items: center;
  background: var(--bg-panel-2); border: 1px solid var(--border);
  border-radius: 6px; padding: 12px;
}
.create-form input, .create-form select {
  background: var(--bg); border: 1px solid var(--border); color: var(--text);
  border-radius: 4px; padding: 6px 10px; font-size: 14px;
}
.create-form input { flex: 1; min-width: 140px; }

.empty { padding: 8px 0; }

.char-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}
.char-card {
  display: flex; flex-direction: column; gap: 8px;
  background: var(--bg-panel-2); border: 1px solid var(--border);
  border-radius: 8px; padding: 12px; cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.char-card:hover { border-color: var(--accent); }
.char-card.selected { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.char-card.dead { opacity: 0.55; }
.char-top { display: flex; justify-content: space-between; align-items: center; }
.prof-tag { font-size: 11px; color: #fff; padding: 1px 8px; border-radius: 8px; }
.dead-tag { font-size: 11px; color: var(--danger); }
.char-name-row { display: flex; justify-content: space-between; align-items: center; }
.char-name { font-size: 15px; font-weight: 600; }
.sm-link { background: none; border: none; color: var(--accent); font-size: 12px; cursor: pointer; padding: 0; }
.sm-link:hover { text-decoration: underline; }
.rename-row { display: flex; gap: 4px; align-items: center; }
.rename-row input {
  background: var(--bg); border: 1px solid var(--border); color: var(--text);
  border-radius: 4px; padding: 4px 8px; font-size: 13px; flex: 1; min-width: 0;
}
.char-stats { display: flex; gap: 12px; font-size: 12px; color: var(--text-dim); }

.deck-panel {
  display: flex; flex-direction: column; gap: 12px;
  background: var(--bg-panel); border: 1px solid var(--border);
  border-radius: 8px; padding: 16px;
}
.deck-head { display: flex; justify-content: space-between; align-items: baseline; }
.deck-head h3 { margin: 0; font-size: 15px; }

.deck-section, .assign-section { display: flex; flex-direction: column; gap: 8px; }
.assign-section h4 { margin: 0; font-size: 13px; color: var(--text-dim); }

.deck-grid, .assign-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 10px;
}
.mini-card {
  display: flex; flex-direction: column; gap: 4px;
  background: var(--bg-panel-2); border: 1px solid var(--border);
  border-left: 3px solid var(--card-color);
  border-radius: 6px; padding: 8px 10px;
}
.mini-card.assignable { cursor: pointer; }
.mini-card.assignable:hover { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.mini-top { display: flex; align-items: center; gap: 6px; }
.mini-type { font-size: 10px; color: #fff; padding: 0 6px; border-radius: 6px; }
.mini-cost { font-size: 12px; font-weight: 600; color: var(--warning); margin-left: auto; }
.qty { font-size: 11px; font-weight: 700; color: var(--accent); }
.mini-name { font-size: 13px; font-weight: 600; }
.mini-effect { font-size: 11px; color: var(--text-dim); }

.sm { font-size: 12px; padding: 3px 10px; border-radius: 4px; align-self: flex-start; }
.danger-btn { color: var(--danger); border-color: var(--danger); }
.danger-btn:hover { background: rgba(229, 83, 75, 0.15); }
</style>
