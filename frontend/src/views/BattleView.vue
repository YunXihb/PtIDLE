<script setup lang="ts">
// T068 战棋对战界面 -- 棋盘渲染 + T069 棋子渲染 + T070 手牌渲染 + T071 移动交互 + T072 打牌交互
// 实时棋盘状态来自 game store (WS 推送, T073 接入); WS 未接前用预览 mock 验证渲染+交互
// 后续 T073(WS)/T077(匹配) 在此扩展
import { ref, computed, watch } from 'vue';
import { useGameStore } from '@/stores/game';
import BattleBoard from '@/components/BattleBoard.vue';
import BattleHand from '@/components/BattleHand.vue';
import { computeReachableCells } from '@/utils/movement';
import { cardNeedsTarget, cardIsAOE, computeCardTargets } from '@/utils/cards';
import type { BoardStateEvent, CharacterStatus, BattlePhase, HandCard } from '@/types';

const game = useGameStore();

// 开发预览: WS(T073) 未接前用 mock BoardStateEvent + ownHand 验证棋盘+棋子+手牌+移动交互, T073 落地后移除
const previewMode = ref(false);
// 预览阶段切换: move(默认, 对齐 T068/T069) / play(验证手牌可点击态)
const previewPhase = ref<BattlePhase>('move');

// mock 棋子定义(不含 position, position 由 mockPositions 注入以支持预览交互移动)
// own 3 (P1 底 y=0) + enemy 3 (P2 顶 y=8); movement: warrior2/ranger3/mage2(对齐后端 professions.base_movement)
// 含一受损(ranger 3/8) + 一护盾(warrior 🛡2) + 当前行动者=own warrior, 验证各渲染分支
const mockCharDefs: Omit<CharacterStatus, 'position'>[] = [
  { characterId: 'ow', name: '我的战士', profession: 'warrior', health: 12, maxHealth: 12, energy: 1, maxEnergy: 3, movement: 2, isAlive: true, effects: [], totalShield: 2, isTaunted: false, taunting: [] },
  { characterId: 'or', name: '我的弓手', profession: 'ranger', health: 8, maxHealth: 8, energy: 2, maxEnergy: 3, movement: 3, isAlive: true, effects: [], totalShield: 0, isTaunted: false, taunting: [] },
  { characterId: 'om', name: '我的法师', profession: 'mage', health: 6, maxHealth: 6, energy: 3, maxEnergy: 3, movement: 2, isAlive: true, effects: [], totalShield: 0, isTaunted: false, taunting: [] },
  { characterId: 'ew', name: '敌方战士', profession: 'warrior', health: 10, maxHealth: 12, energy: 1, maxEnergy: 3, movement: 2, isAlive: true, effects: [], totalShield: 0, isTaunted: true, taunting: [] },
  { characterId: 'er', name: '敌方弓手', profession: 'ranger', health: 3, maxHealth: 8, energy: 0, maxEnergy: 3, movement: 3, isAlive: true, effects: [{ type: 'burn', value: 1, duration_rounds: 2, expire_round: 999, created_round: 1, effect_id: 'e1' }], totalShield: 0, isTaunted: false, taunting: [] },
  { characterId: 'em', name: '敌方法师', profession: 'mage', health: 6, maxHealth: 6, energy: 2, maxEnergy: 3, movement: 2, isAlive: true, effects: [{ type: 'mark_fire', duration_rounds: 99999, expire_round: 99999, created_round: 1, effect_id: 'e2' }], totalShield: 0, isTaunted: false, taunting: [] },
];
const mockOwnIds = ['ow', 'or', 'om'];

// 预览棋子位置(reactive, 支持交互移动后更新)
const mockPositions = ref<Record<string, { x: number; y: number }>>({
  ow: { x: 6, y: 0 }, or: { x: 7, y: 0 }, om: { x: 8, y: 0 },
  ew: { x: 0, y: 8 }, er: { x: 1, y: 8 }, em: { x: 2, y: 8 },
});

// mock 手牌: 3 own 角色各含 attack/defense/tactical + 公共池卡(轻击)验证来源徽章 + 能量不足(战士 energy1 vs 重击 cost2)
const mockOwnHand: Record<string, HandCard[]> = {
  ow: [
    { deck_id: 'ow-c1', card_id: 'ow-c1', name: '轻击', type: 'attack', cost: 1, effect: { damage: 2 }, template_no: 1, source: 'public_pool' },
    { deck_id: 'ow-c2', card_id: 'ow-pc2', name: '重击', type: 'attack', cost: 2, effect: { damage: 4 }, template_no: 3, source: 'deck' },
    { deck_id: 'ow-c3', card_id: 'ow-pc3', name: '防御', type: 'defense', cost: 1, effect: { shield: 3 }, template_no: 6, source: 'deck' },
  ],
  or: [
    { deck_id: 'or-c1', card_id: 'or-pc1', name: '精准射击', type: 'attack', cost: 1, effect: { damage: 3, range: 3 }, template_no: 4, source: 'deck' },
    { deck_id: 'or-c2', card_id: 'or-pc2', name: '移动', type: 'tactical', cost: 0, effect: { movement: 1 }, template_no: 2, source: 'deck' },
  ],
  om: [
    { deck_id: 'om-c1', card_id: 'om-pc1', name: '火球术', type: 'attack', cost: 2, effect: { damage: 3, aoe: true }, template_no: 5, source: 'deck' },
    { deck_id: 'om-c2', card_id: 'om-pc2', name: '治疗', type: 'tactical', cost: 1, effect: { heal: 3 }, template_no: 7, source: 'deck' },
    { deck_id: 'om-c3', card_id: 'om-pc3', name: '挑战', type: 'tactical', cost: 1, effect: { type: 'taunt', range: 3, duration: 1, target: 'single_enemy' }, template_no: 8, source: 'deck' },
  ],
};

const mockBoard = computed<BoardStateEvent>(() => ({
  battleId: 'preview',
  currentRound: 1,
  currentStep: 1,
  currentPhase: previewPhase.value,
  currentActorId: 'ow',
  characters: mockCharDefs.map((c) => ({ ...c, position: mockPositions.value[c.characterId] ?? null })),
  p1Stars: 0,
  p2Stars: 0,
  bases: { '2,2': 'p1', '6,6': 'p2' },
}));
const displayBoard = computed<BoardStateEvent | null>(() =>
  previewMode.value ? mockBoard.value : game.board,
);
// 预览模式用 mockOwnIds, 实战用 game store myCharacterIds
const ownIds = computed<string[]>(() => (previewMode.value ? mockOwnIds : game.myCharacterIds));

// 手牌数据: 预览用 mockOwnHand, 实战用 game.ownHand
const displayHand = computed<Record<string, HandCard[]>>(() =>
  previewMode.value ? mockOwnHand : game.ownHand,
);
const isPlayPhase = computed(() => displayBoard.value?.currentPhase === 'play');

// 每个 own 角色的手牌组(合并 board.characters 取 name/profession/energy + isCurrentActor)
const handGroups = computed(() => {
  const board = displayBoard.value;
  const hand = displayHand.value;
  if (!board) return [];
  return Object.keys(hand).map((characterId) => {
    const c = board.characters.find((ch) => ch.characterId === characterId);
    return {
      characterId,
      name: c?.name,
      profession: c?.profession,
      energy: c?.energy ?? 0,
      cards: hand[characterId],
      isCurrentActor: board.currentActorId === characterId,
    };
  });
});

// ---------- T071 移动交互 ----------
// 选中(待移动)的棋子 id; 仅当前行动者(自己)+move 阶段可选中
const selectedCharacterId = ref<string | null>(null);

const isMovePhase = computed(() => displayBoard.value?.currentPhase === 'move');
// 当前行动者是否可被自己选中(移动阶段 + 当前 actor 是己方)
const canSelectActor = computed(() => {
  const board = displayBoard.value;
  if (!board || !isMovePhase.value || !board.currentActorId) return false;
  return ownIds.value.includes(board.currentActorId);
});

// 可移动格集合: 选中当前 actor 时, BFS 计算其移动力内可达格
const movableCells = computed<Set<string>>(() => {
  const board = displayBoard.value;
  const sel = selectedCharacterId.value;
  if (!board || !sel || !canSelectActor.value || sel !== board.currentActorId) return new Set();
  const actor = board.characters.find((c) => c.characterId === sel);
  if (!actor || !actor.position) return new Set();
  // occupied = 所有有位置的棋子(与后端 getAllBoardPositions 同源, 含死棋)
  const occupied = new Set<string>();
  for (const c of board.characters) {
    if (c.position) occupied.add(`${c.position.x},${c.position.y}`);
  }
  return computeReachableCells(occupied, actor.position, actor.movement);
});

// ---------- T072 打牌交互 ----------
// 出牌阶段 + 当前 actor 是己方时, 可打牌/跳过
const canPlayCards = computed(() => {
  const board = displayBoard.value;
  if (!board || !isPlayPhase.value || !board.currentActorId) return false;
  return ownIds.value.includes(board.currentActorId);
});

// 待选目标的卡牌 (进入目标选择模式后非空)
const selectedCard = ref<{ characterId: string; card: HandCard } | null>(null);
// 预览模式打牌反馈
const previewNotice = ref<string | null>(null);

// 可目标集合: selectedCard 为 needsTarget 卡时, 计算敌方+存活+射程内目标
const targetableIds = computed<Set<string>>(() => {
  const sel = selectedCard.value;
  const board = displayBoard.value;
  if (!sel || !board || !canPlayCards.value) return new Set();
  const actor = board.characters.find((c) => c.characterId === sel.characterId);
  if (!actor) return new Set();
  return new Set(computeCardTargets(actor, board.characters, ownIds.value, sel.card));
});

const selectedCardDeckId = computed(() => selectedCard.value?.card.deck_id ?? null);

// 实际打牌 (preview 仅提示, real 走 WS)
function playCard(characterId: string, card: HandCard, targetId?: string) {
  if (previewMode.value) {
    const tgt = targetId ? ` → 目标 ${targetId}` : '';
    previewNotice.value = `已打出「${card.name}」${tgt}（预览模式，无实际效果）`;
  } else {
    game.playCard(characterId, card, targetId);
  }
  selectedCard.value = null;
}

function onSkipPlay() {
  if (!canPlayCards.value) return;
  if (previewMode.value) {
    previewNotice.value = '已跳过出牌（预览模式）';
  } else {
    game.skipPlay();
  }
  selectedCard.value = null;
}

// actor/phase 变化时清空选中(移动后 phase->play 或 回合切换)
// 用原始字符串 key 比较, 仅 actor/phase 真变化才触发(避免 board 对象刷新误清)
watch(
  () => `${displayBoard.value?.currentActorId ?? ''}|${displayBoard.value?.currentPhase ?? ''}`,
  () => {
    selectedCharacterId.value = null;
    selectedCard.value = null;
    previewNotice.value = null;
  },
);

function onPieceClick(p: { characterId: string; x: number; y: number }) {
  // T072: 目标选择模式优先 -- 点可目标棋子打出, 点其他取消
  if (selectedCard.value) {
    if (targetableIds.value.has(p.characterId)) {
      playCard(selectedCard.value.characterId, selectedCard.value.card, p.characterId);
    } else {
      selectedCard.value = null;
    }
    return;
  }
  // T071: 移动选择 -- 仅当前行动者(己方)+移动阶段可选中, 再次点击取消
  if (canSelectActor.value && p.characterId === displayBoard.value?.currentActorId) {
    selectedCharacterId.value = selectedCharacterId.value === p.characterId ? null : p.characterId;
  } else {
    // 点其他棋子取消选中
    selectedCharacterId.value = null;
  }
}

function onCellClick(p: { x: number; y: number }) {
  // T072: 目标选择模式下点空格取消
  if (selectedCard.value) {
    selectedCard.value = null;
    return;
  }
  // T071: 移动
  const sel = selectedCharacterId.value;
  if (!sel) return;
  const key = `${p.x},${p.y}`;
  if (!movableCells.value.has(key)) {
    // 点非可移动格取消选中
    selectedCharacterId.value = null;
    return;
  }
  // 执行移动
  if (previewMode.value) {
    // 预览: 本地更新位置(无 WS), 清选中, 保持 move 阶段供反复测试
    mockPositions.value = { ...mockPositions.value, [sel]: { x: p.x, y: p.y } };
    selectedCharacterId.value = null;
  } else {
    game.move(sel, p.x, p.y);
    selectedCharacterId.value = null;
  }
}

function onCardClick(p: { characterId: string; card: HandCard }) {
  if (!canPlayCards.value) return;
  // 仅当前 actor 可打牌
  if (p.characterId !== displayBoard.value?.currentActorId) return;
  previewNotice.value = null;
  const card = p.card;
  if (cardIsAOE(card)) {
    // AOE 无需选目标, 直接打出
    playCard(p.characterId, card, undefined);
  } else if (cardNeedsTarget(card)) {
    // 进入目标选择模式; 再次点同一卡取消
    const cur = selectedCard.value;
    if (cur && cur.characterId === p.characterId && cur.card.deck_id === card.deck_id) {
      selectedCard.value = null;
    } else {
      selectedCard.value = { characterId: p.characterId, card };
    }
  }
  // unsupported 卡 BattleHand 已禁用, 不会到达此分支
}

function togglePreviewPhase() {
  previewPhase.value = previewPhase.value === 'play' ? 'move' : 'play';
  selectedCharacterId.value = null;
  selectedCard.value = null;
  previewNotice.value = null;
}
</script>

<template>
  <div class="battle-view">
    <h2>对战</h2>

    <BattleBoard
      v-if="displayBoard"
      :board="displayBoard"
      :own-character-ids="ownIds"
      :selected-character-id="selectedCharacterId"
      :movable-cells="movableCells"
      :targetable-character-ids="targetableIds"
      @cell-click="onCellClick"
      @piece-click="onPieceClick"
    />

    <!-- T071/T072 交互提示 -->
    <p v-if="selectedCard" class="hint">
      选择高亮敌方棋子打出「{{ selectedCard.card.name }}」，或点击空白/其他处取消。
      <span v-if="!targetableIds.size" class="error-msg">（射程内无有效目标）</span>
    </p>
    <p v-else-if="canSelectActor" class="hint dim">
      移动阶段：点击你的当前行动棋子查看可移动范围，再点击高亮格移动。
    </p>
    <p v-else-if="canPlayCards" class="hint dim">
      出牌阶段：点击手牌打出（需选目标的卡会高亮敌方），或跳过出牌。
    </p>
    <p v-if="previewNotice" class="notice">{{ previewNotice }}</p>
    <p v-if="!previewMode && game.lastError" class="error-msg">{{ game.lastError }}</p>

    <!-- T070 手牌区: 每个 own 角色一组, 当前行动者高亮 -->
    <div v-if="displayBoard && handGroups.length" class="hand-section panel">
      <div class="hand-head">
        <h3 class="section-title">手牌</h3>
        <button v-if="canPlayCards" type="button" class="secondary small" @click="onSkipPlay">跳过出牌</button>
      </div>
      <BattleHand
        v-for="g in handGroups"
        :key="g.characterId"
        :hand="g.cards"
        :character-id="g.characterId"
        :character-name="g.name"
        :profession="g.profession"
        :is-current-actor="g.isCurrentActor"
        :is-play-phase="isPlayPhase"
        :current-energy="g.energy"
        :selected-card-deck-id="selectedCardDeckId"
        @card-click="onCardClick"
      />
    </div>

    <div v-else-if="!displayBoard" class="panel mt">
      <p class="dim">未在对战中。匹配队列界面待 T077 实现。</p>
    </div>

    <div class="mt actions">
      <button
        v-if="!game.board"
        class="secondary"
        @click="previewMode = !previewMode"
      >
        {{ previewMode ? '退出预览' : '预览棋盘' }}
      </button>
      <button
        v-if="previewMode"
        class="secondary"
        @click="togglePreviewPhase"
      >
        {{ previewPhase === 'play' ? '切到移动阶段' : '切到出牌阶段' }}
      </button>
      <span v-if="previewMode" class="dim preview-note">预览模式 (mock 数据, T073 接入 WS 后移除)</span>
    </div>
  </div>
</template>

<style scoped>
.battle-view { max-width: 560px; }
.actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.preview-note { font-size: 12px; }
.hand-section { margin-top: 12px; display: flex; flex-direction: column; gap: 10px; }
.hand-head { display: flex; align-items: center; justify-content: space-between; }
.section-title { margin: 0; font-size: 15px; }
.small { font-size: 12px; padding: 3px 10px; }
.hint { font-size: 12px; margin: 6px 2px; }
.notice { font-size: 12px; color: var(--accent); margin: 6px 2px; }
.error-msg { font-size: 12px; color: var(--danger); margin: 6px 2px; }
</style>
