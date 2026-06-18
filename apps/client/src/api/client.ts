/**
 * 客户端 API 桶式导出 — 从各领域文件 re-export，消费者仍用 `import { xxx } from '../api/client'`
 *
 * 本文件不含任何业务函数，仅提供 barrel re-export。
 * 核心基础设施（Eden 客户端、unwrapEden、token 管理）在 api-core.ts；
 * 业务函数按领域拆分：auth-api / generation-api / canvas-api / canvas-entity-api /
 * canvas-asset-api / subtitle-api / asset-api / admin / api-keys / billing-api / gateway-api。
 */
import type { GenerationRecord } from '@excuse/shared'

export * from './admin'
export * from './api-core'
export * from './api-keys'
export * from './asset-api'
export * from './auth-api'
export * from './billing-api'
export * from './canvas-api'
export * from './canvas-asset-api'
export * from './canvas-entity-api'
export * from './gateway-api'
export * from './generation-api'
export * from './subtitle-api'

export type CostDetail = GenerationRecord['cost']

export type { ModelConfig, ModelParameter } from '@excuse/shared'
export type { AcceptedResponse, GenerateResponse, GenerationRecord } from '@excuse/shared'
export type { AdminOverview, AdminTaskItem, AdminTaskListQuery } from '@excuse/shared'
export type { AssetLibraryItem, AssetLibraryKind, AssetLibraryListResponse, AssetLibraryQuery, AssetLibrarySource, AssetLibraryStatusFilter } from '@excuse/shared'
export type { BillingStatistics } from '@excuse/shared'
