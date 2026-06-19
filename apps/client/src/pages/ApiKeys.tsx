import type { ApiKeyDTO, CreatedApiKey } from '@excuse/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Copy, KeyRound, Loader2, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { createApiKey, listApiKeys, revokeApiKey } from '@/api/api-keys'
import { apiKeyQueryKeys } from '@/api/query-client'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { formatRelativeTime } from '@/lib/format-time'
import { formatCents } from '@/lib/generation-utils'
import { cn, copyToClipboard } from '@/lib/utils'

const SCOPE_OPTIONS: Array<{ value: string, label: string, desc: string }> = [
  { value: 'all', label: '完全访问', desc: '拥有账户完整权限，可访问所有接口' },
  { value: 'gateway', label: '仅 Gateway', desc: '仅允许调用 OpenAI 兼容文本生成接口（/v1/chat/completions）' },
]

export default function ApiKeys() {
  const queryClient = useQueryClient()

  const { data: keys = [], isLoading, isError, refetch } = useQuery({
    queryKey: apiKeyQueryKeys.list,
    queryFn: listApiKeys,
  })

  const [createdKey, setCreatedKey] = useState<CreatedApiKey | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyDTO | null>(null)
  const [createScope, setCreateScope] = useState('all')
  const { register, handleSubmit, reset, formState: { isSubmitting } } = useForm<{ name: string }>()

  const createMutation = useMutation({
    mutationFn: createApiKey,
    onSuccess: (data) => {
      setCreatedKey(data)
      setShowCreate(false)
      reset()
      queryClient.invalidateQueries({ queryKey: apiKeyQueryKeys.list })
    },
  })

  const revokeMutation = useMutation({
    mutationFn: revokeApiKey,
    onSuccess: () => {
      setRevokeTarget(null)
      queryClient.invalidateQueries({ queryKey: apiKeyQueryKeys.list })
      toast.success('密钥已撤销')
    },
  })

  function onCreateSubmit(data: { name: string }) {
    createMutation.mutate({ name: data.name || undefined, scope: createScope })
  }

  // loading
  if (isLoading) {
    return (
      <div className="product-page flex flex-col gap-6">
        <section className="rounded-2xl border bg-card p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-xl" />
            <div className="space-y-2">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-4 w-80 max-w-full" />
            </div>
          </div>
        </section>
        <div className="grid gap-3">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-24 rounded-xl" />
          ))}
        </div>
        <div className="sr-only">
          加载中...
        </div>
      </div>
    )
  }

  // error
  if (isError) {
    return (
      <div className="product-page">
        <div className="mx-auto flex max-w-lg flex-col items-center rounded-xl border bg-card p-8 text-center">
          <span className="grid size-11 place-items-center rounded-xl bg-[color:var(--status-danger-bg)] text-[color:var(--status-danger-fg)]">
            <AlertTriangle className="size-5" />
          </span>
          <h1 className="mt-4 text-lg font-semibold">加载 API 密钥列表失败</h1>
          <p className="mt-2 text-sm text-muted-foreground">无法读取当前密钥，请稍后重试。已创建的密钥不会因此失效。</p>
          <Button variant="outline" size="sm" className="mt-5" onClick={() => refetch()}>
            重试
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="product-page flex flex-col gap-6">
      <section className="rounded-2xl border bg-card p-5 sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border bg-muted/45 px-3 py-1 text-xs text-muted-foreground">
              <ShieldCheck className="size-3.5 text-primary" />
              OpenAI 兼容接口访问
            </div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">API 密钥</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              为服务端、自动化脚本或 Gateway 调用创建独立密钥。密钥只显示一次，建议按环境和用途分开管理。
            </p>
            <Link to="/developers" className="mt-3 inline-flex text-sm text-primary underline underline-offset-2">查看 Gateway 使用说明</Link>
          </div>
          <Button className="brand-cta" onClick={() => setShowCreate(true)}>
            <Plus className="size-4" />
            新建密钥
          </Button>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border bg-card p-4">
          <div className="text-2xl font-semibold">{keys.length}</div>
          <div className="mt-1 text-sm text-muted-foreground">当前密钥</div>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="text-2xl font-semibold">{keys.filter(key => key.scope === 'gateway').length}</div>
          <div className="mt-1 text-sm text-muted-foreground">Gateway 范围</div>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="text-2xl font-semibold">{keys.filter(key => key.lastUsedAt).length}</div>
          <div className="mt-1 text-sm text-muted-foreground">已被使用</div>
        </div>
      </section>

      {/* 创建表单 */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>创建 API 密钥</DialogTitle>
            <DialogDescription>
              为不同环境创建单独密钥，后续可以按用途撤销。完整密钥创建后只显示一次。
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit(onCreateSubmit)} className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground">名称（可选，最多 100 字符）</label>
              <Input
                {...register('name', { maxLength: 100 })}
                placeholder="例如：生产环境"
                disabled={isSubmitting || createMutation.isPending}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">访问范围</label>
              <Select value={createScope} onValueChange={setCreateScope} disabled={isSubmitting || createMutation.isPending}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCOPE_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <span className="font-medium">{opt.label}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        —
                        {' '}
                        {opt.desc}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowCreate(false)}
                disabled={isSubmitting || createMutation.isPending}
              >
                取消
              </Button>
              <Button type="submit" disabled={isSubmitting || createMutation.isPending}>
                {isSubmitting || createMutation.isPending
                  ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        创建中...
                      </>
                    )
                  : '创建'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 新密钥展示 — 只显示一次 */}
      {createdKey && (
        <Card className="border-[color:var(--status-warning-border)] bg-[color:var(--status-warning-bg)]/35">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 size-5 text-[color:var(--status-warning-fg)]" />
              <div>
                <p className="text-sm font-semibold text-[color:var(--status-warning-fg)]">
                  完整密钥只显示一次，请立即复制保存。
                </p>
                <p className="mt-1 text-xs text-muted-foreground">关闭或刷新页面后，将只能看到密钥前缀。</p>
              </div>
            </div>
            <div className="flex flex-col gap-2 rounded-lg border bg-background p-3 sm:flex-row sm:items-center">
              <code className="min-w-0 flex-1 select-all break-all text-xs">
                {createdKey.key}
              </code>
              <Button variant="outline" size="sm" onClick={() => copyToClipboard(createdKey.key)}>
                <Copy className="size-3" />
                复制
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              前缀：
              {createdKey.prefix}
              ...
            </p>
            <p className="text-xs text-muted-foreground">
              复制后可在
              <Link to="/developers" className="mx-0.5 text-primary underline underline-offset-2">开发者接入</Link>
              页查看调用示例。
            </p>
          </CardContent>
        </Card>
      )}

      {/* 密钥列表 */}
      {keys.length === 0
        ? (
            <div className="rounded-xl border border-dashed bg-card p-10 text-center">
              <KeyRound className="mx-auto size-10 text-muted-foreground" />
              <h2 className="mt-3 text-sm font-semibold">还没有密钥</h2>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                暂无 API 密钥。点击&quot;创建密钥&quot;生成一个新密钥。
              </p>
              <Button className="mt-4" size="sm" onClick={() => setShowCreate(true)}>
                <Plus className="size-3.5" />
                创建密钥
              </Button>
            </div>
          )
        : (
            <div className="space-y-3">
              {keys.map(key => (
                <Card key={key.id} className="bg-card">
                  <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                      <KeyRound className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold">
                          {key.name || '未命名密钥'}
                        </p>
                        <Badge variant={key.scope === 'gateway' ? 'secondary' : 'outline'} className="text-[10px]">
                          {key.scope === 'gateway' ? 'Gateway' : '完全访问'}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        前缀：
                        {key.prefix}
                        ...
                        {'  '}
                        创建：
                        {formatRelativeTime(key.createdAt)}
                        {'  '}
                        上次使用：
                        {key.lastUsedAt ? formatRelativeTime(key.lastUsedAt) : '从未使用'}
                      </p>
                      {/* 限流和额度信息 */}
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {key.rateLimitPerMinute && (
                          <span className="rounded-md bg-muted px-2 py-1">
                            限流：
                            {key.rateLimitPerMinute}
                            {' '}
                            次/分
                          </span>
                        )}
                        {key.quotaMaxCents && (
                          <span className="rounded-md bg-muted px-2 py-1">
                            额度：
                            ¥
                            {formatCents(key.totalSpendCents)}
                            {' '}
                            /
                            {' '}
                            ¥
                            {formatCents(key.quotaMaxCents)}
                          </span>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:bg-[color:var(--status-danger-bg)] hover:text-[color:var(--status-danger-fg)]"
                      onClick={() => setRevokeTarget(key)}
                      disabled={revokeMutation.isPending}
                    >
                      <Trash2 className="size-3" />
                      撤销
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

      {/* 撤销确认 */}
      {revokeTarget && (
        <AlertDialog open={!!revokeTarget} onOpenChange={open => !open && setRevokeTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认撤销密钥？</AlertDialogTitle>
              <AlertDialogDescription>撤销后密钥立即失效，无法恢复。正在使用该密钥的所有请求都将被拒绝。</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction
                className={cn('bg-destructive text-destructive-foreground hover:bg-destructive/90')}
                onClick={() => revokeMutation.mutate(revokeTarget.id)}
              >
                撤销
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  )
}
