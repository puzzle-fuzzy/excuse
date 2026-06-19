# apps/site — Excuse 官网 / 博客 / 文档

AI 内容生成平台 Excuse 的对外入口站点（[PRODUCT_DEVELOPMENT_BLUEPRINT](../../PRODUCT_DEVELOPMENT_BLUEPRINT.md) Phase 1）。

技术栈：**Astro 6**（静态优先、强 SEO）+ **Tailwind CSS v4**（经 PostCSS 接入）+ Content Collections（Markdown/MDX）。

## 运行

```bash
# 在 monorepo 根目录
bun run dev:site      # → http://localhost:4317
bun run build         # 含 site 构建
```

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `SITE_URL` | `https://excuse.com` | 正式域名，驱动 canonical / sitemap / RSS / OG |
| `SITE_APP_URL` | `https://app.excuse.com` | 用户端工作台地址（「登录 / 免费开始」CTA 指向）；本地设为 `http://localhost:8007` |
| `SITE_PORT` | `4317` | 开发端口（避开 server 5007 / client 8007 / worker 5100） |

## 结构

```
src/
  components/   Header / Footer / BaseHead(SEO+JSON-LD) / Icon ...
  layouts/      BaseLayout / BlogPost / DocLayout
  pages/        路由：首页、产品、用例、定价、博客、文档、法律、404 ...
  content/      blog（5 栏目）/ docs（按栏目）Markdown 内容
  consts.ts     全站数据：品牌、导航、用例、套餐、FAQ、页脚
  styles/       global.css（Tailwind v4 + 品牌色 + prose）
```

## SEO 基建

每页唯一 `title` / `description` / `canonical`；`@astrojs/sitemap` 生成 sitemap；`rss.xml` 提供博客 RSS；`BaseHead` 输出 Open Graph / Twitter Card / JSON-LD（WebSite + BlogPosting）。

## 关于 Tailwind 接入方式

monorepo catalog 锁定的是 rolldown-vite（v8），与 Astro 内置 vite（v7）主版本冲突，`@tailwindcss/vite` 会在构建时崩溃。因此本站改用 `@tailwindcss/postcss`（`postcss.config.mjs`），完全不依赖 vite 版本。
