import antfu, { react } from '@antfu/eslint-config'

// 这是一个混合技术栈 monorepo：apps/client 是 React，apps/server、apps/worker
// 以及 packages/* 全是纯 Node/Bun 后端代码。
// antfu 的 `react: true` 会给整套 React 规则设定 `**/*.?([cm])[jt]s?(x)` 这么宽的
// files 范围（覆盖所有 .ts/.js 而不只是 .tsx/.jsx），导致后端测试文件也被套上
// 50+ 条 React 规则（如 react/no-unnecessary-use-prefix 把 useXxx 误判成 Hook）。
//
// 治本做法：不使用 `react: true` 全局开关，改为手动引入 react() 子配置，
// 把它的 files 收窄到真正写 React 的前端目录，再用 composer append 回去。
const reactFiles = ['apps/client/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}']

// react() 返回 [plugins 注册项, ...带 rules 的规则项]。
// 只改写「带 rules 的项」的 files；plugins 注册项保持无 files（全局可用），
// 这样 React 插件在 client 文件上能正常解析，而后端文件上不再命中任何 react/* 规则。
const scopedReact = (await react()).map(config =>
  config.rules ? { ...config, files: reactFiles } : config,
)

export default antfu({
  typescript: true,
  rules: {
    'no-console': 'off',
    'node/prefer-global/process': 'off',
    // Node.js 项目中 Buffer 是标准全局变量，无需显式 import
    'node/prefer-global/buffer': 'off',
    'antfu/no-top-level-await': 'off',
    'no-unmodified-loop-condition': 'off',
  },
  ignores: [
    'dist',
    'build',
    'node_modules',
    'docs',
    '**/dist',
    // Drizzle 迁移文件由工具自动生成，无需 lint
    '**/drizzle',
    'apps/client/src/components/ui/**',
  ],
})
  // 1) 把收窄过范围的 React 规则集挂回去
  .append(...scopedReact)
  // 2) React 规则的开关也必须放在 client 文件范围内。
  //    flat config 中，若在无 files 的全局块里关闭一条 react/* 规则，
  //    后端文件因未注册 react 插件会反向报 "Definition for rule 'react/...' was not found"。
  .append({
    files: reactFiles,
    rules: {
      // React 19 迁移建议，当前代码在 React 19 下仍然有效，后续统一迁移时再开启
      'react/no-forward-ref': 'off',
      'react/no-context-provider': 'off',
      'react/no-use-context': 'off',
      // useEffect 中初始化/同步 state 是常见模式，该规则过于严格
      'react/set-state-in-effect': 'off',
      // shadcn UI 组件同时导出 variants（cva 常量）和 components，是标准模式
      'react-refresh/only-export-components': 'off',
    },
  })
