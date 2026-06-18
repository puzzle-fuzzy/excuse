import { useRealtimeSync } from '@/stores/realtime-sync'

const MODE_CONFIG = {
  sse: { color: 'bg-green-500', label: '实时连接' },
  polling: { color: 'bg-yellow-500', label: '轮询降级' },
  disconnected: { color: 'bg-red-500', label: '连接断开' },
} as const

/**
 * SSE 连接状态指示器 — 绿色=实时 / 黄色=轮询降级 / 红色=断开
 *
 * 放在 Navbar 右侧，用户无需进入特定页面即可感知实时推送的可用性。
 * 鼠标悬停显示当前模式文字说明。
 */
export default function ConnectionIndicator() {
  const connectionMode = useRealtimeSync(s => s.connectionMode)
  const cfg = MODE_CONFIG[connectionMode]

  return (
    <span
      className="group relative flex items-center"
      title={cfg.label}
    >
      <span className={`size-2 rounded-full ${cfg.color} shadow-sm`} />
      <span className="pointer-events-none absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-popover px-2 py-1 text-[10px] text-popover-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
        {cfg.label}
      </span>
    </span>
  )
}
