/**
 * 管理端 API 桶式导出 — 从各领域文件 re-export，消费者用 `import { xxx } from '@/api/client'`
 *
 * 本文件不含业务函数，仅提供 barrel re-export。
 * 核心基础设施（Eden 客户端、unwrapEden、token 管理）在 api-core.ts；
 * 业务函数：auth-api（登录/登出/me）+ admin（运营数据/写操作）。
 */
export * from './admin'
export * from './api-core'
export * from './auth-api'
