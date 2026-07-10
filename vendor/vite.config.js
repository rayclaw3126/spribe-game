import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 供货商总控独立 Vite app：只服务 vendor/，与 admin(端口 5174) / 游戏前端(5173) 完全隔离。
// dev proxy 把 /auth(登录) /issues(系统问题) /uploads(截图静态) 转发到后端(4000)，同源规避 CORS。
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
      '/uploads': proxyTarget('http://127.0.0.1:4000'),
    },
  },
})
