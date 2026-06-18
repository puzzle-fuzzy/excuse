/**
 * Web Vitals 性能监控 — 使用 PerformanceObserver API 收集 LCP / INP / CLS 指标，
 * 上报到 /api/client-errors 端点（复用已有前端错误上报管线）。
 *
 * 无外部依赖，不阻塞页面渲染。
 */

interface MetricReport {
  name: string
  value: number
  rating: 'good' | 'needs-improvement' | 'poor'
}

function rating(name: string, value: number): MetricReport['rating'] {
  // Google 定义的 Web Vitals 阈值
  switch (name) {
    case 'LCP':
      return value <= 2500 ? 'good' : value <= 4000 ? 'needs-improvement' : 'poor'
    case 'INP':
      return value <= 200 ? 'good' : value <= 500 ? 'needs-improvement' : 'poor'
    case 'CLS':
      return value <= 0.1 ? 'good' : value <= 0.25 ? 'needs-improvement' : 'poor'
    default:
      return 'needs-improvement'
  }
}

function sendMetric(metric: MetricReport) {
  try {
    fetch('/api/client-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `Web Vital: ${metric.name}`,
        stack: `value: ${metric.value}, rating: ${metric.rating}`,
        url: window.location.href,
        userAgent: navigator.userAgent,
      }),
    }).catch(() => {})
  }
  catch {
    // 安全兜底
  }
}

/** 上报 single entry 指标（LCP, FID → INP） */
function observeSingleEntry(name: string, type: string): void {
  try {
    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries()
      const last = entries[entries.length - 1] as PerformanceEntry | undefined
      if (last) {
        const value = name === 'CLS' ? (last as any).value : last.startTime
        sendMetric({ name, value: Math.round(value), rating: rating(name, value) })
      }
    })
    observer.observe({ type, buffered: true })
  }
  catch {
    // 浏览器不支持该 observer type
  }
}

/** 报告 CLS（累积布局偏移） */
function observeCLS(): void {
  try {
    let clsValue = 0
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!(entry as any).hadRecentInput)
          clsValue += (entry as any).value
      }
    })
    observer.observe({ type: 'layout-shift', buffered: true })

    // 页面卸载时最终上报
    window.addEventListener('beforeunload', () => {
      sendMetric({
        name: 'CLS',
        value: Math.round(clsValue * 1000) / 1000,
        rating: rating('CLS', clsValue),
      })
    })
  }
  catch {
    // 浏览器不支持
  }
}

/**
 * 启动 Web Vitals 采集与上报，应在应用入口处调用一次。
 */
export function reportWebVitals(): void {
  // 确保只在浏览器环境运行
  if (typeof window === 'undefined' || !('PerformanceObserver' in window))
    return

  // LCP（最大内容绘制）
  observeSingleEntry('LCP', 'largest-contentful-paint')

  // INP（下次绘制交互，替代 FID）
  observeSingleEntry('INP', 'first-input')

  // CLS（累积布局偏移——需累加所有 layout-shift 条目）
  observeCLS()
}
