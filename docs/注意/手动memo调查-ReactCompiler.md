# 手动 memo 调查 · React Compiler 踩坑记录

> 记录于 2026-06-18。目的：**下次别再花时间考虑「React Compiler 已开，手动 `useMemo`/`useCallback` 是冗余、可以批量删」这件事**——实测结论是不成立、不值得动。本文把坑和复现方法都写清楚，免得重复踩。

## TL;DR（先看这条）

**别动 client 的手动 memo。** React Compiler 虽然开着，但在 client 几乎全面 **bailout**（编译放弃），根本没有提供自动 memoize。所以现有 `useMemo`/`useCallback` 是**唯一**的 memoize 来源，删了就会有子组件 re-render 回归。这不是「冗余清理」，是「必要的性能保护」。只有当 `try/finally` 被重构掉、组件能真正通过 RC 编译时，才值得重新评估。

---

## 背景

来源是架构审计 `TODO2.md` §3.6「client 78 处手动 `useMemo`/`useCallback`（React Compiler 已开）」。表面逻辑很顺：RC 在 `apps/web-business/vite.config.ts` 经 `babel-plugin-react-compiler@1.0.0` + `reactCompilerPreset()` 开启了 → 自动 memoize → 手动 memo 应该是冗余 → 可以删。处置也要求「先开 compiler eslint 插件校验」再删。

**实际跑下来发现这个推理在本仓库不成立。**

---

## 坑 1（最关键）：RC 在 client 几乎全面 bailout —— 手动 memo 并非冗余

用 `eslint-plugin-react-compiler` + `__unstable_donotuse_reportAllBailouts` 跑全量审计，结果：

- **16 / ~18 个含实质逻辑的 client 文件 bailout，共 43 处。**
- 主因 **try/finally**（代码库通用的 `setSaving(true)…finally { setSaving(false) }` 模式），**25 处**。React Compiler 目前编译不了含 `try { … } finally { … }` 的函数。
- 次因「existing manual memoization could not be preserved」（手动 memo 本身让 RC 放弃），**15 处**。
- 点名的两个密集组件同样 bailout：`ShotReferenceAssets.tsx`(7)、`NodeDetailPanel.tsx`(2)。

**含义**：组件函数 bailout 后，RC 不会 memoize 它内部**任何**东西——派生值、传给子组件的 handler 都不 memoize。于是手动 `useMemo`/`useCallback` 是唯一来源。删 `useCallback` → handler 每次渲染新引用 → `PromptEditor`/`ReferenceUploadZone` 等子组件无谓重渲染。这正是 §3.6 警惕的 re-render 回归，被实测坐实。

> 关于版本对不上的疑虑：`eslint-plugin-react-compiler`（lint 侧，RC `19.1.0-rc.2`）和 `babel-plugin-react-compiler`（build 侧，GA `1.0.0`）版本号体系不同，曾怀疑 lint 侧分析偏旧导致 bailout 误报。但 try/finally 是 RC 长期、且 GA 仍未解决的已知限制；且「保留 memo」在 bailout 是否误报两种情况下都安全（memo 不影响正确性，删了才有风险）。故不再纠结、直接采信结论。

## 坑 2：`eslint-plugin-react-compiler` 没有 GA 版本

- 该插件**没有稳定版**，dist-tag `latest` 是 RC `19.1.0-rc.2`，其余全是 `0.0.0-experimental-*`。
- 它和运行时 `babel-plugin-react-compiler@1.0.0`（已 GA）**不是同一套版本号**——别想当然写 `^1.0.0`（解析失败：`No version matching "^1.0.0"`）。
- 想用就 pin `19.1.0-rc.2`。

## 坑 3：默认规则配置对「memo 安全性」是误导

`react-compiler/react-compiler` 规则**默认只报 `InvalidReact` / `InvalidJS`**（真正违反 Rules of React 的硬错误），**不报 bailout**。本仓库这两类目前是 0，所以默认配置下全 client「0 warning / 干净」——**但这是个假象**：它不代表「RC 覆盖了这些组件」，只代表「没有硬错误」。拿这个假 clean 信号去删 memo，正好踩坑 1 的回归。

要拿真实的「能否安全去 memo」信号，**必须**开 `__unstable_donotuse_reportAllBailouts: true`。但开了就是 43 条常驻 warning，且 try/finally 是正确写法不会改 → warning 永远清不掉 → warning 疲劳。所以这条规则不适合作为常驻门禁（见结论）。

## 坑 4：工具链 / 环境坑

调查过程中踩到的执行细节，记下来省得下次再摸索：

- **依赖要装在 root，不是 `apps/web-business`。** `eslint.config.js` 和 `bun run lint`（`eslint .`）都在仓库根运行，import 从 root `node_modules` 解析。装到 `apps/web-business` 会报 `Cannot find package 'eslint-plugin-react-compiler'`。其它 eslint 工具（`@antfu/eslint-config`、`eslint`、`eslint-plugin-react-refresh`）也都已在 root devDeps。
- **eslint 配置是「收窄 scope 的 react 子配置」模式**（见 `eslint.config.js` 顶部注释 + `reactFiles`）。新规则必须挂进同一 `reactFiles` scope，否则后端文件会反向报 `Definition for rule 'react/...' was not found`。
- **VSCode 里跑 eslint 会触发「editor 模式」**，antfu 会禁用部分规则。要拿到确定结果，先剥掉编辑器环境变量：`env -u VSCODE_PID -u VSCODE_CWD bunx eslint …`（antfu 的判定见 `isInEditorEnv()`：`VSCODE_PID || VSCODE_CWD || …`）。
- **`@babel/core` 不在普通 node 解析路径上**，只在 bun 内部的 `.bun/node_modules/@babel` hoist 里。想用 `@babel/core` + `babel-plugin-react-compiler` 直接 transform 一个文件做 ground-truth 验证，**plain node require 找不到**，bun 的 ESM import 也找不到。别在这条路上耗时间——build 用的是 `@rolldown/plugin-babel`（oxc），本来就不走 `@babel/core`。
- **`--rule` CLI 覆盖需要插件已在 config 注册**，否则报 rule not found。单独 `--rule '{"react-compiler/…"}'` 而插件没注册，不会生效（也不会报错，静默 0）——容易误判「规则没效果其实是没注册」。

---

## 结论与处置（2026-06-18）

- **保留 client 全部手动 `useMemo`/`useCallback`。** 不删。
- **不常驻 react-compiler eslint 门禁。** 默认配置假 clean、`reportAllBailouts` 不可清噪声、且违规覆盖与既有 `eslint-plugin-react-hooks`/`@eslint-react` 重叠，增量价值不抵一个 RC 预发布 dev 依赖。装了又卸，**净零代码改动**。
- 结论另存于项目记忆 `react-compiler-inert-in-client.md`。

## 什么时候才值得重新考虑

只有**先把 try/finally 抽掉**，让组件能真正通过 RC 编译时。典型做法：做一个 `withSaving(handler)` 高阶 helper 把 `setSaving(true)/finally{setSaving(false)}` 收进去，让 handler 本体不含 try/finally。那时 RC 才接管 memoize，手动 memo 才算冗余、才好删。**但这是一次独立的、更大的重构，不该为了「清理 memo」去启动它。**

## 想复核时怎么跑（一次性审计，跑完即弃）

```bash
# 1) 临时装插件到 root
bun add -d eslint-plugin-react-compiler@19.1.0-rc.2

# 2) 在 eslint.config.js 临时加（紧贴现有 reactFiles 规则块之后）：
#    import reactCompiler from 'eslint-plugin-react-compiler'
#    …
#    .append({
#      files: reactFiles,
#      plugins: { 'react-compiler': reactCompiler },
#      rules: { 'react-compiler/react-compiler': ['warn', { __unstable_donotuse_reportAllBailouts: true }] },
#    })

# 3) 跑全量（剥掉 VSCode editor 检测）
env -u VSCODE_PID -u VSCODE_CWD bunx eslint 'apps/web-business/src/**/*.{ts,tsx}' \
  | grep "ReactCompilerBailout"

# 4) 看每个文件的 bailout 数 + 原因
# 5) 还原 eslint.config.js，bun remove 该插件
```

判断标准：某组件该规则 **0 bailout** → RC 能编译它 → 它的手动 memo 才算冗余、可考虑删。有任何 bailout → **保留 memo**。
