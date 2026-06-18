import type { NotificationItem } from '@/api/notifications'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Beaker,
  Bell,
  CheckCheck,
  ChevronDown,
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
  Menu,
  Moon,
  Receipt,
  ShieldCheck,
  Sun,
  Wallet,
  XCircle,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { useEffect, useRef, useState } from 'react'
import { NavLink, useNavigate } from 'react-router'
import {
  fetchNotifications,
  fetchNotificationUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/api/notifications'
import { notificationQueryKeys } from '@/api/query-client'
import ConnectionIndicator from '@/components/ConnectionIndicator'
import EmptyState from '@/components/EmptyState'
import { formatRelativeTime } from '@/lib/format-time'
import { resolveNotificationTarget } from '@/lib/notification-target'
import { statusDotClass, statusTextClass } from '@/lib/status-tokens'
import { useAuth } from '../auth/AuthContext'
import { Button } from './ui/button'

/** 主导航项目（始终显示，前 6 个） */
const PRIMARY_NAV_ITEMS = [
  { to: '/', label: '工作台', icon: LayoutDashboard },
  { to: '/canvas', label: '画布', icon: Map },
  { to: '/subtitle', label: '加字幕', icon: ClosedCaption },
  { to: '/assets', label: '资产', icon: FolderOpen },
  { to: '/billing', label: '计费', icon: Receipt },
  { to: '/model-lab', label: 'Model Lab', icon: Beaker },
] as const

/** 次要导航（折叠到「更多」下拉中） */
const MORE_NAV_ITEMS = [
  { to: '/subjects', label: '资产库', icon: FolderOpen },
  { to: '/api-keys', label: 'API Keys', icon: KeyRound },
  { to: '/developers', label: '开发者', icon: Code2 },
  { to: '/admin', label: '管理', icon: ShieldCheck },
] as const

/** 通知类型 → 图标 + 主色 */
const TYPE_META: Record<string, { icon: typeof Bell, color: string }> = {
  task_completed: { icon: CheckCheck, color: statusTextClass('success') },
  task_failed: { icon: XCircle, color: statusTextClass('danger') },
  canvas_completed: { icon: Film, color: statusTextClass('info') },
  balance_warning: { icon: Wallet, color: 'text-orange-600' },
  api_key_expired: { icon: Clapperboard, color: 'text-purple-600' },
  api_key_quota: { icon: Gauge, color: 'text-orange-600' },
  provider_anomaly: { icon: AlertTriangle, color: statusTextClass('danger') },
  system: { icon: Bell, color: 'text-muted-foreground' },
}

export default function Navbar() {
  const { user, logout } = useAuth()
  const { resolvedTheme, setTheme } = useTheme()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // 未读数角标 — 页面加载时即获取
  const { data: unreadCount = 0 } = useQuery({
    queryKey: notificationQueryKeys.unread,
    queryFn: fetchNotificationUnreadCount,
    enabled: !!user,
  })

  const [open, setOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const moreDropdownRef = useRef<HTMLDivElement>(null)

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

  // 点击外部关闭通知下拉
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

  // 点击外部关闭「更多」下拉
  useEffect(() => {
    if (!moreOpen)
      return
    const handler = (e: MouseEvent) => {
      if (moreDropdownRef.current && !moreDropdownRef.current.contains(e.target as Node))
        setMoreOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [moreOpen])

  function handleClickItem(n: NotificationItem) {
    if (!n.read)
      markReadMutation.mutate(n.id)
    const target = resolveNotificationTarget(n)
    setOpen(false)
    if (target)
      navigate(target)
  }

  const isDark = resolvedTheme === 'dark'

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-7xl items-center px-4">
        <span className="mr-6 text-lg font-bold tracking-tight">Excuse</span>
        <nav className="flex items-center gap-1">
          {PRIMARY_NAV_ITEMS.map(({ to, label, icon: Icon }) => (
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

          {/* 「更多」折叠下拉 */}
          <div ref={moreDropdownRef} className="relative">
            <button
              type="button"
              onClick={() => setMoreOpen(v => !v)}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                moreOpen
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
              }`}
              aria-label="更多导航"
              title="更多导航"
            >
              <Menu className="size-4" />
              更多
              <ChevronDown className={`size-3 transition-transform ${moreOpen ? 'rotate-180' : ''}`} />
            </button>
            {moreOpen && (
              <div className="absolute left-0 top-11 z-50 w-40 rounded-lg border bg-background shadow-lg py-1">
                {MORE_NAV_ITEMS.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    onClick={() => setMoreOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                        isActive
                          ? 'bg-accent text-accent-foreground'
                          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                      }`}
                  >
                    <Icon className="size-4" />
                    {label}
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        </nav>

        {/* 右侧用户区域 */}
        {user && (
          <div className="ml-auto flex items-center gap-3">
            {/* SSE/轮询连接状态指示器 */}
            <ConnectionIndicator />
            <Button
              variant="ghost"
              size="icon"
              aria-label={isDark ? '切换到浅色模式' : '切换到深色模式'}
              title={isDark ? '切换到浅色模式' : '切换到深色模式'}
              onClick={() => setTheme(isDark ? 'light' : 'dark')}
            >
              {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
            <div ref={dropdownRef} className="relative">
              <Button variant="ghost" size="icon" title="通知" aria-label="通知" onClick={() => setOpen(v => !v)}>
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
                          listLoading
                            ? <p className="px-3 py-8 text-center text-xs text-muted-foreground">加载中...</p>
                            : <EmptyState icon={Bell} title="暂无通知" />
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
                                    {!n.read && <span className={statusDotClass('info', 'size-1.5 shrink-0 rounded-full')} />}
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
            <Button variant="ghost" size="icon" onClick={logout} title="退出登录" aria-label="退出登录">
              <LogOut className="size-4" />
            </Button>
          </div>
        )}
      </div>
    </header>
  )
}
