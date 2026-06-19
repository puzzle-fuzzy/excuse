// @ts-check
import { fontProviders } from 'astro/config'
import mdx from '@astrojs/mdx'
import sitemap from '@astrojs/sitemap'
import { defineConfig } from 'astro/config'

// 站点正式域名 —— canonical / sitemap / RSS / OG 都依赖它。
// 上线时通过 SITE_URL 覆盖；本地开发用占位域名即可。
const SITE_URL = process.env.SITE_URL || 'https://excuse.com'
// 用户端工作台地址（「登录 / 免费开始」CTA 指向）。本地可设为 http://localhost:8007。
const APP_URL = process.env.SITE_APP_URL || 'https://app.excuse.com'

// 开发端口：默认 4317，避免与 server(5007)/client(8007)/worker(5100) 冲突。
const PORT = Number(process.env.SITE_PORT) || 4317

// https://astro.build/config
export default defineConfig({
  site: SITE_URL,
  server: { port: PORT, host: true },
  integrations: [mdx(), sitemap()],
  vite: {
    define: {
      // 把 APP_URL 注入为常量，供组件读取（避免每个组件重复读 env）
      __APP_URL__: JSON.stringify(APP_URL),
    },
  },
  fonts: [
    {
      provider: fontProviders.local(),
      name: 'Atkinson',
      cssVariable: '--font-atkinson',
      fallbacks: ['sans-serif'],
      options: {
        variants: [
          { src: ['./src/assets/fonts/atkinson-regular.woff'], weight: 400, style: 'normal', display: 'swap' },
          { src: ['./src/assets/fonts/atkinson-bold.woff'], weight: 700, style: 'normal', display: 'swap' },
        ],
      },
    },
  ],
})
