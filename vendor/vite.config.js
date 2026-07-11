import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 供货商总控独立 Vite app：只服务 vendor/，与 admin(端口 5174) / 游戏前端(5173) 完全隔离。
// dev proxy 把 /auth(登录) /issues(系统问题) /tenants(商家) /uploads(截图静态) 转发到后端(4000)，同源规避 CORS。
function proxyTarget(target) {
  return { target, changeOrigin: true }
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    strictPort: true,
    proxy: {
      '/auth': proxyTarget('http://127.0.0.1:4000'),
      '/issues': proxyTarget('http://127.0.0.1:4000'),
      '/tenants': proxyTarget('http://127.0.0.1:4000'),
      // 注意：只代理 API 子路径，不能代理 /dashboard 或 /fees（那是前端页面路由，会被抢走）。
      '/dashboard/stats': proxyTarget('http://127.0.0.1:4000'),
      '/fees/list': proxyTarget('http://127.0.0.1:4000'),
      '/risk/list': proxyTarget('http://127.0.0.1:4000'),
      '/uploads': proxyTarget('http://127.0.0.1:4000'),
    },
  },
})
