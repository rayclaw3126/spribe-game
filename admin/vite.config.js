import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 代理后台独立 Vite app：只服务 admin/，与游戏前端(端口 5173)完全隔离。
// 走 dev proxy 把 /auth /agent /round 转发到后端(4000)，浏览器看到的始终是
// 同源 5174 请求；转发给后端时浏览器会带上真实的 Origin 头（http://localhost:5174），
// 后端 CORS_ORIGIN 白名单里已包含这个来源，正常放行，不再摘除 Origin 头绕过。
function proxyTarget(target) {
  return {
    target,
    changeOrigin: true,
  }
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/auth': proxyTarget('http://127.0.0.1:4000'),
      '/agent': proxyTarget('http://127.0.0.1:4000'),
      '/round': proxyTarget('http://127.0.0.1:4000'),
      '/issues': proxyTarget('http://127.0.0.1:4000'),
      '/uploads': proxyTarget('http://127.0.0.1:4000'),
    },
  },
})
