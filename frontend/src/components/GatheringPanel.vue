<script setup lang="ts">
import { onMounted, onUnmounted, computed, ref } from 'vue';
import { useGatheringStore } from '@/stores/gathering';
import { usePlayerStore } from '@/stores/player';
import { resourceName } from '@/utils/resources';
import type { SkillType, GatheringEfficiency } from '@/types';

const store = useGatheringStore();
const player = usePlayerStore();

// 采集技能中文名
const skillName: Record<SkillType, string> = {
  mining: '采矿',
  woodcutting: '伐木',
  herbalism: '草药学',
};

// 临时通知（领取/自动完成提示）
const notice = ref<string | null>(null);
let noticeTimer: number | null = null;
function showNotice(msg: string) {
  notice.value = msg;
  if (noticeTimer !== null) clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => { notice.value = null; }, 4000);
}

// 轮询
let pollTimer: number | null = null;
function startPolling() {
  stopPolling();
  pollTimer = window.setInterval(async () => {
    const wasActive = !!store.activeTask;
    try {
      await store.fetchStatus();
    } catch {
      return; // 网络抖动等：静默，下个 tick 重试
    }
    // 活跃任务被后端定时器自动完成 -> status 变 null
    if (wasActive && !store.activeTask) {
      stopPolling();
      await player.fetchProfile();
      showNotice('采集已完成，资源已入账');
    }
  }, 2000);
}
function stopPolling() {
  if (pollTimer !== null) { clearInterval(pollTimer); pollTimer = null; }
}

const progressPct = computed(() =>
  Math.min(100, Math.floor((store.activeTask?.progress ?? 0) * 100))
);
const isDue = computed(() => (store.activeTask?.progress ?? 0) >= 1);

function effOf(type: SkillType): GatheringEfficiency | undefined {
  return store.efficiency.find((e) => e.skillType === type);
}
function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

async function onStart(type: SkillType) {
  await store.start(type);
  if (store.activeTask) startPolling();
}

async function onComplete() {
  const result = await store.complete();
  stopPolling();
  if (result?.result) {
    const gained = Object.entries(result.result.resources)
      .map(([k, v]) => `${resourceName(k)} +${v}`)
      .join('，');
    const overflow = Object.entries(result.result.overflowed)
      .map(([k, v]) => `${resourceName(k)} 溢出 ${v}`)
      .join('，');
    showNotice(overflow ? `获得 ${gained}（${overflow}）` : `获得 ${gained}`);
  } else {
    // 已被定时器自动完成
    showNotice('采集已完成，资源已入账');
  }
}

async function onCancel() {
  await store.cancel();
  stopPolling();
}

onMounted(async () => {
  await store.loadAll();
  if (store.activeTask) startPolling();
});
onUnmounted(() => {
  stopPolling();
  if (noticeTimer !== null) clearTimeout(noticeTimer);
});
</script>

<template>
  <div class="gathering">
    <div v-if="store.loading" class="dim">加载中...</div>

    <template v-else>
      <div v-if="store.error" class="error-banner">{{ store.error }}</div>
      <div v-if="notice" class="notice">{{ notice }}</div>

      <!-- 有活跃任务 -->
      <div v-if="store.activeTask" class="panel active-task">
        <div class="task-head">
          <h3>{{ skillName[store.activeTask.skillType] }} · 采集中</h3>
          <span class="dim">{{ store.activeTask.elapsedSeconds ?? 0 }}/{{ store.activeTask.duration }}秒</span>
        </div>
        <div class="progress">
          <div class="progress-bar" :style="{ width: progressPct + '%' }"></div>
        </div>
        <p v-if="isDue" class="due">已可领取</p>
        <div class="row">
          <button v-if="isDue" :disabled="store.actionLoading" @click="onComplete">领取收获</button>
          <button class="secondary" :disabled="store.actionLoading" @click="onCancel">取消采集</button>
        </div>
      </div>

      <!-- 无活跃任务：技能列表 -->
      <div v-else>
        <div class="grid">
          <div v-for="skill in store.skills" :key="skill.id" class="panel skill-card">
            <h3>{{ skillName[skill.type] ?? skill.name }}</h3>
            <div class="kv">
              <div v-for="(rate, res) in skill.yields" :key="res" class="kv-row">
                <span>{{ resourceName(String(res)) }}</span>
                <span class="dim">×{{ rate }}</span>
              </div>
            </div>
            <p v-if="effOf(skill.type)" class="dim eff">
              效率 {{ effOf(skill.type)!.effectiveYield }}/分钟
              <span v-if="effOf(skill.type)!.gearBonus > 0" class="bonus">
                （装备 +{{ pct(effOf(skill.type)!.gearBonus) }}）
              </span>
            </p>
            <button :disabled="store.actionLoading" @click="onStart(skill.type)">开始采集</button>
          </div>
        </div>
        <p v-if="store.totalBonus > 0" class="dim total-bonus">总装备加成 +{{ pct(store.totalBonus) }}</p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.gathering { display: flex; flex-direction: column; gap: 16px; }

.error-banner {
  background: rgba(229, 83, 75, 0.15); border: 1px solid var(--danger);
  color: var(--danger); padding: 10px 14px; border-radius: 6px; font-size: 14px;
}
.notice {
  background: rgba(62, 207, 107, 0.15); border: 1px solid var(--success);
  color: var(--success); padding: 10px 14px; border-radius: 6px; font-size: 14px;
}

.grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
}
.skill-card { display: flex; flex-direction: column; gap: 10px; }
.skill-card h3 { margin: 0; }
.skill-card .kv { display: flex; flex-direction: column; gap: 4px; }
.kv-row { display: flex; justify-content: space-between; }
.eff { font-size: 13px; }
.bonus { color: var(--accent); }
.total-bonus { font-size: 13px; }

.active-task { display: flex; flex-direction: column; gap: 12px; }
.task-head { display: flex; justify-content: space-between; align-items: baseline; }
.task-head h3 { margin: 0; }
.progress {
  height: 10px; background: var(--bg-panel-2); border-radius: 5px; overflow: hidden;
  border: 1px solid var(--border);
}
.progress-bar {
  height: 100%; background: var(--accent); transition: width 0.3s ease;
}
.due { color: var(--success); font-size: 13px; margin: 0; }
.row { display: flex; gap: 10px; }
</style>
