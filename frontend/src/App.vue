<script setup lang="ts">
import { onMounted } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';

const auth = useAuthStore();
const game = useGameStore();

onMounted(() => {
  // 登录状态下建立 WS 连接（撮合推送、对战用）
  if (auth.isAuthenticated) {
    game.connect();
  }
});
</script>

<template>
  <router-view />
</template>
