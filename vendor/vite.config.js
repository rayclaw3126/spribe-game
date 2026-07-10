import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 供货商总控独立 Vite app：只服务 vendor/，与 admin(端口 5174) / 游戏前端(5173) 完全隔离。
// 本单纯 UI + 假数据，尚未接后端，proxy 先留空占位；后续接 boss 后端时在此补 /auth 等转发。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    strictPort: true,
    proxy: {
      // 占位：待 boss 后端就绪后在此登记 /auth /vendor 等转发
    },
  },
})
