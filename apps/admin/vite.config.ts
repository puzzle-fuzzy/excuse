import path from 'node:path'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 管理端 dev 端口 8008（与 client 8007 / site 4317 / server 5007 / worker 5100 错开）。
// /api 代理到 server（5007），与用户端一致——复用同一 httpOnly cookie 会话。
export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
  ],
  envDir: path.resolve(__dirname, '../../'),
  server: {
    port: 8008,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:5007',
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
