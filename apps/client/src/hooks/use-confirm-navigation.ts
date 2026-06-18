import { useEffect } from 'react'

/**
 * 未保存更改时拦截离开 — 在声明式 `<Routes>` 路由下提供 SPA 导航守卫
 *
 * 背景：react-router 的 `useBlocker` 需要 data router（`createBrowserRouter`），
 * 而本应用当前是 `<BrowserRouter>` + `<Routes>` 声明式路由（AuthProvider 内部用了
 * `useNavigate`，整体迁移 data router 的回归面过大）。本 hook 用更轻量、自包含的方式
 * 覆盖主要数据丢失场景：
 *
 *   1. `beforeunload` — 刷新页面 / 关闭标签 / 导航到外部站点
 *   2. 点击导航链接（Navbar 的 `<Link>` / 普通 `<a>`）— 在 capture 阶段 `preventDefault`，
 *      react-router 会因 `event.defaultPrevented` 主动跳过本次导航，无 router 状态错乱
 *
 * 不覆盖：浏览器后退/前进按钮（`popstate`）——在无 data router 时无法可靠回滚且会与
 * react-router 内部状态失同步。未来若迁移 data router，应改用 `useBlocker` 并删除本 hook。
 *
 * @param isDirty 是否有未保存更改（为 false 时完全不拦截，也不注册任何监听器）
 * @param message 确认提示文案
 */
export function useConfirmNavigation(isDirty: boolean, message: string) {
  useEffect(() => {
    if (!isDirty)
      return

    // 1) 刷新 / 关闭 / 外部跳转
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      // 部分浏览器需要 returnValue 才会弹出原生提示
      e.returnValue = message
    }
    window.addEventListener('beforeunload', onBeforeUnload)

    // 2) 应用内导航链接点击
    const onNavigationClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0)
        return
      const anchor = (e.target as HTMLElement | null)?.closest('a')
      if (!anchor)
        return
      const href = anchor.getAttribute('href')
      // 仅拦截站内路径跳转：外部 URL、纯 hash、空链接放行
      if (!href || href.startsWith('http') || href.startsWith('//') || href.startsWith('#') || href.startsWith('mailto:'))
        return
      // 仅 pathname 不同才算离开；query/hash 变化（仍在当前页）不拦截
      const target = new URL(href, window.location.href)
      if (target.pathname === window.location.pathname)
        return
      if (!window.confirm(message)) { // eslint-disable-line no-alert -- SPA 导航拦截需要原生 confirm
        // react-router 的 <Link> onClick 会检测 defaultPrevented 并放弃导航
        e.preventDefault()
        e.stopPropagation()
      }
    }
    document.addEventListener('click', onNavigationClick, true)

    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onNavigationClick, true)
    }
  }, [isDirty, message])
}
