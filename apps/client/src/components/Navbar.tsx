import type { NotificationItem } from '@/api/notifications'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Beaker,
  Bell,
  CheckCheck,
  Clapperboard,
  ClosedCaption,
  Code2,
  Film,
  FolderOpen,
  Gauge,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Map,
  Receipt,
  ShieldCheck,
  Wallet,
  XCircle,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { NavLink, useNavigate } from 'react-router'
import {
  fetchNotifications,
  fetchNotificationUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/api/notifications'
import { notificationQueryKeys } from '@/api/query-client'
import { resolveNotificationTarget } from '@/lib/notification-target'
import { useAuth } from '../auth/AuthContext'
import { Button } from './ui/button'

const NAV_ITEMS = [
  { to: '/', label: '工作台', icon: LayoutDashboard },
  { to: '/canvas', label: '画布', icon: Map },
  { to: '/subtitle', label: '加字幕', icon: ClosedCaption },
  { to: '/assets', label: '资产', icon: FolderOpen },
  { to: '/billing', label: '计费', icon: Receipt },
  { to: '/api-keys', label: 'API Keys', icon: KeyRound },
  { to: '/developers', label: '开发者', icon: Code2 },
  { to: '/model-lab', label: 'Model Lab', icon: Beaker },
  { to: '/admin', label: '管理', icon: ShieldCheck },
] as const

/** 通知类型 → 图标 + 主色 */
const TYPE_META: Record<string, { icon: typeof Bell, color: string }> = {
  task_completed: { icon: CheckCheck, color: 'text-green-600' },
  task_failed: { icon: XCircle, color: 'text-red-600' },
  canvas_completed: { icon: Film, color: 'text-blue-600' },
  balance_warning: { icon: Wallet, color: 'text-orange-600' },
  api_key_expired: { icon: Clapperboard, color: 'text-purple-600' },
  api_key_quota: { icon: Gauge, color: 'text-orange-600' },
  provider_anomaly: { icon: AlertTriangle, color: 'text-red-600' },
  system: { icon: Bell, color: 'text-muted-foreground' },
}

function formatRelativeTime(iso: string): string {
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

export default function Navbar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // 未读数角标 — 页面加载时即获取
  const { data: unreadCount = 0 } = useQuery({
    queryKey: notificationQueryKeys.unread,
    queryFn: fetchNotificationUnreadCount,
    enabled: !!user,
  })

  const [open, setOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // 通知列表 — 下拉展开时启用
  const { data: items = [], isLoading: listLoading } = useQuery({
    queryKey: notificationQueryKeys.list,
    queryFn: fetchNotifications,
    enabled: open && !!user,
  })

  // 单条已读 mutation
  const markReadMutation = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationQueryKeys.unread })
      queryClient.invalidateQueries({ queryKey: notificationQueryKeys.list })
    },
  })

  // 全部已读 mutation
  const markAllReadMutation = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
      // 乐观更新：先就地更新缓存，再 invalidate 确保一致性
      queryClient.setQueryData<NotificationItem[]>(notificationQueryKeys.list, (old) => {
        if (!old)
          return old
        return old.map(n => ({ ...n, read: true }))
      })
      queryClient.setQueryData<number>(notificationQueryKeys.unread, 0)
      queryClient.invalidateQueries({ queryKey: notificationQueryKeys.unread })
      queryClient.invalidateQueries({ queryKey: notificationQueryKeys.list })
    },
  })

  // 点击外部关闭下拉
  useEffect(() => {
    if (!open)
      return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node))
        setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function handleClickItem(n: NotificationItem) {
    if (!n.read)
      markReadMutation.mutate(n.id)
    const target = resolveNotificationTarget(n)
    setOpen(false)
    if (target)
      navigate(target)
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-7xl items-center px-4">
        <span className="mr-6 text-lg font-bold tracking-tight">Excuse</span>
        <nav className="flex items-center gap-1">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                }`}
            >
              <Icon className="size-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* 右侧用户区域 */}
        {user && (
          <div className="ml-auto flex items-center gap-3">
            <div ref={dropdownRef} className="relative">
              <Button variant="ghost" size="icon" title="通知" onClick={() => setOpen(v => !v)}>
                <Bell className="size-4" />
              </Button>
              {unreadCount > 0 && (
                <span className="pointer-events-none absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}

              {/* 通知下拉面板 */}
              {open && (
                <div className="absolute right-0 top-12 z-50 w-80 rounded-lg border bg-background shadow-lg">
                  <div className="flex items-center justify-between border-b px-3 py-2">
                    <span className="text-sm font-medium">通知</span>
                    {unreadCount > 0 && (
                      <button
                        onClick={() => markAllReadMutation.mutate()}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        全部已读
                      </button>
                    )}
                  </div>

                  <div className="max-h-[420px] overflow-auto">
                    {items.length === 0
                      ? (
                          <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                            {listLoading ? '加载中...' : '暂无通知'}
                          </p>
                        )
                      : (
                          items.map((n) => {
                            const Icon = TYPE_META[n.type]?.icon ?? Bell
                            return (
                              <button
                                key={n.id}
                                onClick={() => handleClickItem(n)}
                                className={`flex w-full items-start gap-2 border-b px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-accent/50 ${
                                  !n.read ? 'bg-accent/20' : ''
                                }`}
                              >
                                <Icon className={`mt-0.5 size-4 shrink-0 ${TYPE_META[n.type]?.color ?? ''}`} />
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5">
                                    {!n.read && <span className="size-1.5 shrink-0 rounded-full bg-blue-500" />}
                                    <span className="truncate text-xs font-medium">{n.title}</span>
                                  </div>
                                  {n.body && (
                                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.body}</p>
                                  )}
                                  <span className="mt-0.5 block text-[10px] text-muted-foreground">
                                    {formatRelativeTime(n.createdAt)}
                                  </span>
                                </div>
                              </button>
                            )
                          })
                        )}
                  </div>
                </div>
              )}
            </div>
            <span className="text-sm text-muted-foreground">{user.username}</span>
            <Button variant="ghost" size="icon" onClick={logout} title="退出登录">
              <LogOut className="size-4" />
            </Button>
          </div>
        )}
      </div>
    </header>
  )
}
