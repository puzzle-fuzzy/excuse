import type { LucideIcon } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Beaker,
  Bell,
  ChevronRight,
  Code2,
  CreditCard,
  FolderOpen,
  Home,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  ShieldCheck,
  Sparkles,
  Subtitles,
  Sun,
  Video,
  X,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { fetchNotifications, fetchNotificationUnreadCount, markAllNotificationsRead, markNotificationRead } from '@/api/notifications'
import { notificationQueryKeys } from '@/api/query-client'
import { useAuth } from '@/auth/AuthContext'
import ConnectionIndicator from '@/components/ConnectionIndicator'
import EmptyState from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { formatRelativeTime } from '@/lib/format-time'
import { resolveNotificationTarget } from '@/lib/notification-target'
import { cn } from '@/lib/utils'

interface NavItem {
  to: string
  label: string
  description: string
  icon: LucideIcon
  end?: boolean
}

const PRIMARY_NAV: NavItem[] = [
  { to: '/', label: '总览', description: '生产总览', icon: Home, end: true },
  { to: '/create', label: '创作', description: '快速生成', icon: Sparkles },
  { to: '/canvas', label: 'Canvas', description: '故事成片', icon: Video },
  { to: '/subtitle', label: '字幕', description: '字幕处理', icon: Subtitles },
  { to: '/assets', label: '资产', description: '资产管理', icon: FolderOpen },
  { to: '/billing', label: '账单', description: '成本与余额', icon: CreditCard },
]

const SECONDARY_NAV: NavItem[] = [
  { to: '/api-keys', label: 'API 密钥', description: '接口密钥', icon: KeyRound },
  { to: '/developers', label: '开发者', description: '开发文档', icon: Code2 },
  { to: '/model-lab', label: '模型实验室', description: '模型实验', icon: Beaker },
  { to: '/admin', label: '后台管理', description: '运营后台', icon: ShieldCheck },
]

const PAGE_TITLES: Array<{ match: RegExp, title: string, subtitle: string }> = [
  { match: /^\/$/, title: '生产总览', subtitle: '今天的任务、资产和恢复动作' },
  { match: /^\/create/, title: '创作', subtitle: '从 prompt 和参考素材开始生成' },
  { match: /^\/canvas\/[^/]+/, title: 'Canvas 项目', subtitle: '管理故事到成片的流水线' },
  { match: /^\/canvas/, title: 'Canvas', subtitle: '故事、角色、场景和镜头项目' },
  { match: /^\/subtitle/, title: '字幕', subtitle: '转写、编辑并烧录字幕' },
  { match: /^\/assets/, title: '资产库', subtitle: '管理、追溯和复用所有产物' },
  { match: /^\/billing/, title: '账单', subtitle: '余额、冻结金额和成本明细' },
  { match: /^\/api-keys/, title: 'API 密钥', subtitle: '管理 OpenAI 兼容接口访问' },
  { match: /^\/developers/, title: '开发者', subtitle: '接口说明和接入信息' },
  { match: /^\/model-lab/, title: '模型实验室', subtitle: '内部模型实验与默认配置' },
  { match: /^\/admin/, title: '后台管理', subtitle: '运营、Provider 和审计视图' },
]

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <Link to="/" onClick={onNavigate} className="flex h-16 items-center gap-3 px-4">
        <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground">
          <LayoutDashboard className="size-4" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold tracking-tight">Excuse</span>
          <span className="block truncate text-xs text-muted-foreground">Creative production</span>
        </span>
      </Link>

      <nav className="flex-1 space-y-1 px-3 py-2">
        {PRIMARY_NAV.map(item => (
          <ShellNavLink key={item.to} item={item} onNavigate={onNavigate} />
        ))}
      </nav>

      <div className="border-t px-3 py-3">
        <div className="mb-2 px-2 text-xs font-medium text-muted-foreground">系统与配置</div>
        <div className="space-y-1">
          {SECONDARY_NAV.map(item => (
            <ShellNavLink key={item.to} item={item} compact onNavigate={onNavigate} />
          ))}
        </div>
      </div>
    </div>
  )
}

function ShellNavLink({ item, compact = false, onNavigate }: { item: NavItem, compact?: boolean, onNavigate?: () => void }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) => cn(
        'group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
        isActive
          ? 'bg-sidebar-accent font-semibold text-sidebar-accent-foreground'
          : 'text-sidebar-foreground/72 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground',
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{item.label}</span>
        {!compact && <span className="block truncate text-[11px] text-muted-foreground">{item.description}</span>}
      </span>
    </NavLink>
  )
}

function Topbar({ onOpenMobile }: { onOpenMobile: () => void }) {
  const { user, logout } = useAuth()
  const { resolvedTheme, setTheme } = useTheme()
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const notificationsRef = useRef<HTMLDivElement>(null)
  const page = useMemo(
    () => PAGE_TITLES.find(item => item.match.test(location.pathname)) ?? PAGE_TITLES[0],
    [location.pathname],
  )

  const { data: unreadCount = 0 } = useQuery({
    queryKey: notificationQueryKeys.unread,
    queryFn: fetchNotificationUnreadCount,
    enabled: !!user,
  })

  const { data: notifications = [], isLoading: notificationsLoading } = useQuery({
    queryKey: notificationQueryKeys.list,
    queryFn: fetchNotifications,
    enabled: notificationsOpen && !!user,
  })

  const markReadMutation = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationQueryKeys.unread })
      queryClient.invalidateQueries({ queryKey: notificationQueryKeys.list })
    },
  })

  const markAllReadMutation = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
      queryClient.setQueryData<number>(notificationQueryKeys.unread, 0)
      queryClient.invalidateQueries({ queryKey: notificationQueryKeys.unread })
      queryClient.invalidateQueries({ queryKey: notificationQueryKeys.list })
    },
  })

  useEffect(() => {
    if (!notificationsOpen)
      return
    const handler = (event: MouseEvent) => {
      if (notificationsRef.current && !notificationsRef.current.contains(event.target as Node))
        setNotificationsOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [notificationsOpen])

  function openNotification(notification: typeof notifications[number]) {
    if (!notification.read)
      markReadMutation.mutate(notification.id)
    const target = resolveNotificationTarget(notification)
    setNotificationsOpen(false)
    if (target)
      navigate(target)
  }

  const isDark = resolvedTheme === 'dark'

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center border-b bg-background/92 px-4 backdrop-blur">
      <Button variant="ghost" size="icon-sm" className="mr-2 lg:hidden" onClick={onOpenMobile} aria-label="打开导航">
        <Menu className="size-4" />
      </Button>

      <div className="min-w-0">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>Excuse</span>
          <ChevronRight className="size-3" />
          <span className="truncate">{page?.title}</span>
        </div>
        <div className="truncate text-sm font-semibold tracking-tight">{page?.subtitle}</div>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Button asChild variant="outline" size="sm" className="hidden md:inline-flex">
          <Link to="/create">
            <Sparkles className="size-3.5" />
            新建生成
          </Link>
        </Button>
        <ConnectionIndicator />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={isDark ? '切换到浅色模式' : '切换到深色模式'}
          onClick={() => setTheme(isDark ? 'light' : 'dark')}
        >
          {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>
        <div ref={notificationsRef} className="relative">
          <Button
            variant="ghost"
            size="icon-sm"
            className="relative"
            aria-label="打开通知"
            aria-expanded={notificationsOpen}
            onClick={() => setNotificationsOpen(open => !open)}
          >
            <Bell className="size-4" />
            {unreadCount > 0 && (
              <span className="absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </Button>
          {notificationsOpen && (
            <div className="absolute right-0 top-11 z-50 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-[var(--shadow-floating)]">
              <div className="flex items-center justify-between border-b px-3 py-2">
                <div>
                  <div className="text-sm font-semibold">通知</div>
                  <div className="text-xs text-muted-foreground">任务、成本和恢复提醒</div>
                </div>
                {unreadCount > 0 && (
                  <Button variant="ghost" size="sm" onClick={() => markAllReadMutation.mutate()}>
                    全部已读
                  </Button>
                )}
              </div>
              <div className="max-h-[420px] overflow-auto">
                {notificationsLoading
                  ? (
                      <div className="space-y-2 p-3">
                        {Array.from({ length: 3 }, (_, index) => (
                          <div key={index} className="h-12 animate-pulse rounded-lg bg-muted" />
                        ))}
                      </div>
                    )
                  : notifications.length === 0
                    ? <EmptyState icon={Bell} title="暂无通知" description="任务完成、失败和余额提醒会出现在这里。" />
                    : notifications.map(notification => (
                        <button
                          key={notification.id}
                          type="button"
                          onClick={() => openNotification(notification)}
                          className={cn(
                            'flex w-full items-start gap-3 border-b px-3 py-3 text-left transition-colors last:border-b-0 hover:bg-muted/55',
                            !notification.read && 'bg-muted/35',
                          )}
                        >
                          <span className={cn('mt-1 size-2 rounded-full', notification.read ? 'bg-muted-foreground/30' : 'bg-primary')} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{notification.title}</span>
                            {notification.body && <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{notification.body}</span>}
                            <span className="mt-1 block text-[11px] text-muted-foreground">{formatRelativeTime(notification.createdAt)}</span>
                          </span>
                        </button>
                      ))}
              </div>
            </div>
          )}
        </div>
        <div className="hidden items-center gap-2 border-l pl-3 sm:flex">
          <div className="grid size-8 place-items-center rounded-lg bg-secondary text-xs font-semibold text-secondary-foreground">
            {user?.username?.slice(0, 1).toUpperCase() ?? 'U'}
          </div>
          <div className="hidden min-w-0 xl:block">
            <div className="truncate text-xs font-medium">{user?.username ?? 'User'}</div>
            <div className="truncate text-[11px] text-muted-foreground">{user?.email ?? 'Signed in'}</div>
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={logout} aria-label="退出登录">
          <LogOut className="size-4" />
        </Button>
      </div>
    </header>
  )
}

export default function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="min-h-screen bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 z-50 hidden w-64 border-r bg-sidebar text-sidebar-foreground lg:block">
        <SidebarNav />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-foreground/20"
            onClick={() => setMobileOpen(false)}
            aria-label="关闭导航遮罩"
          />
          <aside className="absolute inset-y-0 left-0 w-72 border-r bg-sidebar text-sidebar-foreground shadow-xl">
            <div className="absolute right-3 top-3">
              <Button variant="ghost" size="icon-sm" onClick={() => setMobileOpen(false)} aria-label="关闭导航">
                <X className="size-4" />
              </Button>
            </div>
            <SidebarNav onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        <Topbar onOpenMobile={() => setMobileOpen(true)} />
        <main className="min-h-[calc(100vh-4rem)]">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
