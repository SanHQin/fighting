import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    /**
     * 后端走代理而不是直连 3001。
     *
     * 两个原因，缺一不可：
     * 1. refreshToken 存在 httpOnly Cookie 里，跨端口（5173 → 3001）属于跨站，
     *    默认的 SameSite=Lax 不会带上，登录看起来"成功"但刷新就掉线。
     * 2. 同源之后，前端不需要为"带 cookie 的跨域请求"配 CORS + credentials 的那套组合。
     */
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: false,
      },
      '/ws': {
        target: 'ws://127.0.0.1:3001',
        ws: true,
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  /**
   * battle-core 是**直接消费 TypeScript 源码**的工作区包（没有 dist）。
   * 把它排除出依赖预打包，否则 esbuild 会把它当成第三方库塞进 .vite/deps，
   * 改一行内核代码得重启 dev server 才生效。
   */
  optimizeDeps: {
    exclude: ['@fighting/battle-core'],
  },
})
