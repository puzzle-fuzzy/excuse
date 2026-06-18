import type { BillingBalanceResponse, BillingStatisticsResponse, BillingTransactionsResponse, GenerationRecord, OpenAIGatewayUsageResponse } from '@excuse/shared'
import type { App } from '../../../server/src/index'
import { treaty } from '@elysia/eden'
import { sseClient } from './sse'

/**
 * Eden Treaty 客户端 — 端到端类型安全
 *
 * 通过 Vite 代理 (/api → localhost:5007) 与后端通信
 * 类型从 Drizzle schema → @excuse/db → @excuse/shared 单向推导
 *
 * 本文件仅保留核心基础设施（Eden 实例 + unwrapEden + token 管理）
 * 和少量未拆分的 billing/gateway 函数。领域 API 已拆分为：
 *   - auth-api.ts      认证（注册/登录/登出/忘记密码/重置密码）
 *   - generation-api.ts  生成 + 记录 + 上传
 *   - canvas-api.ts    Canvas 流水线全部
 *   - subtitle-api.ts  字幕
 *   - asset-api.ts     资产中心 + 标签 + 主体库
 *   - admin.ts         管理后台
 *   - api-keys.ts      API Key CRUD
 */

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

// ===== Eden Treaty 客户端 =====

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

export const api = treaty<App>(resolveApiBaseUrl())

// ===== 导出共享类型 =====

export * from './admin'
export * from './api-keys'
export * from './asset-api'
export * from './auth-api'
export * from './canvas-api'
export type CostDetail = GenerationRecord['cost']

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

// ===== 计费 API =====

export async function fetchBillingStatistics(): Promise<BillingStatisticsResponse> {
  return unwrapEden<BillingStatisticsResponse>(
    await api.api.billing.statistics.get(),
  )
}

export async function fetchBillingBalance(): Promise<BillingBalanceResponse> {
  return unwrapEden<BillingBalanceResponse>(
    await api.api.billing.balance.get(),
  )
}

export async function fetchBillingTransactions(params?: { limit?: number, offset?: number }): Promise<BillingTransactionsResponse> {
  return unwrapEden<BillingTransactionsResponse>(
    await api.api.billing.transactions.get({
      query: {
        limit: params?.limit,
        offset: params?.offset,
      },
    }),
  )
}

// ===== Gateway API =====

export async function fetchGatewayUsage(params?: { days?: number, limit?: number }): Promise<OpenAIGatewayUsageResponse> {
  return unwrapEden<OpenAIGatewayUsageResponse>(
    await api.v1.usage.get({ query: { days: params?.days, limit: params?.limit } }),
  )
}

// ===== Re-export 领域 API（向后兼容） =====

export * from './generation-api'
export * from './subtitle-api'
export type { ModelConfig, ModelParameter } from '@excuse/shared'
export type { AcceptedResponse, GenerateResponse, GenerationRecord } from '@excuse/shared'
export type { AdminOverview, AdminTaskItem, AdminTaskListQuery } from '@excuse/shared'
export type { AssetLibraryItem, AssetLibraryKind, AssetLibraryListResponse, AssetLibraryQuery, AssetLibrarySource, AssetLibraryStatusFilter } from '@excuse/shared'
export type { BillingStatistics } from '@excuse/shared'
