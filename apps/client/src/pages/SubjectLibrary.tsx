import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
/**
 * 主体资产库页面 — 跨项目复用角色/场景
 *
 * 见 docs/TODO.md §二、1
 */
import { Heart, MapPin, Search, Trash2, User } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { deleteSubject, listSubjects, toggleSubjectFavorite } from '@/api/client'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

async function fetchSubjects(params: { subjectType?: string, search?: string, limit?: number, offset?: number }) {
  return listSubjects(params)
}

export default function SubjectLibrary() {
  const queryClient = useQueryClient()
  const [typeFilter, setTypeFilter] = useState('all')
  const [search, setSearch] = useState('')

  const subjectType = typeFilter === 'all' ? undefined : typeFilter

  const { data, isLoading } = useQuery({
    queryKey: ['subjects', { subjectType, search }],
    queryFn: () => fetchSubjects({ subjectType, search: search || undefined, limit: 50 }),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteSubject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subjects'] })
      toast.success('已删除')
    },
    onError: () => toast.error('删除失败'),
  })

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const favMutation = useMutation({
    mutationFn: toggleSubjectFavorite,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['subjects'] }),
    onError: () => toast.error('操作失败'),
  })

  const items = data?.items ?? []

  return (
    <div className="mx-auto max-w-5xl p-4">
      <div className="mb-4">
        <h1 className="text-lg font-semibold">主体资产库</h1>
        <p className="mt-1 text-sm text-muted-foreground">跨项目复用角色与场景，减少重复 AI 生成。</p>
      </div>

      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} className="pl-9" placeholder="搜索名称..." />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-36"><SelectValue placeholder="全部类型" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部类型</SelectItem>
            <SelectItem value="character">角色</SelectItem>
            <SelectItem value="location">场景</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading && <p className="py-8 text-center text-sm text-muted-foreground">加载中...</p>}

      {!isLoading && items.length === 0 && (
        <div className="py-12 text-center">
          <p className="text-sm text-muted-foreground">暂无保存的角色或场景</p>
          <p className="mt-1 text-xs text-muted-foreground">在 Canvas 项目中完成角色/场景生成后，可以保存到资产库。</p>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {items.map(subject => (
          <Card key={subject.id} className="overflow-hidden">
            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
              <div className="flex items-center gap-2">
                {subject.subjectType === 'character' ? <User className="size-4 text-muted-foreground" /> : <MapPin className="size-4 text-muted-foreground" />}
                <CardTitle className="text-sm font-medium truncate">{subject.name}</CardTitle>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="size-7" onClick={() => favMutation.mutate(subject.id)}>
                  <Heart className={`size-3.5 ${subject.isFavorite ? 'fill-red-500 text-red-500' : ''}`} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-destructive"
                  onClick={() => setDeleteConfirmId(subject.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <Badge variant="outline" className="mb-2 text-xs">
                {subject.subjectType === 'character' ? '角色' : '场景'}
              </Badge>
              {subject.referenceImageUrl && (
                <img src={subject.referenceImageUrl} alt={subject.name} className="mb-2 h-32 w-full rounded object-cover" />
              )}
              {subject.identityPrompt && (
                <p className="line-clamp-2 text-xs text-muted-foreground">{subject.identityPrompt}</p>
              )}
              {subject.tags && subject.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {subject.tags.map(tag => <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>)}
                </div>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                使用
                {subject.usageCount}
                {' '}
                次
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <AlertDialog
        open={deleteConfirmId !== null}
        onOpenChange={(open) => {
          if (!open)
            setDeleteConfirmId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>确定要删除这个主体资产吗？此操作不可撤销。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteConfirmId(null)}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (deleteConfirmId)
                  deleteMutation.mutate(deleteConfirmId)
                setDeleteConfirmId(null)
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
