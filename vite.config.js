import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Aviator 的实时通道：前端连相对路径 /ws/aviator，vite 转发到后端 4000端口，
      // 规避浏览器跨域限制（dev 环境专用，生产环境走反向代理另行配置）。
      '/ws': { target: 'ws://127.0.0.1:4000', ws: true, changeOrigin: true },
      // 玩家登录走同源代理：浏览器仍会带上真实页面的 Origin 头（http://localhost:5173）
      // 转发给后端，由后端 CORS_ORIGIN 白名单校验放行，不再摘除 Origin 头绕过。
      '/auth': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
      // Dice 即时游戏下注接口：前端连相对路径 /round/dice/play，vite 转发到后端
      // 4000 端口，同源代理下浏览器仍带真实 Origin，走后端 CORS 白名单放行。
      '/round': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
    },
  },
})
