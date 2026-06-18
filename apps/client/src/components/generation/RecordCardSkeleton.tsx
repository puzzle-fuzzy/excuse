import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * RecordCard 骨架屏 — 列表加载时替代菊花/纯文本。
 * 近似模仿 RecordCard 的布局：标题行 + prompt 行 + 标签行 + 操作行。
 */
export default function RecordCardSkeleton() {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-3 space-y-3">
        {/* 标题行：icon + 模型名 + 状态 badge */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Skeleton className="size-4 rounded" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <Skeleton className="h-3 w-24" />
        </div>

        {/* Prompt 行 */}
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-3/5" />

        {/* 参数标签行 */}
        <div className="flex gap-1">
          <Skeleton className="h-5 w-14 rounded-full" />
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-5 w-12 rounded-full" />
        </div>

        {/* 操作行 */}
        <div className="flex gap-2">
          <Skeleton className="h-8 w-16 rounded-md" />
          <Skeleton className="h-8 w-16 rounded-md" />
          <Skeleton className="h-8 w-12 rounded-md ml-auto" />
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * 返回 N 个骨架卡片，用于列表加载态。
 */
export function RecordCardSkeletonList({ count = 3 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <RecordCardSkeleton key={i} />
      ))}
    </>
  )
}
