/**
 * 相对时间格式化（中文）：返回 "刚刚" / "N 分钟前" / "N 小时前" / "N 天前"。
 *
 * 此前 Navbar（通知时间）与 ApiKeys（Key 最近使用时间）各维护一份相同实现，现统一在此。
 * 调用方需要额外文案（如 ApiKeys 的 null → "从未使用"）或附加日期后缀（如
 * generation-utils.formatTime 的 "N 分钟前 MM-DD HH:mm"）请自行包裹，不在本函数耦合。
 *
 * @param iso ISO 时间字符串
 * @param now 当前时间戳（毫秒），默认 Date.now()；抽出为参数便于确定性测试
 */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const diff = now - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1)
    return '刚刚'
  if (min < 60)
    return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24)
    return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  return `${day} 天前`
}
