<script setup lang="ts">
// T068 战棋对战界面 -- 棋盘渲染
// 实时棋盘状态来自 game store (WS 推送, T073 接入); WS 未接前用预览 mock 验证渲染
// 后续 T069(棋子)/T070(手牌)/T071(移动)/T072(打牌)/T073(WS)/T077(匹配) 在此扩展
import { ref, computed } from 'vue';
import { useGameStore } from '@/stores/game';
import BattleBoard from '@/components/BattleBoard.vue';
import type { BoardStateEvent } from '@/types';

const game = useGameStore();

// 开发预览: WS(T073) 未接前用 mock BoardStateEvent 验证棋盘渲染, T073 落地后移除
const previewMode = ref(false);
const mockBoard: BoardStateEvent = {
  battleId: 'preview',
  currentRound: 1,
  currentStep: 1,
  currentPhase: 'move',
  currentActorId: null,
  characters: [],
  p1Stars: 0,
  p2Stars: 0,
  bases: { '3,3': 'p1', '6,6': 'p2' },
};
const displayBoard = computed<BoardStateEvent | null>(() =>
  previewMode.value ? mockBoard : game.board,
);

function onCellClick(p: { x: number; y: number }) {
  // T071 移动交互将接入: 点击格子移动选中棋子
  // eslint-disable-next-line no-console
  console.log('[T068] cell click', p);
}
</script>

<template>
  <div class="battle-view">
    <h2>对战</h2>

    <BattleBoard v-if="displayBoard" :board="displayBoard" @cell-click="onCellClick" />

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
