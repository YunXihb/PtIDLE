import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/home' },
    { path: '/login', name: 'login', component: () => import('@/views/LoginView.vue'), meta: { guest: true } },
    { path: '/register', name: 'register', component: () => import('@/views/RegisterView.vue'), meta: { guest: true } },
    {
      path: '/',
      component: () => import('@/views/HomeLayout.vue'),
      children: [
        { path: 'home', name: 'home', component: () => import('@/views/HomeView.vue') },
        { path: 'workshop', name: 'workshop', component: () => import('@/views/WorkshopView.vue') },
        { path: 'warehouse', name: 'warehouse', component: () => import('@/views/WarehouseView.vue') },
        { path: 'characters', name: 'characters', component: () => import('@/views/CharactersView.vue') },
        { path: 'cards', name: 'cards', component: () => import('@/views/CardsView.vue') },
        { path: 'battle', name: 'battle', component: () => import('@/views/BattleView.vue') },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/home' },
  ],
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (!to.meta.guest && !auth.isAuthenticated) {
    return { name: 'login' };
  }
  if (to.meta.guest && auth.isAuthenticated) {
    return { name: 'home' };
  }
  return true;
});

export default router;
