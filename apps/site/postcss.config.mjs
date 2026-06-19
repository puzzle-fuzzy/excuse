// Tailwind v4 经 PostCSS 接入（而非 @tailwindcss/vite）。
// 原因：monorepo catalog 锁定 rolldown-vite(v8)，与 Astro 内置 vite(v7) 主版本冲突，
// @tailwindcss/vite 会绑定到 vite8 的 rolldown 绑定而在 vite7 下运行时崩溃。
// PostCSS 插件完全不依赖 vite，规避该冲突。
/** @type {import('postcss-load-config').Config} */
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}
