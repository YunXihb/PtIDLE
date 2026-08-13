<script setup lang="ts">
// T068 战棋对战界面 -- 棋盘渲染 + T069 棋子渲染
// 实时棋盘状态来自 game store (WS 推送, T073 接入); WS 未接前用预览 mock 验证渲染
// 后续 T070(手牌)/T071(移动)/T072(打牌)/T073(WS)/T077(匹配) 在此扩展
import { ref, computed } from 'vue';
import { useGameStore } from '@/stores/game';
import BattleBoard from '@/components/BattleBoard.vue';
import type { BoardStateEvent, CharacterStatus } from '@/types';

const game = useGameStore();

// 开发预览: WS(T073) 未接前用 mock BoardStateEvent 验证棋盘+棋子渲染, T073 落地后移除
const previewMode = ref(false);

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

const mockBoard: BoardStateEvent = {
  battleId: 'preview',
  currentRound: 1,
  currentStep: 1,
  currentPhase: 'move',
  currentActorId: mockOwnWarrior.characterId,
  characters: [mockOwnWarrior, mockOwnRanger, mockOwnMage, mockEnemyWarrior, mockEnemyRanger, mockEnemyMage],
  p1Stars: 0,
  p2Stars: 0,
  bases: { '2,2': 'p1', '6,6': 'p2' },
};
const displayBoard = computed<BoardStateEvent | null>(() =>
  previewMode.value ? mockBoard : game.board,
);
// 预览模式用 mockOwnIds, 实战用 game store myCharacterIds
const ownIds = computed<string[]>(() => (previewMode.value ? mockOwnIds : game.myCharacterIds));

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

    <div v-else class="panel mt">
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
      <span v-if="previewMode" class="dim preview-note">预览模式 (mock 数据, T073 接入 WS 后移除)</span>
    </div>
  </div>
</template>

<style scoped>
.battle-view { max-width: 560px; }
.actions { display: flex; align-items: center; gap: 12px; }
.preview-note { font-size: 12px; }
</style>
