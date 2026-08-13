<script setup lang="ts">
// T070 手牌渲染 -- 单个角色的手牌区 (presentational)
// 显示: 角色头标(职业字+名+能量) + 手牌卡牌横排
// 卡牌: 类型色边框 + 费用徽章(能量) + 效果摘要 + 来源徽章(deck|public_pool)
// 可出牌判定: isCurrentActor && isPlayPhase && cost<=currentEnergy; 否则 dim 且不可点击
// 点击 emit card-click {characterId, card} 供 T072(打牌交互) 接入目标选择 + WS
import { computed } from 'vue';
import type { HandCard, CardType } from '@/types';
import { CARD_TYPE_META, effectSummary, cardSupported } from '@/utils/cards';

const props = defineProps<{
  hand: HandCard[];
  characterId: string;
  characterName?: string;
  profession?: 'warrior' | 'ranger' | 'mage';
  isCurrentActor: boolean;
  isPlayPhase: boolean;
  currentEnergy: number;
  /** T072: 当前待选目标的卡牌 deck_id (高亮选中态) */
  selectedCardDeckId?: string | null;
}>();
const emit = defineEmits<{
  (e: 'card-click', payload: { characterId: string; card: HandCard }): void;
}>();

const PROFESSION_GLYPH: Record<string, string> = {
  warrior: '战',
  ranger: '弓',
  mage: '法',
};

const headerText = computed(() => {
  const glyph = props.profession ? PROFESSION_GLYPH[props.profession] : '?';
  const name = props.characterName ?? props.characterId;
  return `${glyph} ${name}`;
});

// 整组手牌是否可操作(当前 actor + 出牌阶段); 否则全 dim
const groupActive = computed(() => props.isCurrentActor && props.isPlayPhase);

// T072: 后端 T050 不支持的卡(defense/heal/movement)不可出
function isUnsupported(card: HandCard): boolean {
  return !cardSupported(card);
}

function canPlay(card: HandCard): boolean {
  return groupActive.value && card.cost <= props.currentEnergy && !isUnsupported(card);
}

function cardTypeClass(t: CardType): string {
  return `type-${t}`;
}

function onClick(card: HandCard) {
  if (!canPlay(card)) return;
  emit('card-click', { characterId: props.characterId, card });
}

function sourceLabel(card: HandCard): string {
  return card.source === 'public_pool' ? '公共池' : '牌库';
}
</script>

<template>
  <div class="hand-group" :class="{ active: groupActive, dim: !groupActive }">
    <!-- 角色头标 -->
    <div class="hand-header">
      <span class="name">{{ headerText }}</span>
      <span class="energy">能量 {{ currentEnergy }}</span>
      <span v-if="groupActive" class="turn-tag">行动中</span>
    </div>

    <!-- 手牌卡牌横排 -->
    <div v-if="hand.length" class="cards">
      <button
        v-for="card in hand"
        :key="card.deck_id"
        type="button"
        class="card"
        :class="[cardTypeClass(card.type), { playable: canPlay(card), unaffordable: groupActive && !isUnsupported(card) && !canPlay(card), unsupported: isUnsupported(card), selected: selectedCardDeckId === card.deck_id }]"
        :disabled="!canPlay(card)"
        :title="`${card.name} · ${CARD_TYPE_META[card.type].label} · 费用 ${card.cost}${isUnsupported(card) ? ' · 暂不可用' : ''}`"
        @click="onClick(card)"
      >
        <!-- 费用徽章 -->
        <span class="cost">⚡{{ card.cost }}</span>
        <!-- 来源徽章 -->
        <span class="source" :class="{ pool: card.source === 'public_pool' }">{{ sourceLabel(card) }}</span>
        <!-- 卡名 -->
        <span class="card-name">{{ card.name }}</span>
        <!-- 类型标签 -->
        <span class="type-tag" :class="cardTypeClass(card.type)">{{ CARD_TYPE_META[card.type].label }}</span>
        <!-- 效果摘要 -->
        <span class="effect">{{ effectSummary(card.effect) }}</span>
        <!-- T072 暂不可用标记 -->
        <span v-if="isUnsupported(card)" class="unsupported-tag">暂不可用</span>
      </button>
    </div>

    <p v-else class="empty dim">无手牌</p>
  </div>
</template>

<style scoped>
.hand-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-panel-2);
  transition: border-color 0.15s, box-shadow 0.15s;
}
/* 当前行动者的手牌组高亮 */
.hand-group.active {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent), 0 0 8px 1px color-mix(in srgb, var(--accent) 40%, transparent);
}
.hand-group.dim { opacity: 0.55; }

.hand-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.hand-header .name { font-weight: 600; }
.hand-header .energy {
  font-size: 12px;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}
.turn-tag {
  margin-left: auto;
  font-size: 11px;
  color: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 4px;
  padding: 1px 6px;
}

/* 卡牌横排 */
.cards {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 2px;
}
.card {
  position: relative;
  flex: 0 0 auto;
  width: 96px;
  min-height: 118px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 18px 6px 8px;
  border-radius: 8px;
  border: 2px solid var(--border);
  background: color-mix(in srgb, var(--type-color) 18%, var(--bg-panel));
  --type-color: var(--text-dim);
  cursor: pointer;
  transition: transform 0.1s, box-shadow 0.1s;
  font: inherit;
  color: inherit;
  text-align: center;
  user-select: none;
}
.card.type-attack { --type-color: var(--danger); }
.card.type-defense { --type-color: var(--accent); }
.card.type-tactical { --type-color: var(--success); }

.card.playable:hover {
  transform: translateY(-3px);
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.4);
}
.card.unaffordable {
  opacity: 0.5;
  cursor: not-allowed;
}
/* T072: 后端暂不支持的卡 */
.card.unsupported {
  opacity: 0.45;
  cursor: not-allowed;
  filter: grayscale(0.6);
}
/* T072: 选中(待选目标) */
.card.selected {
  border-color: var(--warning);
  box-shadow: 0 0 0 2px var(--warning), 0 0 10px 2px color-mix(in srgb, var(--warning) 50%, transparent);
  transform: translateY(-3px);
}
.card:disabled { cursor: not-allowed; }

/* 暂不可用标记 */
.unsupported-tag {
  position: absolute;
  bottom: 3px;
  font-size: 9px;
  line-height: 1;
  color: var(--text-dim);
  background: rgba(0, 0, 0, 0.5);
  border-radius: 3px;
  padding: 1px 4px;
}

/* 费用徽章: 左上角 */
.cost {
  position: absolute;
  top: 3px;
  left: 4px;
  font-size: 11px;
  line-height: 1;
  color: var(--accent);
  background: rgba(0, 0, 0, 0.5);
  border-radius: 4px;
  padding: 2px 4px;
  font-variant-numeric: tabular-nums;
}
/* 来源徽章: 右上角 */
.source {
  position: absolute;
  top: 3px;
  right: 4px;
  font-size: 9px;
  line-height: 1;
  color: var(--text-dim);
  background: rgba(0, 0, 0, 0.4);
  border-radius: 3px;
  padding: 2px 3px;
}
.source.pool { color: var(--warning); }

.card-name {
  font-size: 14px;
  font-weight: 700;
  line-height: 1.1;
  color: var(--type-color);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
}

.type-tag {
  font-size: 10px;
  line-height: 1;
  border-radius: 3px;
  padding: 1px 5px;
  color: var(--bg-panel);
  background: var(--type-color);
}

.effect {
  font-size: 11px;
  line-height: 1.2;
  color: var(--text-dim);
  margin-top: 2px;
}

.empty { font-size: 12px; margin: 4px 0; }
</style>
