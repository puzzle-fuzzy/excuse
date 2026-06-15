import antfu from '@antfu/eslint-config'

export default antfu({
  react: true,
  typescript: true,
  rules: {
    'no-console': 'off',
    'node/prefer-global/process': 'off',
    // Node.js 项目中 Buffer 是标准全局变量，无需显式 import
    'node/prefer-global/buffer': 'off',
    'antfu/no-top-level-await': 'off',
    'no-unmodified-loop-condition': 'off',
    // React 19 迁移建议，当前代码在 React 19 下仍然有效，后续统一迁移时再开启
    'react/no-forward-ref': 'off',
    'react/no-context-provider': 'off',
    'react/no-use-context': 'off',
    // useEffect 中初始化/同步 state 是常见模式，该规则过于严格
    'react/set-state-in-effect': 'off',
    // shadcn UI 组件同时导出 variants（cva 常量）和 components，是标准模式
    'react-refresh/only-export-components': 'off',
  },
  ignores: [
    'dist',
    'build',
    'node_modules',
    'docs',
    '**/dist',
    // Drizzle 迁移文件由工具自动生成，无需 lint
    '**/drizzle',
    'apps/client/components/ui',
  ],
})
