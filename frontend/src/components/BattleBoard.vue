<script setup lang="ts">
// T068 棋盘渲染 + T069 棋子渲染 -- 9x9 战棋棋盘 (presentational)
// 坐标约定: key "x,y", x=0..8 (左->右), y=0..8 (底->顶)
// P1 侧 y=0 (底), P2 侧 y=8 (顶); 基地 (2,2)=P1 侧 / (6,6)=P2 侧, 关于中心 (4,4) 对称, 初始 neutral
// 渲染: 行从上到下 = y 8->0, 列从左到右 = x 0->8
// 渲染技术选 CSS Grid (非 Canvas/SVG): 离散格子 + 后续点击交互(T071) + 主题一致
// T069: 格子内渲染 BattlePiece (alive+有位置的棋子), 敌我靠 ownCharacterIds 区分
import { computed } from 'vue';
import type { BoardStateEvent, CharacterStatus, Side } from '@/types';
import BattlePiece from './BattlePiece.vue';

const props = defineProps<{
  board: BoardStateEvent;
  /** 自己的 characterId 列表 (来自 game store myCharacterIds), 用于区分敌我染色 */
  ownCharacterIds?: string[];
  /** 当前选中(待移动)的棋子 id, 用于高亮 */
  selectedCharacterId?: string | null;
  /** 可移动格 "x,y" key 集合, 用于高亮(T071) */
  movableCells?: Set<string>;
  /** T072: 可选为打牌目标的 characterId 集合, 用于高亮 */
  targetableCharacterIds?: Set<string>;
}>();
const emit = defineEmits<{
  (e: 'cell-click', payload: { x: number; y: number }): void;
  (e: 'piece-click', payload: { characterId: string; x: number; y: number }): void;
}>();

const ownSet = computed<Set<string>>(() => new Set(props.ownCharacterIds ?? []));
const movableSet = computed<Set<string>>(() => props.movableCells ?? new Set());
const targetableSet = computed<Set<string>>(() => props.targetableCharacterIds ?? new Set());

// 位置 -> 棋子 映射 (仅 alive 且有位置)
const pieceMap = computed<Map<string, CharacterStatus>>(() => {
  const m = new Map<string, CharacterStatus>();
  for (const c of props.board.characters) {
    if (c.isAlive && c.position) {
      m.set(`${c.position.x},${c.position.y}`, c);
    }
  }
  return m;
});
function pieceAt(x: number, y: number): CharacterStatus | undefined {
  return pieceMap.value.get(`${x},${y}`);
}
function onPieceClick(c: CharacterStatus) {
  if (c.position) emit('piece-click', { characterId: c.characterId, x: c.position.x, y: c.position.y });
}

const BOARD_SIZE = 9;

// 行序列 (上->下 = y 8->0)
const rows = computed(() => {
  const r: number[] = [];
  for (let y = BOARD_SIZE - 1; y >= 0; y--) r.push(y);
  return r;
});
// 列序列 (左->右 = x 0->8)
const cols = computed(() => {
  const c: number[] = [];
  for (let x = 0; x < BOARD_SIZE; x++) c.push(x);
  return c;
});

const PHASE_LABELS: Record<string, string> = {
  idle: '待机',
  draw: '抽牌',
  move: '移动',
  play: '出牌',
  end_step: '步骤结束',
  end_round: '回合结束',
  finished: '已结束',
};
function phaseLabel(p: string): string {
  return PHASE_LABELS[p] ?? p;
}

function isBase(x: number, y: number): boolean {
  return (x === 2 && y === 2) || (x === 6 && y === 6);
}
function baseSideAt(x: number, y: number): Side | 'neutral' | null {
  const key = `${x},${y}`;
  if (key === '2,2') return props.board.bases['2,2'];
  if (key === '6,6') return props.board.bases['6,6'];
  return null;
}
function cellClass(x: number, y: number): string {
  const cls = ['cell'];
  const side = baseSideAt(x, y);
  if (side === 'p1') cls.push('base-p1');
  else if (side === 'p2') cls.push('base-p2');
  else if (isBase(x, y)) cls.push('base-neutral');
  if (movableSet.value.has(`${x},${y}`)) cls.push('movable');
  return cls.join(' ');
}

function onClick(x: number, y: number) {
  emit('cell-click', { x, y });
}
</script>

<template>
  <div class="board-panel panel">
    <!-- 状态条: 回合/步骤/阶段/星数 -->
    <div class="state-bar">
      <span class="badge">第 {{ board.currentRound }} 回合</span>
      <span class="badge">步骤 {{ board.currentStep }}</span>
      <span class="badge phase">{{ phaseLabel(board.currentPhase) }}</span>
      <span class="stars">
        <span class="side-p1">P1 ★{{ board.p1Stars }}</span>
        <span class="sep">:</span>
        <span class="side-p2">★{{ board.p2Stars }} P2</span>
      </span>
    </div>

    <!-- 棋盘 + 坐标轴 -->
    <div class="board-wrap">
      <!-- 左上角空 + y 轴标签列 -->
      <div class="corner"></div>
      <div class="axis y-axis">
        <div v-for="y in rows" :key="y" class="axis-label">{{ y }}</div>
      </div>

      <!-- 棋盘主体 + 下方 x 轴 -->
      <div class="board-grid" :style="{ gridTemplateColumns: `repeat(${BOARD_SIZE}, 1fr)` }">
        <template v-for="y in rows" :key="`row-${y}`">
          <div
            v-for="x in cols"
            :key="`${x},${y}`"
            :class="cellClass(x, y)"
            @click="onClick(x, y)"
          >
            <span v-if="isBase(x, y) && !pieceAt(x, y)" class="base-mark" :title="`基地 ${x},${y}`">★</span>
            <BattlePiece
              v-if="pieceAt(x, y)"
              :character="pieceAt(x, y)!"
              :is-own="ownSet.has(pieceAt(x, y)!.characterId)"
              :is-current-actor="board.currentActorId === pieceAt(x, y)!.characterId"
              :is-selected="selectedCharacterId === pieceAt(x, y)!.characterId"
              :is-targetable="targetableSet.has(pieceAt(x, y)!.characterId)"
              @click="onPieceClick(pieceAt(x, y)!)"
            />
          </div>
        </template>
      </div>
      <div class="axis x-axis" :style="{ gridTemplateColumns: `repeat(${BOARD_SIZE}, 1fr)` }">
        <div v-for="x in cols" :key="x" class="axis-label">{{ x }}</div>
      </div>
    </div>

    <p class="dim legend">
      <span class="dot base-p1"></span> P1 基地
      <span class="dot base-p2"></span> P2 基地
      <span class="dot base-neutral"></span> 中立基地
    </p>
  </div>
</template>

<style scoped>
.board-panel { display: flex; flex-direction: column; gap: 12px; }

.state-bar {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
}
.badge {
  background: var(--bg-panel-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 3px 10px;
  font-size: 13px;
  color: var(--text-dim);
}
.badge.phase { color: var(--accent); border-color: var(--accent); }
.stars { margin-left: auto; font-weight: 600; }
.side-p1 { color: var(--accent); }
.side-p2 { color: var(--danger); }
.sep { color: var(--text-dim); margin: 0 6px; }

/* 棋盘布局:
   col1(y轴标签)  col2(棋盘)
   [y-axis]       [board]
   [corner空]     [x-axis]   */
.board-wrap {
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-rows: 1fr auto;
  gap: 4px;
  align-self: center;
  width: 100%;
  max-width: 480px;
}
.corner { grid-row: 2; grid-column: 1; width: 20px; }

.axis { display: grid; gap: 2px; }
.y-axis {
  grid-row: 1; grid-column: 1;
  grid-template-rows: repeat(9, 1fr);
}
.x-axis {
  grid-row: 2; grid-column: 2;
}
.axis-label {
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; color: var(--text-dim);
  min-height: 20px;
}

/* 棋盘网格 */
.board-grid {
  grid-row: 1; grid-column: 2;
  display: grid;
  aspect-ratio: 1 / 1;
  gap: 2px;
  background: var(--border);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 2px;
}
.cell {
  position: relative;
  background: var(--bg-panel-2);
  border-radius: 3px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  transition: background 0.12s;
  min-height: 0; min-width: 0;
}
.cell:hover { background: var(--border); }

/* T071 可移动格高亮 */
.cell.movable {
  background: color-mix(in srgb, var(--success) 30%, var(--bg-panel-2));
  box-shadow: inset 0 0 0 2px var(--success);
  cursor: pointer;
}
.cell.movable:hover {
  background: color-mix(in srgb, var(--success) 50%, var(--bg-panel-2));
}
/* 可移动格上的中心点提示(无棋子时) */
.cell.movable::after {
  content: '';
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--success);
  opacity: 0.7;
  pointer-events: none;
}

/* 基地格子 */
.cell.base-neutral { background: var(--bg-panel); border: 1px dashed var(--text-dim); }
.cell.base-p1 { background: color-mix(in srgb, var(--accent) 35%, var(--bg-panel-2)); border: 1px solid var(--accent); }
.cell.base-p2 { background: color-mix(in srgb, var(--danger) 35%, var(--bg-panel-2)); border: 1px solid var(--danger); }
.base-mark { font-size: 16px; line-height: 1; }
.cell.base-p1 .base-mark { color: var(--accent); }
.cell.base-p2 .base-mark { color: var(--danger); }
.cell.base-neutral .base-mark { color: var(--text-dim); }

.legend { display: flex; align-items: center; gap: 10px; font-size: 12px; flex-wrap: wrap; }
.dot { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 2px; vertical-align: middle; }
.dot.base-p1 { background: var(--accent); }
.dot.base-p2 { background: var(--danger); }
.dot.base-neutral { background: var(--bg-panel); border: 1px dashed var(--text-dim); }
</style>
