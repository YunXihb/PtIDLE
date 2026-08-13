<script setup lang="ts">
// T068 战棋对战界面 -- 棋盘渲染 + T069 棋子渲染 + T070 手牌渲染
// 实时棋盘状态来自 game store (WS 推送, T073 接入); WS 未接前用预览 mock 验证渲染
// 后续 T071(移动)/T072(打牌交互)/T073(WS)/T077(匹配) 在此扩展
import { ref, computed } from 'vue';
import { useGameStore } from '@/stores/game';
import BattleBoard from '@/components/BattleBoard.vue';
import BattleHand from '@/components/BattleHand.vue';
import type { BoardStateEvent, CharacterStatus, BattlePhase, HandCard } from '@/types';

const game = useGameStore();

// 开发预览: WS(T073) 未接前用 mock BoardStateEvent + ownHand 验证棋盘+棋子+手牌渲染, T073 落地后移除
const previewMode = ref(false);
// 预览阶段切换: move(默认, 对齐 T068/T069) / play(验证手牌可点击态)
const previewPhase = ref<BattlePhase>('move');

// mock 棋子: own 3 (P1 底 y=0 默认位) + enemy 3 (P2 顶 y=8 默认位)
// 含一受损(ranger 3/8) + 一护盾(warrior 🛡2) + 当前行动者=own warrior, 验证各渲染分支
const mockOwnWarrior: CharacterStatus = {
  characterId: 'ow', name: '我的战士', profession: 'warrior',
  health: 12, maxHealth: 12, energy: 1, maxEnergy: 3,
  position: { x: 6, y: 0 }, isAlive: true,
  effects: [], totalShield: 2, isTaunted: false, taunting: [],
};
const mockOwnRanger: CharacterStatus = {
  characterId: 'or', name: '我的弓手', profession: 'ranger',
  health: 8, maxHealth: 8, energy: 2, maxEnergy: 3,
  position: { x: 7, y: 0 }, isAlive: true,
  effects: [], totalShield: 0, isTaunted: false, taunting: [],
};
const mockOwnMage: CharacterStatus = {
  characterId: 'om', name: '我的法师', profession: 'mage',
  health: 6, maxHealth: 6, energy: 3, maxEnergy: 3,
  position: { x: 8, y: 0 }, isAlive: true,
  effects: [], totalShield: 0, isTaunted: false, taunting: [],
};
const mockEnemyWarrior: CharacterStatus = {
  characterId: 'ew', name: '敌方战士', profession: 'warrior',
  health: 10, maxHealth: 12, energy: 1, maxEnergy: 3,
  position: { x: 0, y: 8 }, isAlive: true,
  effects: [], totalShield: 0, isTaunted: true, taunting: [],
};
const mockEnemyRanger: CharacterStatus = {
  characterId: 'er', name: '敌方弓手', profession: 'ranger',
  health: 3, maxHealth: 8, energy: 0, maxEnergy: 3,
  position: { x: 1, y: 8 }, isAlive: true,
  effects: [{ type: 'burn', value: 1, duration_rounds: 2, expire_round: 999, created_round: 1, effect_id: 'e1' }],
  totalShield: 0, isTaunted: false, taunting: [],
};
const mockEnemyMage: CharacterStatus = {
  characterId: 'em', name: '敌方法师', profession: 'mage',
  health: 6, maxHealth: 6, energy: 2, maxEnergy: 3,
  position: { x: 2, y: 8 }, isAlive: true,
  effects: [{ type: 'mark_fire', duration_rounds: 99999, expire_round: 99999, created_round: 1, effect_id: 'e2' }],
  totalShield: 0, isTaunted: false, taunting: [],
};
const mockOwnIds = [mockOwnWarrior.characterId, mockOwnRanger.characterId, mockOwnMage.characterId];

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
  currentActorId: mockOwnWarrior.characterId,
  characters: [mockOwnWarrior, mockOwnRanger, mockOwnMage, mockEnemyWarrior, mockEnemyRanger, mockEnemyMage],
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

function onCellClick(p: { x: number; y: number }) {
  // T071 移动交互将接入: 点击格子移动选中棋子
  // eslint-disable-next-line no-console
  console.log('[T068] cell click', p);
}
function onPieceClick(p: { characterId: string; x: number; y: number }) {
  // T071 移动交互将接入: 点击棋子选中, 显示可移动范围
  // eslint-disable-next-line no-console
  console.log('[T069] piece click', p);
}
function onCardClick(p: { characterId: string; card: HandCard }) {
  // T072 打牌交互将接入: 选目标 -> game.playCard(characterId, card, targetId)
  // eslint-disable-next-line no-console
  console.log('[T070] card click', p.characterId, p.card.name);
}

function togglePreviewPhase() {
  previewPhase.value = previewPhase.value === 'play' ? 'move' : 'play';
}
</script>

<template>
  <div class="battle-view">
    <h2>对战</h2>

    <BattleBoard
      v-if="displayBoard"
      :board="displayBoard"
      :own-character-ids="ownIds"
      @cell-click="onCellClick"
      @piece-click="onPieceClick"
    />

    <!-- T070 手牌区: 每个 own 角色一组, 当前行动者高亮 -->
    <div v-if="displayBoard && handGroups.length" class="hand-section panel">
      <h3 class="section-title">手牌</h3>
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
.section-title { margin: 0; font-size: 15px; }
</style>
