import currency from 'currency.js'

/**
 * 管理端仅用到 formatCents（从用户端 generation-utils.ts 裁剪而来），
 * 作为独立 shim 保留同名文件，使迁移过来的 admin 组件 import 路径不变。
 */

/** 把整数分格式化为带 2 位小数的元字符串（无货币符号）。 */
export function formatCents(cents: number, precision = 2): string {
  return currency(cents, { fromCents: true, precision, symbol: '' }).format()
}
