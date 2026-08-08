import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { authApi } from '@/services/api';
import type { User } from '@/types';

const TOKEN_KEY = 'ptidle_token';
const USER_KEY = 'ptidle_user';

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(localStorage.getItem(TOKEN_KEY));
  const user = ref<User | null>(loadStoredUser());

  const isAuthenticated = computed(() => !!token.value);

  function loadStoredUser(): User | null {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as User;
    } catch {
      return null;
    }
  }

  function persist() {
    if (token.value) localStorage.setItem(TOKEN_KEY, token.value);
    else localStorage.removeItem(TOKEN_KEY);
    if (user.value) localStorage.setItem(USER_KEY, JSON.stringify(user.value));
    else localStorage.removeItem(USER_KEY);
  }

  async function login(username: string, password: string) {
    const res = await authApi.login(username, password);
    token.value = res.data.token;
    user.value = res.data.user;
    persist();
  }

  async function register(username: string, password: string) {
    const res = await authApi.register(username, password);
    token.value = res.data.token;
    user.value = res.data.user;
    persist();
  }

  function logout() {
    token.value = null;
    user.value = null;
    persist();
  }

  return { token, user, isAuthenticated, login, register, logout };
});
