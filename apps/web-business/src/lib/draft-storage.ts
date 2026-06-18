/**
 * 草稿保护 — sessionStorage 持久化 + beforeunload 拦截
 *
 * 防止用户在长输入（Canvas 故事文本、Workspace prompt）误点导航后丢失内容。
 * sessionStorage 在浏览器标签页关闭时自动清除，无需手动清理。
 */

const DRAFT_PREFIX = 'excuse_draft:'

/** 读取 sessionStorage 中的草稿值，不存在则返回 defaultValue */
export function loadDraft(key: string, defaultValue: string = ''): string {
  try {
    return sessionStorage.getItem(DRAFT_PREFIX + key) ?? defaultValue
  }
  catch {
    return defaultValue
  }
}

/** 写入（非空）或清除（空）草稿到 sessionStorage */
export function saveDraft(key: string, value: string): void {
  try {
    if (value) {
      sessionStorage.setItem(DRAFT_PREFIX + key, value)
    }
    else {
      sessionStorage.removeItem(DRAFT_PREFIX + key)
    }
  }
  catch { /* quota exceeded — 静默吞，不能因为存储问题阻塞用户操作 */ }
}

/** 清除指定草稿（用户在对应场景完成提交后调用） */
export function clearDraft(key: string): void {
  try {
    sessionStorage.removeItem(DRAFT_PREFIX + key)
  }
  catch { /* noop */ }
}

/**
 * 注册 beforeunload 监听器：草稿非空时拦截页面关闭/刷新。
 * 返回 cleanup 函数。
 */
export function guardBeforeUnload(predicate: () => boolean): () => void {
  const handler = (e: BeforeUnloadEvent) => {
    if (predicate()) {
      e.preventDefault()
      e.returnValue = '' // Chrome 需要设置 returnValue
    }
  }
  window.addEventListener('beforeunload', handler)
  return () => window.removeEventListener('beforeunload', handler)
}
