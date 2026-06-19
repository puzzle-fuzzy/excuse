/**
 * API 核心基础设施 — token 管理、URL 解析、Eden Treaty 客户端 + 响应解包
 *
 * 从用户端 client.ts 拆出的纯工具层。管理端不使用 SSE，故 token 仅做内存留存
 * （httpOnly cookie 负责实际鉴权），不再联动 sseClient。
 */
import type { App } from '../../../server/src/index'
import { treaty } from '@elysia/eden'

// ===== Token 管理 =====

/**
 * 认证 token — 仅存内存。
 * 管理端所有 API 请求通过 httpOnly cookie 自动认证（无需手动设置 header）。
 * 保留该内存槽仅为与 AuthProvider 的登录/登出流程保持一致。
 */
let authToken: string | null = null

/** 设置认证 token（内存） */
export function setAuthToken(token: string | null) {
  authToken = token
}

/** 获取当前 token */
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
 * 错误处理策略：
 *   - 401/403: 认证问题，触发登录态清理（管理端额外提示「无权访问」由组件渲染）
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

    // 401/403: 认证已过期或无权限，清理登录态并通知 AuthProvider 跳转
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
