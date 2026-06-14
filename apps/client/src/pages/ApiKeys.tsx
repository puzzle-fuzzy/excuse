import type { ApiKeyDTO, CreatedApiKey } from '@excuse/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, KeyRound, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { createApiKey, listApiKeys, revokeApiKey } from '@/api/api-keys'
import { apiKeyQueryKeys } from '@/api/query-client'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'

function formatRelativeTime(iso: string | null): string {
  if (!iso)
    return '从未使用'
  const diff = Date.now() - new Date(iso).getTime()
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

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success('已复制密钥')
  }
  catch {
    toast.error('复制失败')
  }
}

export default function ApiKeys() {
  const queryClient = useQueryClient()

  const { data: keys = [], isLoading, isError, refetch } = useQuery({
    queryKey: apiKeyQueryKeys.list,
    queryFn: listApiKeys,
  })

  const [createdKey, setCreatedKey] = useState<CreatedApiKey | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyDTO | null>(null)

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
    createMutation.mutate({ name: data.name || undefined })
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
            <form onSubmit={handleSubmit(onCreateSubmit)} className="flex items-end gap-3">
              <div className="flex-1">
                <label className="text-xs text-muted-foreground">名称（可选，最多 100 字符）</label>
                <Input
                  {...register('name', { maxLength: 100 })}
                  placeholder="例如：生产环境"
                  disabled={isSubmitting}
                />
              </div>
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
                    <KeyRound className="size-4 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {key.name || '未命名密钥'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        前缀：
                        {key.prefix}
                        ...
                        {'  '}
                        创建：
                        {formatRelativeTime(key.createdAt)}
                        {'  '}
                        上次使用：
                        {formatRelativeTime(key.lastUsedAt)}
                      </p>
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
        <ConfirmDialog
          open={!!revokeTarget}
          onOpenChange={(open) => {
            if (!open)
              setRevokeTarget(null)
          }}
          title="确认撤销密钥？"
          description="撤销后密钥立即失效，无法恢复。正在使用该密钥的所有请求都将被拒绝。"
          confirmText="撤销"
          onConfirm={() => revokeMutation.mutate(revokeTarget.id)}
        />
      )}
    </div>
  )
}
