import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, RefreshCw, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { cancelAdminTask, fetchAdminOverview, requeueAdminTask } from '@/api/client'
import { adminQueryKeys } from '@/api/query-client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { AdminGatewayClientsTab } from './ApiKeys'
import { AdminAuditLogsTab } from './Audit'
import { AdminOverviewTab } from './Overview'
import { AdminProjectsTab } from './Projects'
import { AdminProvidersTab } from './Providers'
import { AdminUsersTab } from './Users'

type AdminTab = 'overview' | 'users' | 'providers' | 'projects' | 'gateway' | 'audit'

const TABS: { id: AdminTab, label: string }[] = [
  { id: 'overview', label: '概览' },
  { id: 'users', label: '用户' },
  { id: 'providers', label: 'Provider' },
  { id: 'projects', label: '项目' },
  { id: 'gateway', label: 'Gateway 客户' },
  { id: 'audit', label: '审计' },
]

export default function Admin() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<AdminTab>('overview')

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: adminQueryKeys.overview,
    queryFn: fetchAdminOverview,
    refetchInterval: () => document.hidden ? false : 30_000,
  })

  const refreshAdminData = async () => {
    await queryClient.invalidateQueries({ queryKey: adminQueryKeys.all })
  }

  const requeueMutation = useMutation({
    mutationFn: requeueAdminTask,
    onSuccess: async () => {
      toast.success('任务已重新排队')
      await refreshAdminData()
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : '重排任务失败')
    },
  })

  const cancelMutation = useMutation({
    mutationFn: cancelAdminTask,
    onSuccess: async () => {
      toast.success('任务已取消')
      await refreshAdminData()
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : '取消任务失败')
    },
  })

  if (isLoading) {
    return (
      <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center text-sm text-muted-foreground">
        管理后台加载中...
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <Card className="border-destructive/40">
          <CardContent className="space-y-3 p-6">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-4" />
              <span className="font-medium">无法访问管理后台</span>
            </div>
            <p className="text-sm text-muted-foreground">
              请确认当前用户 ID 已配置到服务端
              {' '}
              <code>ADMIN_USER_IDS</code>
              。
            </p>
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className="size-4" />
              重试
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const isMutating = requeueMutation.isPending || cancelMutation.isPending

  return (
    <div className="mx-auto max-w-7xl p-4">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-primary" />
            <h1 className="text-lg font-semibold">管理后台</h1>
            <Badge variant="secondary">内部</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            运营侧只读统计：概览 / 用户用量 / Provider 错误率与成本。
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`size-4 ${isFetching ? 'animate-spin' : ''}`} />
          刷新
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap gap-1 rounded-lg border bg-muted/40 p-1">
        {TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              activeTab === tab.id ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <AdminOverviewTab
          data={data}
          isFetching={isFetching}
          refetch={refetch}
          requeue={id => requeueMutation.mutate(id)}
          cancel={id => cancelMutation.mutate(id)}
          isMutating={isMutating}
        />
      )}

      {activeTab === 'users' && <AdminUsersTab />}

      {activeTab === 'providers' && <AdminProvidersTab />}

      {activeTab === 'projects' && <AdminProjectsTab />}

      {activeTab === 'gateway' && <AdminGatewayClientsTab />}

      {activeTab === 'audit' && <AdminAuditLogsTab />}
    </div>
  )
}
