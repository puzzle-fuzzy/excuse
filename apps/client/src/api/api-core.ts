/**
 * API 核心基础设施 — token 管理、URL 解析、Eden Treaty 客户端 + 响应解包
 *
 * 从 client.ts 拆出的纯工具层，不含任何业务函数。
 * client.ts 经 `export * from './api-core'` 桶式导出，消费者无需改 import 路径。
 * 所有领域 API 文件（billing-api、canvas-api 等）从此处导入 `api` 和 `unwrapEden`，
 * 避免与 client.ts 桶式 re-export 产生循环依赖。
 */
import type { App } from '../../../server/src/index'
import { treaty } from '@elysia/eden'
import { sseClient } from './sse'

// ===== Token 管理 =====

/**
 * 认证 token — 仅存内存，用于 SSE Authorization header
 * 浏览器 API 请求通过 httpOnly cookie 自动认证（无需手动设置 header）
 */
let authToken: string | null = null

/** 设置认证 token（内存 + 联动 SSE 连接） */
export function setAuthToken(token: string | null) {
  authToken = token
  if (token) {
    sseClient.connect()
  }
  else {
    sseClient.disconnect()
  }
}

/** 获取当前 token（SSE 使用） */
export function getAuthToken() {
  return authToken
}

// ===== API Base URL 解析 =====

function normalizeApiBaseUrl(baseUrl: string | undefined): string {
  if (!baseUrl)
    return ''
  return baseUrl.replace(/\/api\/?$/, '')
}

export function resolveApiBaseUrl() {
  const normalized = normalizeApiBaseUrl(import.meta.env.VITE_API_BASE_URL)
  if (normalized)
    return normalized
  if (typeof window !== 'undefined' && window.location?.origin)
    return window.location.origin
  return 'http://localhost:5007'
}

// ===== Eden 响应解包 =====

/**
 * Eden 响应中的错误结构
 * Eden 将非 2xx 响应包装为 { status, statusText, headers, ... } 等
 */
interface EdenError {
  status?: number
  statusText?: string
  message?: string
  value?: unknown
}

interface ApiErrorValue {
  error: string
}

function isApiErrorValue(value: unknown): value is ApiErrorValue {
  return typeof value === 'object'
    && value !== null
    && 'error' in value
    && typeof value.error === 'string'
}

/**
 * 解包 Eden Treaty 响应：提取 data 或抛出结构化错误
 *
 * Eden 返回 { data, error }，data 类型是 Eden 从 Elysia 推导的，
 * 与 @excuse/shared 的类型有细微结构差异无法直接赋值。
 * 此函数将 data 转为 shared 包定义的类型 T，封装必要的转换。
 *
 * 错误处理策略：
 *   - 401/403: 认证问题，触发登录态清理
 *   - 422: 参数校验失败，展示具体字段错误
 *   - 其他: 展示通用错误消息
 */
export function unwrapEden<T>(response: { data: unknown, error: unknown }): T {
  if (response.error) {
    const edenErr = response.error as EdenError
    const message = isApiErrorValue(edenErr.value)
      ? edenErr.value.error || edenErr.statusText || '请求失败'
      : edenErr.message || edenErr.statusText || '请求失败'
    const error = new Error(message) as Error & { status?: number }
    error.status = edenErr.status

    // 401/403: 认证已过期，清理登录态并通知 AuthProvider 跳转
    if (edenErr.status === 401 || edenErr.status === 403) {
      setAuthToken(null)
      window.dispatchEvent(new CustomEvent('auth:unauthorized'))
    }

    throw error
  }
  return response.data as T
}

// ===== Eden Treaty 客户端 =====

export const api = treaty<App>(resolveApiBaseUrl())
