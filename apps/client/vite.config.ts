import path from 'node:path'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
  ],
  envDir: path.resolve(__dirname, '../../'),
  server: {
    port: 8007,
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
