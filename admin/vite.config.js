import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 代理后台独立 Vite app：只服务 admin/，与游戏前端(端口 5173)完全隔离。
// 走 dev proxy 把 /auth /agent /round 转发到后端(4000)，绕开后端 CORS 白名单
// （后端白名单只放行 5173，且不允许改后端），浏览器看到的始终是同源 5174 请求。
//
// 坑：浏览器对同源的非 GET 请求(如 POST /auth/login)也会带上 Origin 头
// （这是 fetch 规范决定的，不是"跨域才带"），vite 代理默认原样透传这个 Origin
// 头给后端。后端 CORS 白名单只放行 http://localhost:5173，收到 5174 的 Origin
// 会直接判定"来源不在白名单"而 500。不能改后端白名单，所以只能在代理这一侧把
// Origin 头摘掉——摘掉之后后端看到的就是"无 Origin"的请求（和 curl/服务端调用
// 同一类），会直接放行，参见 server/src/index.js 的 cors 配置注释。
function proxyTarget(target) {
  return {
    target,
    changeOrigin: true,
    configure(proxy) {
      proxy.on('proxyReq', (proxyReq) => {
        proxyReq.removeHeader('origin')
      })
    },
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
    },
  },
})
