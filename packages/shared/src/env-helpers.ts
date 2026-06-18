/**
 * 环境变量解析共享工具
 *
 * 纯函数，提供可区分缺省/非法值/0负数的 env 解析，减少 server/worker 漂移。
 * 每个 helper 的错误消息包含变量名，便于启动失败定位。
 */

import type { OSSConfigShape } from './config-helpers'
import { isPublicMetricsCidrs, loadOSSConfig } from './config-helpers'

/** 整数解析结果 — 区分缺省、非法值与边界情况 */
export interface ParsedInt {
  value: number
  source: 'env' | 'default'
}

/**
 * 解析正整数环境变量。
 *
 * - 未设置（undefined / 空字符串）→ 返回 defaultVal，source='default'
 * - 设置但非法（非数字 / NaN / 零 / 负数 / 非整数）→ throw，消息包含变量名与原始值
 * - 正常值 → 返回 value，source='env'
 */
export function parsePositiveIntEnv(name: string, defaultVal: number, env: NodeJS.ProcessEnv = process.env): ParsedInt {
  const raw = env[name]
  if (raw === undefined || raw.trim() === '')
    return { value: defaultVal, source: 'default' }

  const num = Number(raw)
  if (!Number.isFinite(num) || num <= 0 || !Number.isInteger(num)) {
    throw new Error(
      `${name} must be a positive integer, got: ${JSON.stringify(raw)}`,
    )
  }

  return { value: num, source: 'env' }
}

/**
 * 解析以毫秒为单位的正整数环境变量（超时等）。
 * 与 parsePositiveIntEnv 同构，但消息以 ms 单位展示。
 */
export function parsePositiveMsEnv(name: string, defaultVal: number): ParsedInt {
  return parsePositiveIntEnv(name, defaultVal)
}

export interface ProviderConfig {
  dashscopeApiKey: string
  dashscopeBaseUrl: string
}

/**
 * 解析 Provider（DashScope）通用配置。
 *
 * 默认值仅在未设置时使用；生产校验（validateProductionBase）会检查 KEY 非空。
 */
export function parseProviderConfig(env: NodeJS.ProcessEnv = process.env): ProviderConfig {
  return {
    dashscopeApiKey: env.DASHSCOPE_API_KEY || '',
    dashscopeBaseUrl: env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/api/v1',
  }
}

export interface MetricsConfig {
  accessToken: string | undefined
  allowedCidrs: string[]
}

/**
 * 解析 `/metrics` 端点通用配置。
 *
 * 默认 CIDR 仅回环；生产环境若放宽到公网则必须设置 METRICS_ACCESS_TOKEN。
 */
export function parseMetricsConfig(env: NodeJS.ProcessEnv = process.env): MetricsConfig {
  return {
    accessToken: env.METRICS_ACCESS_TOKEN || undefined,
    allowedCidrs: (env.METRICS_ALLOWED_CIDRS || '127.0.0.1/32,::1/128')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
  }
}

export interface ProviderTimeoutConfig {
  providerHttpTimeoutMs: number
  providerStreamIdleTimeoutMs: number
}

/**
 * 解析 Provider HTTP / 流式超时配置（毫秒）。
 */
export function parseProviderTimeoutConfig(env: NodeJS.ProcessEnv = process.env): ProviderTimeoutConfig {
  return {
    providerHttpTimeoutMs: parsePositiveIntEnv('PROVIDER_HTTP_TIMEOUT_MS', 60_000, env).value,
    providerStreamIdleTimeoutMs: parsePositiveIntEnv('PROVIDER_STREAM_IDLE_TIMEOUT_MS', 30_000, env).value,
  }
}

export interface StorageConfig {
  storageRoot: string
  oss: OSSConfigShape | undefined
}

/**
 * 解析存储根目录与 OSS 配置。
 *
 * OSS 可选，缺省使用本地文件存储。
 */
export function parseStorageConfig(env: NodeJS.ProcessEnv = process.env): StorageConfig {
  return {
    storageRoot: env.STORAGE_ROOT || './uploads',
    oss: loadOSSConfig(env) as OSSConfigShape | undefined,
  }
}

/**
 * 生产环境通用校验。
 *
 * server 与 worker 共享：DATABASE_URL、DASHSCOPE_API_KEY、公网 metrics 保护。
 * 各 app 可追加自身特有字段（JWT_SECRET、FRONTEND_URL 等）。
 */
export function validateProductionBase(
  config: { dashscopeApiKey: string, metricsAllowedCidrs: string[], metricsAccessToken?: string },
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env.NODE_ENV !== 'production')
    return

  const errors: string[] = []
  if (!env.DATABASE_URL)
    errors.push('DATABASE_URL is required')
  if (!config.dashscopeApiKey)
    errors.push('DASHSCOPE_API_KEY is required')
  if (isPublicMetricsCidrs(config.metricsAllowedCidrs) && !config.metricsAccessToken)
    errors.push('METRICS_ACCESS_TOKEN is required when METRICS_ALLOWED_CIDRS exposes public networks')

  if (errors.length > 0)
    throw new Error(`Invalid production configuration: ${errors.join(', ')}`)
}
