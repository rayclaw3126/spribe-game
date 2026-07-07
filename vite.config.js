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
      // 玩家登录走同源代理，避免 CORS：changeOrigin 只改 Host 头，浏览器仍会带上
      // 真实页面的 Origin 头转发给后端，和后端 CORS_ORIGIN 白名单（生产域名）对不上
      // 就会被拒；这里连 Origin 头一起去掉，让后端按“无 origin（同源/服务端调用）”放行。
      '/auth': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.removeHeader('origin')
          })
        },
      },
    },
  },
})
