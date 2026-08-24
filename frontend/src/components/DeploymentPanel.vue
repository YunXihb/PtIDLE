<script setup lang="ts">
// T1015 布置阶段三面板组件
// ① 出战棋子选择(恰好 3) / ② 本方行 9 格摆位(点棋子激活 + 点格放置, 占位格交换) / ③ 每棋子配卡(tab + 加减张数)
// + 120s 倒计时(deadline 本地 tick) + 确认按钮 + 对方状态
// 草稿本地编辑, 深度 watch 节流 600ms 全量同步(仅合法草稿上传, 中间态不传);
// 外部变更(刷新恢复/另一端编辑)通过 deploy_state.myDraft 与 lastSyncedJson 对比采纳。
// 客户端预检与后端 deploymentService.validateDraft 同规则(3 棋子 / x 不重叠 / 同名≤3 / 总≤12 / 一卡实例禁入多棋子卡组)。
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useGameStore } from '@/stores/game';
import { usePlayerStore } from '@/stores/player';
import { cardApi } from '@/services/api';
import { CARD_TYPE_META, effectSummary } from '@/utils/cards';
import type { CardType, Character, DeployDraft, PlayerCard } from '@/types';

// 常量与后端 deploymentService 同规则
const PIECE_COUNT = 3;
const BOARD_SIZE = 9;
const MAX_DECK_SIZE = 12;
const MAX_SAME_CARD = 3;
const SYNC_THROTTLE_MS = 600;

const game = useGameStore();
const player = usePlayerStore();

const loadError = ref<string | null>(null);
// card_template_id -> profession (无模板/无职业 -> 'common', 对齐后端 COALESCE(ct.profession, 'common'))
const templateProfession = ref<Map<string, string>>(new Map());

const PROFESSION_META: Record<string, { label: string; color: string }> = {
  warrior: { label: '战士', color: 'var(--danger)' },
  ranger: { label: '弓手', color: 'var(--success)' },
  mage: { label: '法师', color: 'var(--accent)' },
};
function profMeta(p: string) {
  return PROFESSION_META[p] ?? { label: p, color: 'var(--text-dim)' };
}
const PROFESSION_GLYPH: Record<string, string> = { warrior: '战', ranger: '弓', mage: '法' };

// ---------- 基础数据 ----------
const aliveCharacters = computed<Character[]>(() => player.characters.filter((c) => c.is_alive));
const charById = computed(() => new Map(aliveCharacters.value.map((c) => [c.id, c])));

interface DeployCard {
  id: string;      // player_card_id (草稿卡组引用的就是它, 同行可重复入组, 每次占 1 张库存)
  name: string;
  type: CardType;
  cost: number;
  effect: Record<string, unknown>;
  templateNo: number;
  quantity: number;
  profession: string; // 'common' | 职业名
}

const cards = computed<DeployCard[]>(() =>
  player.myCards.map((pc: PlayerCard) => ({
    id: pc.id,
    name: pc.name,
    type: pc.type,
    cost: pc.cost,
    effect: pc.effect,
    templateNo: pc.template_no,
    quantity: pc.quantity,
    profession: pc.card_template_id
      ? (templateProfession.value.get(pc.card_template_id) ?? 'common')
      : 'common',
  }))
);
const cardById = computed(() => new Map(cards.value.map((c) => [c.id, c])));

// 同名卡判重键: 与后端同规则 template_no>0 ? t{no} : n{name}
function sameKey(c: DeployCard): string {
  return c.templateNo > 0 ? `t${c.templateNo}` : `n${c.name}`;
}

// ---------- 草稿状态 ----------
const selected = ref<string[]>([]);
const placements = ref<Record<string, number>>({}); // characterId -> x
const decks = ref<Record<string, string[]>>({});    // characterId -> player_card_id 列表(可重复)
const activePlacementId = ref<string | null>(null); // 摆位模式待放置棋子
const deckTabId = ref<string | null>(null);         // 配卡面板当前 tab

function buildDraft(): DeployDraft {
  return {
    selectedCharacters: [...selected.value],
    placements: selected.value.map((cid) => ({ characterId: cid, x: placements.value[cid] })),
    decks: Object.fromEntries(
      selected.value.map((cid) => [cid, [...(decks.value[cid] ?? [])]])
    ),
  };
}

function adoptDraft(d: DeployDraft | null) {
  if (!d) {
    selected.value = [];
    placements.value = {};
    decks.value = {};
  } else {
    selected.value = [...d.selectedCharacters];
    placements.value = Object.fromEntries(d.placements.map((p) => [p.characterId, p.x]));
    // 只保留仍选中棋子的卡组键
    decks.value = Object.fromEntries(
      d.selectedCharacters.map((cid) => [cid, [...(d.decks?.[cid] ?? [])]])
    );
  }
  activePlacementId.value = null;
}

// ---------- 部署视图(倒计时 / 确认状态) ----------
const mySide = computed<'p1' | 'p2'>(() => game.deployState?.mySide ?? 'p1');
const rowY = computed(() => (mySide.value === 'p1' ? 0 : 8));
const myConfirmed = computed(() => game.deployState?.myConfirmed === true);
const opponentConfirmed = computed(() => game.deployState?.opponentConfirmed === true);
// 已确认/已终结 -> 锁定编辑
const locked = computed(
  () => game.deployState?.myConfirmed === true || game.deployState?.finalized === true
);

// 倒计时: deadline 本地 tick(权威时限在服务端 Redis, 到期由 sweeper 推进)
const nowTs = ref(Date.now());
let tickTimer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  tickTimer = setInterval(() => { nowTs.value = Date.now(); }, 500);
});
onUnmounted(() => {
  if (tickTimer) clearInterval(tickTimer);
  if (syncTimer) clearTimeout(syncTimer);
});
const remainingMs = computed(() => {
  const dl = game.deployState ? Date.parse(game.deployState.deadline) : 0;
  return Math.max(0, dl - nowTs.value);
});
const remainingLabel = computed(() => {
  const s = Math.ceil(remainingMs.value / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
});
const urgent = computed(() => remainingMs.value > 0 && remainingMs.value < 10000);
const expired = computed(() => remainingMs.value <= 0);

// ---------- 外部草稿采纳(挂载 hydrate + 运行中外部变更) ----------
// 自己同步成功后的 echo 与 lastSyncedJson 相等 -> 跳过; 不同即为外部变更(刷新恢复/另一端) -> 采纳
const lastSyncedJson = ref<string | null>(null);
watch(
  () => game.deployState,
  (st) => {
    if (!st) return;
    const j = st.myDraft ? JSON.stringify(st.myDraft) : null;
    if (j !== lastSyncedJson.value) {
      adoptDraft(st.myDraft);
      lastSyncedJson.value = j;
    }
  },
  { immediate: true }
);

// ---------- 草稿同步(节流 600ms, 仅合法草稿上传) ----------
let syncTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSync() {
  if (syncTimer) return;
  syncTimer = setTimeout(() => {
    syncTimer = null;
    flushSync();
  }, SYNC_THROTTLE_MS);
}
function flushSync() {
  if (!draftValid.value) return; // 中间态不上传(后端只收合法全量草稿)
  const d = buildDraft();
  const j = JSON.stringify(d);
  if (j === lastSyncedJson.value) return;
  lastSyncedJson.value = j;
  game.updateDeployDraft(d);
}
watch([selected, placements, decks], scheduleSync, { deep: true });

// ---------- 客户端预检(与后端 validateDraft 同规则; UI 已限制, 双保险) ----------
const draftValid = computed(() => {
  if (selected.value.length !== PIECE_COUNT) return false;
  if (new Set(selected.value).size !== PIECE_COUNT) return false;
  const xs = selected.value.map((cid) => placements.value[cid]);
  if (xs.some((x) => !Number.isInteger(x) || x < 0 || x >= BOARD_SIZE)) return false;
  if (new Set(xs).size !== PIECE_COUNT) return false;
  const owner = new Map<string, string>(); // player_card_id -> 已分配棋子
  for (const cid of selected.value) {
    const deck = decks.value[cid] ?? [];
    if (deck.length > MAX_DECK_SIZE) return false;
    const same = new Map<string, number>();
    for (const cardId of deck) {
      const card = cardById.value.get(cardId);
      if (!card) return false;
      const prev = owner.get(cardId);
      if (prev !== undefined && prev !== cid) return false; // 一卡实例禁入多棋子卡组
      owner.set(cardId, cid);
      const key = sameKey(card);
      same.set(key, (same.get(key) ?? 0) + 1);
    }
    for (const n of same.values()) {
      if (n > MAX_SAME_CARD) return false;
    }
  }
  return true;
});

// ---------- 面板 1: 出战棋子 ----------
function onToggleSelect(c: Character) {
  if (locked.value) return;
  const idx = selected.value.indexOf(c.id);
  if (idx >= 0) {
    selected.value.splice(idx, 1);
    delete placements.value[c.id];
    delete decks.value[c.id];
    if (activePlacementId.value === c.id) activePlacementId.value = null;
  } else {
    if (selected.value.length >= PIECE_COUNT) return; // 已满(UI 已禁用, 双保险)
    selected.value.push(c.id);
    // 自动分配空列: p1 从左(0)起 / p2 从右(8)起
    placements.value[c.id] = firstFreeX();
  }
}
function firstFreeX(): number {
  const used = new Set(Object.values(placements.value));
  const seq = mySide.value === 'p1'
    ? Array.from({ length: BOARD_SIZE }, (_, i) => i)
    : Array.from({ length: BOARD_SIZE }, (_, i) => BOARD_SIZE - 1 - i);
  for (const x of seq) {
    if (!used.has(x)) return x;
  }
  return 0;
}

// ---------- 面板 2: 本方行摆位 ----------
const colRange = Array.from({ length: BOARD_SIZE }, (_, i) => i);
function charAtX(x: number): Character | undefined {
  const cid = selected.value.find((id) => placements.value[id] === x);
  return cid ? charById.value.get(cid) : undefined;
}
// 点击选中棋子卡片 -> 激活摆位(再次点击取消)
function onSelectedCardClick(c: Character) {
  if (locked.value || !selected.value.includes(c.id)) return;
  activePlacementId.value = activePlacementId.value === c.id ? null : c.id;
}
function onRowCellClick(x: number) {
  if (locked.value) return;
  const active = activePlacementId.value;
  if (!active) return;
  const occupantCid = selected.value.find((id) => placements.value[id] === x);
  if (occupantCid === active) {
    // 点击激活棋子所在格 -> 取消激活
    activePlacementId.value = null;
    return;
  }
  if (occupantCid) {
    // 目标格被己方棋子占用 -> 交换两棋子列位
    placements.value[occupantCid] = placements.value[active];
  }
  placements.value[active] = x;
  activePlacementId.value = null;
}

// ---------- 面板 3: 每棋子配卡 ----------
const currentTabId = computed<string | null>(() => {
  if (deckTabId.value && selected.value.includes(deckTabId.value)) return deckTabId.value;
  return selected.value[0] ?? null;
});
function charName(cid: string): string {
  return charById.value.get(cid)?.name ?? cid;
}
function deckTotal(cid: string): number {
  return (decks.value[cid] ?? []).length;
}
function deckCount(cid: string, cardId: string): number {
  return (decks.value[cid] ?? []).filter((id) => id === cardId).length;
}
// 他组已用张数(一卡实例禁入多棋子卡组: >0 则本组整卡不可用)
function usedOutside(cid: string, cardId: string): number {
  let n = 0;
  for (const [k, deck] of Object.entries(decks.value)) {
    if (k === cid) continue;
    n += deck.filter((id) => id === cardId).length;
  }
  return n;
}
function copiesAvailable(cid: string, card: DeployCard): number {
  if (usedOutside(cid, card.id) > 0) return 0;
  return card.quantity - deckCount(cid, card.id);
}
// 同名卡(判重键口径)当前组张数
function sameNameCount(cid: string, card: DeployCard): number {
  const key = sameKey(card);
  return (decks.value[cid] ?? []).filter((id) => {
    const c = cardById.value.get(id);
    return c !== undefined && sameKey(c) === key;
  }).length;
}
function canAdd(cid: string, card: DeployCard): boolean {
  if (locked.value) return false;
  if (copiesAvailable(cid, card) <= 0) return false;
  if (deckTotal(cid) >= MAX_DECK_SIZE) return false;
  if (sameNameCount(cid, card) >= MAX_SAME_CARD) return false;
  return true;
}
function addCard(cid: string, card: DeployCard) {
  if (!canAdd(cid, card)) return;
  decks.value[cid] = [...(decks.value[cid] ?? []), card.id];
}
function removeCard(cid: string, card: DeployCard) {
  if (locked.value) return;
  const deck = decks.value[cid] ?? [];
  const idx = deck.lastIndexOf(card.id);
  if (idx < 0) return;
  decks.value[cid] = deck.filter((_, i) => i !== idx);
}
// 当前 tab 的职业过滤(对齐后端 card_profession_mismatch 规则: common 通用, 否则须严格匹配)
const tabCards = computed<DeployCard[]>(() => {
  const cid = currentTabId.value;
  if (!cid) return [];
  const char = charById.value.get(cid);
  if (!char) return [];
  return cards.value.filter((c) => c.profession === 'common' || c.profession === char.profession);
});
// 当前 tab 卡组聚合展示(卡 × 张数, 按首次入组顺序)
const tabDeckRows = computed(() => {
  const cid = currentTabId.value;
  const deck = cid ? (decks.value[cid] ?? []) : [];
  const order: string[] = [];
  const counts = new Map<string, number>();
  for (const id of deck) {
    if (!counts.has(id)) order.push(id);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return order
    .map((id) => ({ card: cardById.value.get(id), count: counts.get(id) ?? 0 }))
    .filter((r): r is { card: DeployCard; count: number } => r.card !== undefined);
});

// ---------- 确认 ----------
function onConfirm() {
  if (!draftValid.value || locked.value) return;
  // 先冲刷未同步的草稿(同 socket 顺序送达), 再确认; 后端 confirm 要求草稿已存在且合法
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }
  flushSync();
  game.confirmDeploy();
}

// ---------- 基础数据加载 ----------
onMounted(async () => {
  try {
    const [, , tplRes] = await Promise.all([
      player.characters.length ? Promise.resolve() : player.fetchCharacters(),
      player.myCards.length ? Promise.resolve() : player.fetchMyCards(1, 200),
      cardApi.templates(),
    ]);
    const m = new Map<string, string>();
    for (const t of tplRes.data) {
      if (t.profession) m.set(t.id, t.profession);
    }
    templateProfession.value = m;
  } catch (e) {
    loadError.value = (e as { error?: string })?.error || '加载棋子/卡牌失败';
  }
});
</script>

<template>
  <div class="deploy-panel panel">
    <!-- 头部: 阶段 + 倒计时 + 双方状态 -->
    <div class="deploy-head">
      <h3 class="section-title">布置阶段</h3>
      <span class="badge countdown" :class="{ urgent, expired }">
        {{ expired ? '⏱ 时间到' : `⏱ ${remainingLabel}` }}
      </span>
      <span class="badge" :class="{ ok: opponentConfirmed }">
        {{ opponentConfirmed ? '对方已确认' : '对方布置中…' }}
      </span>
      <span class="badge">我方 {{ mySide === 'p1' ? 'P1' : 'P2' }} · 第 {{ rowY }} 行</span>
    </div>

    <p v-if="loadError" class="error-msg">{{ loadError }}</p>

    <!-- 面板 1: 出战棋子 -->
    <section class="deploy-section">
      <div class="section-head">
        <h4>① 出战棋子</h4>
        <span class="dim">{{ selected.length }}/{{ PIECE_COUNT }}</span>
      </div>
      <p class="hint dim">点击卡片选中出战棋子（已选中的再点一次为摆位激活/取消选中）。</p>
      <div v-if="aliveCharacters.length === 0" class="dim empty">暂无存活棋子。</div>
      <div v-else class="char-grid">
        <div
          v-for="c in aliveCharacters"
          :key="c.id"
          class="char-card"
          :class="{ selected: selected.includes(c.id), active: activePlacementId === c.id }"
          @click="selected.includes(c.id) ? onSelectedCardClick(c) : onToggleSelect(c)"
        >
          <div class="char-top">
            <span class="prof-tag" :style="{ background: profMeta(c.profession).color }">
              {{ profMeta(c.profession).label }}
            </span>
            <span v-if="activePlacementId === c.id" class="active-mark">放这里</span>
            <span v-else-if="selected.includes(c.id)" class="check">✓</span>
          </div>
          <div class="char-name">{{ c.name }}</div>
          <div class="char-stats">
            <span>❤️ {{ c.health }}/{{ c.max_health }}</span>
            <span>⚡ {{ c.energy }}/{{ c.max_energy }}</span>
            <span>👣 {{ c.movement }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- 面板 2: 本方行摆位 -->
    <section class="deploy-section">
      <div class="section-head">
        <h4>② 摆位</h4>
        <span class="dim">本方行 y={{ rowY }}（{{ mySide === 'p1' ? '底部' : '顶部' }}）</span>
      </div>
      <p class="hint dim">先点棋子激活，再点格子放置；点己方已占格会交换两棋子位置。</p>
      <div class="placement-row" :style="{ gridTemplateColumns: `repeat(${BOARD_SIZE}, 1fr)` }">
        <div
          v-for="x in colRange"
          :key="x"
          class="place-cell"
          :class="{
            occupied: charAtX(x) !== undefined,
            active: activePlacementId !== null && placements[activePlacementId] === x,
          }"
          :title="charAtX(x) ? charAtX(x)!.name : `列 ${x}`"
          @click="onRowCellClick(x)"
        >
          <template v-if="charAtX(x)">
            <span class="glyph">{{ PROFESSION_GLYPH[charAtX(x)!.profession] ?? '?' }}</span>
          </template>
          <span v-else class="dim col-label">{{ x }}</span>
        </div>
      </div>
      <p v-if="activePlacementId" class="hint accent">
        已激活「{{ charName(activePlacementId) }}」，点击上方格子放置。
      </p>
    </section>

    <!-- 面板 3: 每棋子配卡 -->
    <section class="deploy-section">
      <div class="section-head">
        <h4>③ 配卡</h4>
        <span v-if="currentTabId" class="dim">{{ deckTotal(currentTabId) }}/{{ MAX_DECK_SIZE }} 张</span>
      </div>
      <div v-if="selected.length" class="tabs">
        <button
          v-for="cid in selected"
          :key="cid"
          type="button"
          class="tab"
          :class="{ on: cid === currentTabId }"
          @click="deckTabId = cid"
        >
          {{ charName(cid) }}
        </button>
      </div>
      <p v-if="selected.length" class="hint dim">
        每棋子同名卡 ≤{{ MAX_SAME_CARD }} 张、总张数 ≤{{ MAX_DECK_SIZE }}；同一张卡不可配给多个棋子。空卡组合法（对局抽公共池卡）。
      </p>

      <template v-if="currentTabId">
        <!-- 已配卡组(聚合展示) -->
        <div v-if="tabDeckRows.length" class="deck-tags">
          <span
            v-for="r in tabDeckRows"
            :key="r.card.id"
            class="deck-tag"
            :style="{ '--card-color': CARD_TYPE_META[r.card.type].color }"
          >
            {{ r.card.name }}<template v-if="r.count > 1"> ×{{ r.count }}</template>
          </span>
        </div>
        <p v-else class="dim empty">（空卡组，对局将全部抽公共池卡）</p>

        <!-- 可配卡列表(职业过滤) -->
        <div v-if="tabCards.length === 0" class="dim empty">没有可配给该职业的卡牌。</div>
        <div v-else class="card-list">
          <div
            v-for="c in tabCards"
            :key="c.id"
            class="card-row"
            :class="{ disabled: copiesAvailable(currentTabId, c) <= 0 }"
          >
            <span class="mini-type" :style="{ background: CARD_TYPE_META[c.type].color }">
              {{ CARD_TYPE_META[c.type].label }}
            </span>
            <span class="card-name">{{ c.name }}</span>
            <span class="mini-effect">{{ effectSummary(c.effect) }}</span>
            <span class="mini-cost">⚡{{ c.cost }}</span>
            <span class="qty dim">库存 {{ copiesAvailable(currentTabId, c) }}/{{ c.quantity }}</span>
            <span class="count-ctrl">
              <button
                type="button"
                class="sm"
                :disabled="locked || deckCount(currentTabId, c.id) <= 0"
                @click="removeCard(currentTabId, c)"
              >−</button>
              <span class="count">{{ deckCount(currentTabId, c.id) }}</span>
              <button
                type="button"
                class="sm"
                :disabled="!canAdd(currentTabId, c)"
                @click="addCard(currentTabId, c)"
              >＋</button>
            </span>
          </div>
        </div>
      </template>
      <p v-else class="dim empty">先在 ① 中选择出战棋子。</p>
    </section>

    <!-- 底部: 确认 -->
    <div class="deploy-foot">
      <span v-if="myConfirmed" class="dim">已确认，等待对方…（超时将自动开战）</span>
      <span v-else-if="expired" class="dim">时间到，等待自动开战…</span>
      <template v-else>
        <button type="button" class="confirm-btn" :disabled="!draftValid" @click="onConfirm">
          确认出战
        </button>
        <span v-if="!draftValid" class="dim">
          {{ selected.length < PIECE_COUNT ? `还需选择 ${PIECE_COUNT - selected.length} 个棋子` : '配置不完整' }}
        </span>
      </template>
    </div>
  </div>
</template>

<style scoped>
.deploy-panel { display: flex; flex-direction: column; gap: 14px; }

.deploy-head {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
}
.deploy-head .section-title { margin: 0; font-size: 15px; }
.badge {
  background: var(--bg-panel-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 3px 10px;
  font-size: 12px;
  color: var(--text-dim);
}
.badge.ok { color: var(--success); border-color: var(--success); }
.badge.countdown { color: var(--accent); font-weight: 600; }
.badge.countdown.urgent { color: var(--danger); border-color: var(--danger); }
.badge.countdown.expired { color: var(--danger); border-color: var(--danger); }

.deploy-section { display: flex; flex-direction: column; gap: 8px; }
.section-head { display: flex; justify-content: space-between; align-items: baseline; }
.section-head h4 { margin: 0; font-size: 14px; }
.hint { font-size: 12px; margin: 0; }
.hint.accent { color: var(--accent); }
.empty { font-size: 12px; margin: 4px 0; }
.error-msg { font-size: 12px; color: var(--danger); margin: 0; }
.dim { color: var(--text-dim); }

/* 面板 1: 棋子卡片 */
.char-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 8px;
}
.char-card {
  display: flex; flex-direction: column; gap: 6px;
  background: var(--bg-panel-2); border: 1px solid var(--border);
  border-radius: 8px; padding: 10px; cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.char-card:hover { border-color: var(--accent); }
.char-card.selected { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.char-card.active { border-color: var(--success); box-shadow: 0 0 0 2px var(--success); }
.char-top { display: flex; justify-content: space-between; align-items: center; }
.prof-tag { font-size: 11px; color: #fff; padding: 1px 8px; border-radius: 8px; }
.check { color: var(--success); font-weight: 700; font-size: 13px; }
.active-mark { color: var(--success); font-size: 11px; }
.char-name { font-size: 14px; font-weight: 600; }
.char-stats { display: flex; gap: 10px; font-size: 12px; color: var(--text-dim); }

/* 面板 2: 本方行摆位 */
.placement-row {
  display: grid; gap: 4px;
  max-width: 480px;
}
.place-cell {
  aspect-ratio: 1 / 1; min-height: 36px; min-width: 0;
  background: var(--bg-panel-2); border: 1px solid var(--border);
  border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: background 0.12s, border-color 0.12s;
}
.place-cell:hover { border-color: var(--accent); }
.place-cell.occupied {
  background: color-mix(in srgb, var(--accent) 25%, var(--bg-panel-2));
  border-color: var(--accent);
}
.place-cell.active {
  background: color-mix(in srgb, var(--success) 40%, var(--bg-panel-2));
  border-color: var(--success);
  box-shadow: 0 0 0 2px var(--success);
}
.place-cell .glyph { font-size: 15px; font-weight: 700; }
.col-label { font-size: 11px; }

/* 面板 3: 配卡 */
.tabs { display: flex; gap: 6px; flex-wrap: wrap; }
.tab {
  background: var(--bg-panel-2); border: 1px solid var(--border); color: var(--text-dim);
  border-radius: 6px; padding: 4px 12px; font-size: 13px; cursor: pointer;
}
.tab.on { color: var(--accent); border-color: var(--accent); }

.deck-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.deck-tag {
  font-size: 12px;
  background: var(--bg-panel-2);
  border: 1px solid var(--border);
  border-left: 3px solid var(--card-color, var(--border));
  border-radius: 6px;
  padding: 2px 8px;
}

.card-list { display: flex; flex-direction: column; gap: 6px; }
.card-row {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  background: var(--bg-panel-2); border: 1px solid var(--border);
  border-radius: 6px; padding: 6px 10px;
}
.card-row.disabled { opacity: 0.5; }
.mini-type { font-size: 10px; color: #fff; padding: 0 6px; border-radius: 6px; }
.card-name { font-size: 13px; font-weight: 600; }
.mini-effect { font-size: 11px; color: var(--text-dim); flex: 1; min-width: 100px; }
.mini-cost { font-size: 12px; font-weight: 600; color: var(--warning); }
.qty { font-size: 11px; }
.count-ctrl { display: flex; align-items: center; gap: 6px; }
.count { font-size: 13px; font-weight: 700; min-width: 14px; text-align: center; }
.sm { font-size: 12px; padding: 1px 8px; }

/* 底部: 确认 */
.deploy-foot { display: flex; align-items: center; gap: 10px; }
.confirm-btn {
  background: var(--success); color: #fff; border: none; cursor: pointer;
  border-radius: 6px; padding: 8px 20px; font-size: 14px; font-weight: 600;
}
.confirm-btn:hover { opacity: 0.9; }
.confirm-btn:disabled { opacity: 0.45; cursor: not-allowed; }
</style>
