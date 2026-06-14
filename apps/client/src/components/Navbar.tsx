import type { NotificationItem } from '../stores/notifications'
import { Bell, CheckCheck, Clapperboard, ClosedCaption, Film, FolderOpen, LayoutDashboard, LogOut, Map, Receipt, Wallet, XCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { NavLink, useNavigate } from 'react-router'
import { useAuth } from '../auth/AuthContext'
import { useNotificationsStore } from '../stores/notifications'
import { Button } from './ui/button'

const NAV_ITEMS = [
  { to: '/', label: '工作台', icon: LayoutDashboard },
  { to: '/canvas', label: '画布', icon: Map },
  { to: '/subtitle', label: '加字幕', icon: ClosedCaption },
  { to: '/assets', label: '资产', icon: FolderOpen },
  { to: '/billing', label: '计费', icon: Receipt },
] as const

/** 通知类型 → 图标 + 主色 */
const TYPE_META: Record<string, { icon: typeof Bell, color: string }> = {
  task_completed: { icon: CheckCheck, color: 'text-green-600' },
  task_failed: { icon: XCircle, color: 'text-red-600' },
  canvas_completed: { icon: Film, color: 'text-blue-600' },
  balance_warning: { icon: Wallet, color: 'text-orange-600' },
  api_key_expired: { icon: Clapperboard, color: 'text-purple-600' },
  system: { icon: Bell, color: 'text-muted-foreground' },
}

/** 点击定位 — 根据类型 + meta 决定跳转目标 */
function resolveTarget(n: NotificationItem): string | undefined {
  if (n.type === 'canvas_completed' && n.meta?.projectId)
    return `/canvas/${n.meta.projectId}`
  if (n.type === 'balance_warning')
    return '/billing'
  if (n.type === 'task_completed' || n.type === 'task_failed')
    return n.meta?.recordId ? `/?record=${n.meta.recordId}` : '/'
  return undefined
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
  const unreadCount = useNotificationsStore(s => s.unreadCount)
  const items = useNotificationsStore(s => s.items)
  const loaded = useNotificationsStore(s => s.loaded)
  const fetchList = useNotificationsStore(s => s.fetchList)
  const fetchUnread = useNotificationsStore(s => s.fetchUnread)
  const markRead = useNotificationsStore(s => s.markRead)
  const markAllRead = useNotificationsStore(s => s.markAllRead)

  const [open, setOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // 挂载时拉取未读数（角标）
  useEffect(() => {
    if (user)
      fetchUnread()
  }, [user, fetchUnread])

  // 首次展开时加载列表
  useEffect(() => {
    if (open && !loaded)
      fetchList()
  }, [open, loaded, fetchList])

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
      markRead(n.id)
    const target = resolveTarget(n)
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

              {/* 通知下拉面板（P2-2） */}
              {open && (
                <div className="absolute right-0 top-12 z-50 w-80 rounded-lg border bg-background shadow-lg">
                  <div className="flex items-center justify-between border-b px-3 py-2">
                    <span className="text-sm font-medium">通知</span>
                    {unreadCount > 0 && (
                      <button
                        onClick={() => markAllRead()}
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
                            {loaded ? '暂无通知' : '加载中...'}
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
