<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';

const router = useRouter();
const auth = useAuthStore();
const game = useGameStore();

function logout() {
  game.disconnect();
  auth.logout();
  router.push({ name: 'login' });
}

const navItems = [
  { name: 'home', label: '主界面' },
  { name: 'workshop', label: '工坊' },
  { name: 'warehouse', label: '仓库' },
  { name: 'characters', label: '棋子' },
  { name: 'cards', label: '卡牌' },
  { name: 'battle', label: '对战' },
];
</script>

<template>
  <div class="layout">
    <nav class="topbar">
      <div class="brand">PtIDLE</div>
      <div class="nav">
        <router-link
          v-for="item in navItems"
          :key="item.name"
          :to="{ name: item.name }"
          class="nav-link"
          active-class="active"
        >
          {{ item.label }}
        </router-link>
      </div>
      <div class="user">
        <span class="dim">{{ auth.user?.username }}</span>
        <button class="secondary" @click="logout">退出</button>
      </div>
    </nav>
    <main class="content">
      <router-view />
    </main>
  </div>
</template>

<style scoped>
.layout { min-height: 100vh; display: flex; flex-direction: column; }
.topbar {
  display: flex; align-items: center; gap: 24px;
  padding: 0 20px; height: 56px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
}
.brand { font-size: 20px; font-weight: 700; color: var(--accent); }
.nav { display: flex; gap: 4px; flex: 1; }
.nav-link {
  padding: 6px 14px; border-radius: 6px; color: var(--text-dim);
  font-size: 14px;
}
.nav-link:hover { color: var(--text); background: var(--bg-panel-2); }
.nav-link.active { color: #fff; background: var(--accent); }
.user { display: flex; align-items: center; gap: 10px; }
.content { flex: 1; padding: 20px; max-width: 1200px; width: 100%; margin: 0 auto; }
</style>
