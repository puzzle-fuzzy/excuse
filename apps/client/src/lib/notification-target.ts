import type { NotificationItem } from '@/api/notifications'

/**
 * 解析通知点击的跳转目标 URL。
 *
 * 优先级（task_completed / task_failed）：
 *   1. projectId + shotId → `/canvas/:projectId?focus=shot:<shotId>`
 *   2. projectId（无 shotId）→ `/canvas/:projectId`
 *   3. recordId → `/?record=<recordId>`（工作台定位）
 *   4. 都没有 → undefined（不跳转）
 *
 * canvas_completed 同样按 projectId / shotId 优先级解析，未带 meta 返回 undefined。
 * balance_warning 恒定跳 `/billing`。
 * 其他类型 / 无定位信息返回 undefined。
 *
 * 纯函数：不依赖 React / router / fetch；同 input 永远同 output。
 */
export function resolveNotificationTarget(n: NotificationItem): string | undefined {
  const meta = n.meta ?? {}

  if (n.type === 'balance_warning')
    return '/billing'

  if (n.type === 'task_completed' || n.type === 'task_failed' || n.type === 'canvas_completed') {
    if (meta.projectId && meta.shotId)
      return `/canvas/${meta.projectId}?focus=shot:${meta.shotId}`
    if (meta.projectId)
      return `/canvas/${meta.projectId}`
  }

  if ((n.type === 'task_completed' || n.type === 'task_failed') && meta.recordId)
    return `/?record=${meta.recordId}`

  return undefined
}
