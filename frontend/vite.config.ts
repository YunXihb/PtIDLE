import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // T082: 仅把 vue 全家桶(vue/vue-router/pinia/@vue) 拆为独立 vendor-vue chunk，
        // 跨路由复用 + 长期缓存（业务代码变动不失效其缓存）。
        // 其余 node_modules 一律返回 undefined 交回 Vite 默认拆分：
        //   - 动态 import 的 socket.io-client 整个子图(engine.io-client 等传递依赖)
        //     自动成独立懒加载 chunk，仅对战连接时下载；
        //   - 静态 import 的(如 axios)并入引用方 chunk。
        // 不在 manualChunks 里对 socket.io-client 的依赖强行归类，否则会把传递依赖
        // 错误并入 eager vendor，反而破坏延迟加载。
        manualChunks(id) {
          if (id.includes('node_modules') && (id.includes('vue') || id.includes('pinia'))) {
            return 'vendor-vue';
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      // 开发期把 /api 与 /socket.io 代理到后端（3000），避免 CORS 问题
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
