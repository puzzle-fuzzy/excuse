/**
 * 分 → 元转换（保留 2 位小数）
 *
 * 算术: cents * 100 / 10000 = cents / 100
 * 使用 Math.round 避免浮点误差（例: 1999 → 19.99，而非 19.989999...）
 *
 * 不变量: totalPriceCents（整数分）为权威值，totalPrice（元）仅为展示派生值
 */
export function centsToYuan(cents: number): number {
  return Math.round(cents * 100) / 10000
}
