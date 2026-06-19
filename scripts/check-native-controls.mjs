// 防回退检查：禁止在 apps/client 中混用原生表单控件
//
// 业务页面/组件必须使用 shadcn/ui 组件（components/ui/*），而非裸的
//   - <select> ... </select>          → 用 ui/select.tsx
//   - <input type="checkbox">          → 用 ui/checkbox.tsx
//   - <input type="date">              → 用预设区间（资产页）或封装层
//   - <input type="range">             → 用 ui/slider.tsx
//   - <input type="datetime-local"> / "time"  → 用封装组件
//
// 允许的例外（这些原生用法是规范的）：
//   - components/ui/** 内部的封装实现（本身就是对原生 input 的封装）
//   - <Input> (shadcn) 带 type="number" / "text" / "email" / "password" / "color" / "file"
//     （Input 组件本身就是受控封装，type=number 等是合法用法）
//   - input[type=file]（shadcn 没有官方 file 组件，原生 file 是惯例）
//
// 用法：bun scripts/check-native-controls.mjs
// CI 中可加到 package.json 的 lint 流程。

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const SCAN_ROOT = path.join(ROOT, 'apps/client/src')

// 需要拦截的原生控件模式（JSX 中的裸标签用法）
// 注意：排除 Input 组件（大写 <Input）— 那是 shadcn 封装
const FORBIDDEN = [
  // 裸 <select>（小写，原生；shadcn 是 <Select>）
  { re: /(<select\b)/g, tag: '<select>', fix: '使用 ui/select.tsx 的 <Select>' },
  // <input type="checkbox">（注意排除 <Input type="checkbox">，但 Input 通常不会传 checkbox）
  { re: /(<input\b[^>]+\btype=["']checkbox["'])/g, tag: '<input type="checkbox">', fix: '使用 ui/checkbox.tsx 的 <Checkbox>' },
  // <input type="range">
  { re: /(<input\b[^>]+\btype=["']range["'])/g, tag: '<input type="range">', fix: '使用 ui/slider.tsx 的 <Slider>' },
  // <input type="date">
  { re: /(<input\b[^>]+\btype=["']date["'])/g, tag: '<input type="date">', fix: '使用预设区间或封装的日期组件' },
  // <input type="datetime-local">
  { re: /(<input\b[^>]+\btype=["']datetime-local["'])/g, tag: '<input type="datetime-local">', fix: '使用封装的日期组件' },
  // <input type="time">
  { re: /(<input\b[^>]+\btype=["']time["'])/g, tag: '<input type="time">', fix: '使用封装的时间组件' },
]

// 允许例外的小写 type（通过 shadcn <Input> 传入是规范的）
const ALLOWED_INPUT_TYPES = new Set(['number', 'text', 'email', 'password', 'color', 'file', 'url', 'search', 'tel', 'hidden', 'submit'])

function scan(dir) {
  const violations = []
  if (!fs.existsSync(dir))
    return violations

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      // 跳过 ui 封装层（它本身就是对原生 input 的封装，是规范的源头）
      if (entry.name === 'ui')
        continue
      // 跳过 node_modules / dist
      if (entry.name === 'node_modules' || entry.name === 'dist')
        continue
      violations.push(...scan(fullPath))
    }
    else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.jsx')) {
      const content = fs.readFileSync(fullPath, 'utf8')
      const rel = path.relative(ROOT, fullPath)

      // 逐行检查，便于定位
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        for (const { re, tag, fix } of FORBIDDEN) {
          // 重新在单行上匹配
          const lineRe = new RegExp(re.source, re.flags.replace('g', ''))
          if (lineRe.test(line)) {
            // 排除：通过大写 <Input> 组件传入这些 type 的情况
            // （shadcn Input 不会渲染 checkbox/range/date，但保险起见仍排除 <Input 行）
            if (line.includes('<Input') && ALLOWED_INPUT_TYPES.has(extractInputType(line)))
              continue
            violations.push({ file: rel, line: i + 1, tag, fix, snippet: line.trim().slice(0, 100) })
          }
        }
      }
    }
  }
  return violations
}

function extractInputType(line) {
  const m = line.match(/\btype=["']([a-z-]+)["']/)
  return m ? m[1] : ''
}

const violations = scan(SCAN_ROOT)

if (violations.length === 0) {
  console.log('✓ 未发现混用的原生表单控件（select/checkbox/range/date），全部使用 shadcn/ui 封装。')
  process.exit(0)
}
else {
  console.error(`✗ 发现 ${violations.length} 处原生表单控件，请改用 shadcn/ui 组件：\n`)
  for (const v of violations)
    console.error(`  ${v.file}:${v.line}  ${v.tag}\n    ${v.snippet}\n    → ${v.fix}\n`)
  process.exit(1)
}
