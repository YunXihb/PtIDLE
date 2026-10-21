<script setup lang="ts">
import { onMounted, onUnmounted, computed, ref } from 'vue';
import { useGatheringStore } from '@/stores/gathering';
import { usePlayerStore } from '@/stores/player';
import { resourceName } from '@/utils/resources';
import type { SkillType, GatheringEfficiency, GatheringTask } from '@/types';

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

// 轮询（1 秒一跳，让进度条看起来更顺）
let pollTimer: number | null = null;
// 已展示过的轮次，用于检测"后端完成一轮并自动开启下一轮"
let lastRound: number | null = null;

function startPolling() {
  stopPolling();
  lastRound = store.activeTask?.round ?? 1;
  pollTimer = window.setInterval(async () => {
    const hadTask = !!store.activeTask;
    try {
      await store.fetchStatus();
    } catch {
      return; // 网络抖动等：静默，下个 tick 重试
    }

    const task = store.activeTask;
    if (!task) {
      // 任务没了（玩家点了"取消采集"或在其他标签页取消）-> 停掉轮询
      if (hadTask) stopPolling();
      return;
    }

    // 连续采集：轮次号推进 = 上一轮已结算且后端自动开了新一轮
    const round = task.round ?? 1;
    if (lastRound !== null && round > lastRound) {
      lastRound = round;
      await player.fetchProfile();
      showNotice(roundNotice(round));
    } else {
      lastRound = round;
    }
  }, 1000);
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

/**
 * 取最近一轮已结算任务的产出。
 * 连续采集下 idle_queue 只保留最近两轮：[本轮 completed, 下一轮 active]，
 * completed 那条带 result.resources / result.overflowed。
 */
function lastRoundResult(): GatheringTask['result'] | null {
  const queue = player.profile?.idle_queue ?? [];
  const completed = [...queue].reverse().find((t) => t.status === 'completed');
  return completed?.result ?? null;
}

/**
 * 轮次推进提示：把这一轮实际入账多少、有没有溢出说清楚。
 * 仓库满时产出会全部溢出（不超上限），玩家看不到资源变化，
 * 若不提示就会以为"连续采集在跑但什么都没给"。
 */
function roundNotice(round: number): string {
  const result = lastRoundResult();
  if (!result) return `第 ${round} 轮采集已开始`;

  const gained = Object.entries(result.resources)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${resourceName(k)} +${v}`)
    .join('，');
  const overflow = Object.entries(result.overflowed)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${resourceName(k)} 溢出 ${v}`)
    .join('，');

  if (!gained && overflow) {
    return `第 ${round} 轮已开始，仓库已满（${overflow}，未入账）`;
  }
  if (gained) {
    return `第 ${round} 轮已开始，获得 ${gained}${overflow ? `（${overflow}）` : ''}`;
  }
  return `第 ${round} 轮采集已开始`;
}

async function onStart(type: SkillType) {
  await store.start(type);
  if (store.activeTask) startPolling();
}

async function onComplete() {
  const result = await store.complete();
  // 连续采集：后端已自动开启下一轮，轮询不中断
  // 同步一次轮次号，避免下一个 tick 再弹一次"第 N 轮已开始"
  if (store.activeTask) {
    lastRound = store.activeTask.round ?? 1;
  }
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
          <span class="dim">
            第 {{ store.activeTask.round ?? 1 }} 轮 ·
            {{ store.activeTask.elapsedSeconds ?? 0 }}/{{ store.activeTask.duration }}秒
          </span>
        </div>
        <div class="progress">
          <div class="progress-bar" :style="{ width: progressPct + '%' }"></div>
        </div>
        <p class="dim auto-next">本轮结束后自动开始下一轮</p>
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
.auto-next { font-size: 13px; margin: 0; }
.row { display: flex; gap: 10px; }
</style>
