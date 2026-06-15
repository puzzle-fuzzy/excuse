import type { ApiKeyDTO, CreatedApiKey } from '@excuse/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, KeyRound, Plus, Trash2 } from 'lucide-react'
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
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatRelativeTime } from '@/lib/format-time'
import { formatCents } from '@/lib/generation-utils'

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success('已复制密钥')
  }
  catch {
    toast.error('复制失败')
  }
}

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

  const createMutation = useMutation({
    mutationFn: createApiKey,
    onSuccess: (data) => {
      setCreatedKey(data)
      setShowCreate(false)
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

  const { register, handleSubmit, formState: { isSubmitting } } = useForm<{ name: string }>()

  function onCreateSubmit(data: { name: string }) {
    createMutation.mutate({ name: data.name || undefined, scope: createScope })
  }

  // loading
  if (isLoading) {
    return (
      <div className="mx-auto max-w-7xl p-4">
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          加载中...
        </div>
      </div>
    )
  }

  // error
  if (isError) {
    return (
      <div className="mx-auto max-w-7xl p-4">
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <KeyRound className="mb-2 size-10" />
          <p>加载 API 密钥列表失败</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => refetch()}>
            重试
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl p-4 space-y-6">
      <div className="flex items-center gap-2">
        <KeyRound className="size-5" />
        <h1 className="text-lg font-semibold">API Keys</h1>
        <p className="text-xs text-muted-foreground">用于 OpenAI 兼容接口或未来开发者接口</p>
        <Link to="/developers" className="text-xs text-primary underline underline-offset-2">查看 Gateway 使用说明</Link>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => setShowCreate(true)}
          disabled={showCreate}
        >
          <Plus className="size-3" />
          创建密钥
        </Button>
      </div>

      {/* 创建表单 */}
      {showCreate && (
        <Card>
          <CardContent className="p-4">
            <form onSubmit={handleSubmit(onCreateSubmit)} className="space-y-4">
              <div>
                <label className="text-xs text-muted-foreground">名称（可选，最多 100 字符）</label>
                <Input
                  {...register('name', { maxLength: 100 })}
                  placeholder="例如：生产环境"
                  disabled={isSubmitting}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">访问范围</label>
                <Select value={createScope} onValueChange={setCreateScope} disabled={isSubmitting}>
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
              <div className="flex items-center gap-3">
                <Button type="submit" size="sm" disabled={isSubmitting}>
                  {isSubmitting ? '创建中...' : '创建'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowCreate(false)}
                  disabled={isSubmitting}
                >
                  取消
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* 新密钥展示 — 只显示一次 */}
      {createdKey && (
        <Card className="border-primary/50 bg-primary/5">
          <CardContent className="p-4 space-y-2">
            <p className="text-sm font-medium text-destructive">
              完整密钥只显示一次，请立即复制保存。
            </p>
            <div className="flex items-center gap-2">
              <code className="rounded bg-muted px-2 py-1 text-xs break-all select-all">
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
            <p className="py-8 text-center text-sm text-muted-foreground">
              暂无 API 密钥。点击"创建密钥"生成一个新密钥。
            </p>
          )
        : (
            <div className="space-y-3">
              {keys.map(key => (
                <Card key={key.id}>
                  <CardContent className="flex items-center gap-4 p-4">
                    <KeyRound className="size-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">
                          {key.name || '未命名密钥'}
                        </p>
                        <Badge variant={key.scope === 'gateway' ? 'secondary' : 'outline'} className="text-[10px]">
                          {key.scope === 'gateway' ? 'Gateway' : '完全访问'}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
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
                      <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
                        {key.rateLimitPerMinute && (
                          <span>
                            限流：
                            {key.rateLimitPerMinute}
                            {' '}
                            次/分
                          </span>
                        )}
                        {key.quotaMaxCents && (
                          <span>
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
                      variant="destructive"
                      size="sm"
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
              <AlertDialogAction onClick={() => revokeMutation.mutate(revokeTarget.id)}>撤销</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  )
}
