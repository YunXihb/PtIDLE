<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';

const router = useRouter();
const auth = useAuthStore();
const game = useGameStore();

const username = ref('');
const password = ref('');
const error = ref<string | null>(null);
const loading = ref(false);

async function submit() {
  if (!username.value || !password.value) {
    error.value = '请输入用户名和密码';
    return;
  }
  error.value = null;
  loading.value = true;
  try {
    await auth.login(username.value, password.value);
    game.connect();
    router.push({ name: 'home' });
  } catch (e) {
    const err = e as { error?: string };
    error.value = err.error || '登录失败';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="auth-wrap">
    <div class="auth-card panel">
      <h1 class="title">PtIDLE</h1>
      <p class="subtitle dim">战棋挂机 · 所玩即所造</p>
      <form @submit.prevent="submit">
        <div class="field">
          <label>用户名</label>
          <input v-model="username" type="text" autocomplete="username" placeholder="用户名" />
        </div>
        <div class="field">
          <label>密码</label>
          <input v-model="password" type="password" autocomplete="current-password" placeholder="密码" />
        </div>
        <div v-if="error" class="error">{{ error }}</div>
        <button type="submit" :disabled="loading" class="w100">
          {{ loading ? '登录中...' : '登录' }}
        </button>
      </form>
      <p class="switch dim">
        还没有账号？
        <router-link to="/register">立即注册</router-link>
      </p>
    </div>
  </div>
</template>

<style scoped>
.auth-wrap {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}
.auth-card { width: 360px; }
.title { text-align: center; font-size: 28px; margin-bottom: 4px; }
.subtitle { text-align: center; margin-bottom: 20px; }
.field { margin-bottom: 14px; }
.field label { display: block; margin-bottom: 6px; font-size: 13px; }
.field input { width: 100%; }
.error { color: var(--danger); margin-bottom: 12px; font-size: 13px; }
.w100 { width: 100%; }
.switch { text-align: center; margin-top: 16px; }
</style>
