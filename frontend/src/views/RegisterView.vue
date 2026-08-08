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
const confirm = ref('');
const error = ref<string | null>(null);
const loading = ref(false);

async function submit() {
  if (!username.value || !password.value) {
    error.value = '请输入用户名和密码';
    return;
  }
  if (password.value.length < 6) {
    error.value = '密码至少 6 位';
    return;
  }
  if (password.value !== confirm.value) {
    error.value = '两次密码不一致';
    return;
  }
  error.value = null;
  loading.value = true;
  try {
    await auth.register(username.value, password.value);
    game.connect();
    router.push({ name: 'home' });
  } catch (e) {
    const err = e as { error?: string };
    error.value = err.error || '注册失败';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="auth-wrap">
    <div class="auth-card panel">
      <h1 class="title">注册</h1>
      <form @submit.prevent="submit">
        <div class="field">
          <label>用户名</label>
          <input v-model="username" type="text" autocomplete="username" placeholder="用户名" />
        </div>
        <div class="field">
          <label>密码（至少 6 位）</label>
          <input v-model="password" type="password" autocomplete="new-password" placeholder="密码" />
        </div>
        <div class="field">
          <label>确认密码</label>
          <input v-model="confirm" type="password" autocomplete="new-password" placeholder="确认密码" />
        </div>
        <div v-if="error" class="error">{{ error }}</div>
        <button type="submit" :disabled="loading" class="w100">
          {{ loading ? '注册中...' : '注册' }}
        </button>
      </form>
      <p class="switch dim">
        已有账号？
        <router-link to="/login">去登录</router-link>
      </p>
    </div>
  </div>
</template>

<style scoped>
.auth-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; }
.auth-card { width: 360px; }
.title { text-align: center; margin-bottom: 20px; }
.field { margin-bottom: 14px; }
.field label { display: block; margin-bottom: 6px; font-size: 13px; }
.field input { width: 100%; }
.error { color: var(--danger); margin-bottom: 12px; font-size: 13px; }
.w100 { width: 100%; }
.switch { text-align: center; margin-top: 16px; }
</style>
