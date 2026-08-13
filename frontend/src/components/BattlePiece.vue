<script setup lang="ts">
// T069 棋子渲染 -- 棋盘上单个棋子 (presentational)
// 显示: 职业字 + 血量条(含护盾) + 能量 pips + 状态效果点 + 当前行动者高亮 + 敌我边框
// 敌我区分: CharacterStatus 无 side 字段, 由父级据 myCharacterIds 传 isOwn
// 职业色: --warrior(红)/--ranger(绿)/--mage(紫); 敌我边框 own=accent(蓝) enemy=danger(红)
import { computed } from 'vue';
import type { CharacterStatus, StatusEffect } from '@/types';

const props = defineProps<{
  character: CharacterStatus;
  isOwn: boolean;
  isCurrentActor: boolean;
}>();
const emit = defineEmits<{ (e: 'click'): void }>();

// 职业单字 + 中文名
const PROFESSION_GLYPH: Record<CharacterStatus['profession'], string> = {
  warrior: '战',
  ranger: '弓',
  mage: '法',
};

// 血量比例 -> 颜色档
const hpRatio = computed(() => {
  const max = props.character.maxHealth || 1;
  return Math.max(0, Math.min(1, props.character.health / max));
});
const hpColorClass = computed(() => {
  if (hpRatio.value > 0.5) return 'hp-green';
  if (hpRatio.value > 0.25) return 'hp-yellow';
  return 'hp-red';
});

// 护盾条宽度 (相对 maxHealth, 与血量段拼接, 总宽上限 100%)
const hpPct = computed(() => `${hpRatio.value * 100}%`);
const shieldPct = computed(() => {
  const max = props.character.maxHealth || 1;
  const shield = Math.max(0, props.character.totalShield);
  // 护盾段从血量段右沿延伸, 总宽不超过 100%
  const remaining = Math.max(0, 1 - hpRatio.value);
  return `${Math.min(shield / max, remaining) * 100}%`;
});
const hasShield = computed(() => props.character.totalShield > 0);

// 能量 pips
const energyPips = computed(() => {
  const max = props.character.maxEnergy || 0;
  const cur = Math.max(0, Math.min(max, props.character.energy));
  return Array.from({ length: max }, (_, i) => i < cur);
});

// 状态效果点 (排除 shield -- 已由 totalShield 渲染; taunt 由 isTaunted 渲染)
const EFFECT_META: Record<string, { cls: string; label: string }> = {
  damage_boost: { cls: 'fx-boost', label: '增伤' },
  mark_fire: { cls: 'fx-mark', label: '火标' },
  burn: { cls: 'fx-burn', label: '燃烧' },
};
const effectDots = computed(() => {
  const seen = new Set<string>();
  const dots: { cls: string; label: string }[] = [];
  for (const e of props.character.effects as StatusEffect[]) {
    const meta = EFFECT_META[e.type];
    if (meta && !seen.has(e.type)) {
      seen.add(e.type);
      dots.push(meta);
    }
  }
  if (props.character.isTaunted && !seen.has('taunt')) {
    dots.push({ cls: 'fx-taunt', label: '被嘲讽' });
  }
  return dots;
});

const titleText = computed(() => {
  const c = props.character;
  const side = props.isOwn ? '我方' : '敌方';
  return `${side} ${c.name} (${PROFESSION_GLYPH[c.profession]}) HP ${c.health}/${c.maxHealth}${hasShield.value ? ` 🛡${c.totalShield}` : ''} 能量 ${c.energy}/${c.maxEnergy}`;
});

function onClick() {
  emit('click');
}
</script>

<template>
  <div
    class="piece"
    :class="[`prof-${character.profession}`, { own: isOwn, enemy: !isOwn, actor: isCurrentActor }]"
    :title="titleText"
    @click.stop="onClick"
  >
    <!-- 职业字 -->
    <span class="glyph">{{ PROFESSION_GLYPH[character.profession] }}</span>

    <!-- 护盾徽章 -->
    <span v-if="hasShield" class="shield-badge">🛡{{ character.totalShield }}</span>

    <!-- 当前行动者标记 -->
    <span v-if="isCurrentActor" class="actor-mark" title="当前行动">▶</span>

    <!-- 血量条 (血量段 + 护盾段) -->
    <div class="hp-bar">
      <div class="hp-fill" :class="hpColorClass" :style="{ width: hpPct }"></div>
      <div v-if="hasShield" class="shield-fill" :style="{ width: shieldPct }"></div>
    </div>

    <!-- 血量数字 -->
    <span class="hp-text">{{ character.health }}/{{ character.maxHealth }}</span>

    <!-- 能量 pips -->
    <div v-if="energyPips.length" class="energy">
      <span v-for="(on, i) in energyPips" :key="i" class="pip" :class="{ on }"></span>
    </div>

    <!-- 状态效果点 -->
    <div v-if="effectDots.length" class="effects">
      <span
        v-for="(d, i) in effectDots"
        :key="i"
        :class="['fx-dot', d.cls]"
        :title="d.label"
      ></span>
    </div>
  </div>
</template>

<style scoped>
.piece {
  position: relative;
  width: 92%;
  aspect-ratio: 1 / 1.18;
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  cursor: pointer;
  border: 2px solid var(--border);
  background: color-mix(in srgb, var(--prof-color) 22%, var(--bg-panel));
  --prof-color: var(--text-dim);
  transition: transform 0.1s, box-shadow 0.1s;
  user-select: none;
}
.piece.prof-warrior { --prof-color: var(--warrior); }
.piece.prof-ranger { --prof-color: var(--ranger); }
.piece.prof-mage { --prof-color: var(--mage); }

.piece.own { border-color: var(--accent); }
.piece.enemy { border-color: var(--danger); }
.piece:hover { transform: scale(1.05); }

/* 当前行动者: 发光环 */
.piece.actor {
  box-shadow: 0 0 0 2px var(--accent), 0 0 8px 2px var(--accent);
  z-index: 2;
}
.piece.enemy.actor {
  box-shadow: 0 0 0 2px var(--danger), 0 0 8px 2px var(--danger);
}

.glyph {
  font-size: 17px;
  font-weight: 700;
  line-height: 1;
  color: var(--prof-color);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
}

/* 护盾徽章: 右上角 */
.shield-badge {
  position: absolute;
  top: 1px;
  right: 2px;
  font-size: 9px;
  line-height: 1;
  color: var(--accent);
  background: rgba(0, 0, 0, 0.45);
  border-radius: 3px;
  padding: 1px 2px;
}

/* 当前行动者标记: 左上角 */
.actor-mark {
  position: absolute;
  top: 1px;
  left: 2px;
  font-size: 8px;
  line-height: 1;
  color: var(--accent);
}
.piece.enemy.actor .actor-mark { color: var(--danger); }

/* 血量条 */
.hp-bar {
  width: 86%;
  height: 4px;
  background: rgba(0, 0, 0, 0.5);
  border-radius: 2px;
  overflow: hidden;
  display: flex;
}
.hp-fill { height: 100%; transition: width 0.2s; }
.hp-fill.hp-green { background: var(--success); }
.hp-fill.hp-yellow { background: #d8b53e; }
.hp-fill.hp-red { background: var(--danger); }
.shield-fill { height: 100%; background: var(--accent); opacity: 0.85; }

.hp-text {
  font-size: 9px;
  line-height: 1;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}

/* 能量 pips */
.energy { display: flex; gap: 2px; }
.pip {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--border);
}
.pip.on { background: var(--accent); }

/* 状态效果点 */
.effects { display: flex; gap: 2px; position: absolute; bottom: 1px; }
.fx-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  border: 1px solid rgba(0, 0, 0, 0.4);
}
.fx-boost { background: #d8b53e; }
.fx-mark { background: var(--mage); }
.fx-burn { background: var(--danger); }
.fx-taunt { background: #e88c2a; }
</style>
