import { useQuery } from '@tanstack/react-query'
/**
 * Admin 项目 Tab
 */
import { RefreshCw, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useDebounce } from 'use-debounce'
import { fetchAdminProjects } from '@/api/admin'
import { adminQueryKeys } from '@/api/query-client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatDate, statusLabel, statusVariant } from './shared'

export function AdminProjectsTab() {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [debouncedSearch] = useDebounce(search, 300)

  const PROJECT_STATUS_OPTIONS = [
    { label: '全部状态', value: 'all' },
    { label: '草稿', value: 'draft' },
    { label: '分析', value: 'analyzed' },
    { label: '角色', value: 'characters_ready' },
    { label: '场景', value: 'locations_ready' },
    { label: '参考图', value: 'refs_ready' },
    { label: '分镜', value: 'storyboard_ready' },
    { label: '连续性', value: 'continuity_checked' },
    { label: '提示词', value: 'prompts_ready' },
    { label: '生成中', value: 'generating' },
    { label: '完成', value: 'completed' },
    { label: '部分失败', value: 'partial_failed' },
    { label: '失败', value: 'failed' },
  ]

  const queryParams = useMemo(() => ({
    search: debouncedSearch || undefined,
    status: statusFilter === 'all' ? undefined : statusFilter,
    isDeleted: false,
    limit: 20,
    offset: 0,
  }), [debouncedSearch, statusFilter])

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: adminQueryKeys.projects(queryParams),
    queryFn: () => fetchAdminProjects(queryParams),
  })

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-sm font-medium">Canvas 项目</CardTitle>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`size-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          刷新
        </Button>
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input placeholder="搜索项目标题..." value={search} onChange={e => setSearch(e.target.value)} className="h-9 pl-8" />
          </div>
          <div className="w-28">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger><SelectValue placeholder="全部状态" /></SelectTrigger>
              <SelectContent>
                {PROJECT_STATUS_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground whitespace-nowrap">
            {data?.total ?? 0}
            {' '}
            个项目
          </p>
        </div>

        {isLoading && <div className="py-10 text-center text-sm text-muted-foreground">正在读取项目列表...</div>}
        {!isLoading && (!data || data.items.length === 0) && <div className="py-10 text-center text-sm text-muted-foreground">没有匹配的项目</div>}

        {!isLoading && data && data.items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="pb-2 pr-3 font-medium">标题</th>
                  <th className="pb-2 pr-3 font-medium">用户</th>
                  <th className="pb-2 pr-3 font-medium">状态</th>
                  <th className="pb-2 pr-3 font-medium text-right">镜头</th>
                  <th className="pb-2 pr-3 font-medium text-right">已完成</th>
                  <th className="pb-2 pr-3 font-medium">模型偏好</th>
                  <th className="pb-2 font-medium">创建时间</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map(project => (
                  <tr key={project.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="py-2 pr-3 font-medium max-w-50 truncate" title={project.title}>{project.title}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{project.username ?? '-'}</td>
                    <td className="py-2 pr-3"><Badge variant={statusVariant(project.status)}>{statusLabel(project.status)}</Badge></td>
                    <td className="py-2 pr-3 text-right">{project.shotCount}</td>
                    <td className="py-2 pr-3 text-right">{project.completedShotCount}</td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground max-w-40 truncate" title={project.modelSummary}>{project.modelSummary}</td>
                    <td className="py-2 text-muted-foreground text-xs">{formatDate(project.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
