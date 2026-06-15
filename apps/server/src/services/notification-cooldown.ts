/**
 * 通知防刷策略 — 基于内存 Map 的冷却判断
 *
 * 设计：
 *   - key = `${accountId}:${type}:${dedupKey}`
 *   - value = lastSentAt (epoch ms)
 *   - shouldSend() 返回 true 时自动更新 lastSentAt
 *   - Map 条目在冷却期过后自动失效（惰性清理）
 *   - 进程级内存，重启后冷却状态丢失（可接受，通知多发一条无害）
 *
 * 默认冷却时间：
 *   - balance_warning: 5 分钟
 *   - task_completed / task_failed (同步任务): 3 秒
 *   - system: 1 小时
 *   - api_key_expired: 24 小时
 *   - task_completed / task_failed (异步视频): 0（每次都发）
 *   - canvas_completed: 0（每次都发）
 */

/** 冷却时间常量（毫秒） */
export const COOLDOWN_MS = {
  balanceWarning: 5 * 60 * 1000,
  syncTask: 3 * 1000,
  system: 60 * 60 * 1000,
  apiKeyExpired: 24 * 60 * 60 * 1000,
  none: 0,
} as const

/** 内存冷却表 */
const cooldowns = new Map<string, number>()

/**
 * 判断是否应该发送通知（冷却检查）
 *
 * @param accountId 用户 ID
 * @param type 通知类型
 * @param dedupKey 去重键（如 recordId、projectId、keyId 等）
 * @param cooldownMs 冷却时间（毫秒），0 = 不冷却，每次都发
 * @returns true = 应该发送；false = 仍在冷却中，跳过
 */
export function shouldSend(
  accountId: string,
  type: string,
  dedupKey: string,
  cooldownMs: number,
): boolean {
  if (cooldownMs <= 0)
    return true

  const key = `${accountId}:${type}:${dedupKey}`
  const now = Date.now()
  const lastSent = cooldowns.get(key)

  if (lastSent !== undefined && now - lastSent < cooldownMs) {
    return false
  }

  cooldowns.set(key, now)
  return true
}

/**
 * 清除冷却状态（测试用）
 */
export function resetCooldowns(): void {
  cooldowns.clear()
}

/**
 * 获取冷却表大小（调试/测试用）
 */
export function getCooldownSize(): number {
  return cooldowns.size
}
