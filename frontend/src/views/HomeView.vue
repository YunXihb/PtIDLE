<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { usePlayerStore } from '@/stores/player';
import type { OfflineClaimResult } from '@/types';

const player = usePlayerStore();

const loading = ref(true);
const offlineResult = ref<OfflineClaimResult | null>(null);
const showOffline = ref(false);

const resourceNames: Record<string, string> = {
  iron_ore: '铁矿石', coal: '煤炭', wood: '原木', sap: '树液',
  herb: '止血草', mushroom: '荧光菇', iron_ingot: '铁锭', plank: '木板', herb_powder: '草药粉',
};

onMounted(async () => {
  try {
    await player.fetchProfile();
    // 离线收益：last_offline 非空时尝试领取（可能为 0）
    const res = await player.claimOffline();
    if (res.offlineTime > 0) {
      offlineResult.value = res;
      showOffline.value = true;
    }
  } catch {
    // 静默：离线收益领取失败不阻塞主页
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div v-if="loading" class="dim">加载中...</div>
  <div v-else-if="player.profile">
    <h2 class="mb">欢迎，{{ player.profile.username }}</h2>

    <div class="grid">
      <div class="panel stats">
        <h3>资源</h3>
        <div class="kv">
          <div v-for="(v, k) in player.profile.resources" :key="k" class="kv-row">
            <span>{{ resourceNames[k] || k }}</span>
            <span class="num">{{ v }}</span>
          </div>
        </div>
      </div>

      <div class="panel stats">
        <h3>材料</h3>
        <div class="kv">
          <div v-for="(v, k) in player.profile.materials" :key="k" class="kv-row">
            <span>{{ resourceNames[k] || k }}</span>
            <span class="num">{{ v }}</span>
          </div>
        </div>
      </div>

      <div class="panel">
        <h3 class="mb">我的棋子</h3>
        <div class="char-list">
          <div v-for="c in player.profile.characters" :key="c.id" class="char-chip">
            <span class="name">{{ c.name }}</span>
            <span class="prof" :class="c.profession">{{ c.profession }}</span>
            <span class="dim">HP {{ c.health }}/{{ c.max_health }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 离线收益弹窗 -->
    <div v-if="showOffline && offlineResult" class="modal-mask" @click.self="showOffline = false">
      <div class="modal panel">
        <h3>离线收益</h3>
        <p class="dim mb">离线 {{ offlineResult.offlineTime }} 分钟</p>
        <div class="kv">
          <div
            v-for="(v, k) in offlineResult.stored"
            :key="k"
            class="kv-row"
          >
            <span>{{ resourceNames[k] || k }} +{{ v }}</span>
            <span v-if="offlineResult.overflowed[k]" class="overflow">
              溢出 {{ offlineResult.overflowed[k] }}
            </span>
          </div>
        </div>
        <button class="mt2" @click="showOffline = false">收下</button>
      </div>
    </div>

    <div class="panel mt2 quick">
      <h3 class="mb">快速开始</h3>
      <p class="dim mb">进入「对战」开始匹配，或去「工坊」采集资源制造卡牌。</p>
      <div class="row">
        <router-link to="/battle"><button>开始对战</button></router-link>
        <router-link to="/workshop"><button class="secondary">前往工坊</button></router-link>
      </div>
    </div>
  </div>
</template>

<style scoped>
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
.stats h3 { margin-bottom: 10px; }
.kv { display: flex; flex-direction: column; gap: 6px; }
.kv-row { display: flex; justify-content: space-between; align-items: center; }
.num { color: var(--accent); font-weight: 600; }
.overflow { color: var(--warning); font-size: 12px; }
.char-list { display: flex; flex-wrap: wrap; gap: 8px; }
.char-chip {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; background: var(--bg-panel-2);
  border: 1px solid var(--border); border-radius: 6px;
}
.char-chip .name { font-weight: 600; }
.prof { font-size: 11px; padding: 2px 6px; border-radius: 4px; }
.prof.warrior { background: var(--warrior); }
.prof.ranger { background: var(--ranger); }
.prof.mage { background: var(--mage); }
.modal-mask {
  position: fixed; inset: 0; background: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center; z-index: 100;
}
.modal { width: 360px; }
.row { display: flex; gap: 12px; }
</style>
