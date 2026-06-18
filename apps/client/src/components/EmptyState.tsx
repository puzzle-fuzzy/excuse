import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { PackageOpen } from 'lucide-react'

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  children?: ReactNode
}

/**
 * 共享空状态组件 — 图标 + 标题 + 可选描述 + 可选 CTA slot。
 *
 * 覆盖场景：记录列表空、通知空、费用/类别/模型分布空等。
 */
export default function EmptyState({
  icon: Icon = PackageOpen,
  title,
  description,
  children,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
      <Icon className="mb-2 size-8 opacity-40" />
      <p className="text-sm font-medium">{title}</p>
      {description && (
        <p className="mt-1 text-xs text-muted-foreground/70">{description}</p>
      )}
      {children && <div className="mt-3">{children}</div>}
    </div>
  )
}
