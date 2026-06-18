/**
 * 生成任务编排 — POST /generate 与 POST /records/:id/retry 共享
 *
 * 提取两条路径中 validate→reference→cost→prepare→execute→createTask 的重复逻辑。
 * Route handler 负责：模型查找、参数校验、去重/状态检查、记录创建/重置。
 * 编排函数负责：预估→预留→执行→视频 task→返回格式化。
 */
import type { GenerationCategory, GenerationInputParams, GenerationRecordRow } from '@excuse/db'
import type { ValidatedModelParameters } from '@excuse/provider'
import type { GenerateResponse, GenerationRecord, ModelConfig } from '@excuse/shared'
import type { GenerationDependencies } from './service'
import { createTask, serialize } from '@excuse/db'
import { classifyRecovery } from '@excuse/error-recovery'
import { getTaskPriority } from '@excuse/task-engine'
import { PaymentRequiredError } from '../../utils/app-errors'
import * as svc from './service'

// ===== 序列化辅助（从 generate.ts 提取，供所有路由 handler 复用） =====

const PROVIDER_CANCEL_STATUSES = ['not_requested', 'no_task', 'requested', 'succeeded', 'failed'] as const

/** 收窄 providerCancelStatus 字符串为联合类型 */
export function serializeProviderCancelStatus(status: string): GenerationRecord['providerCancelStatus'] {
  return (PROVIDER_CANCEL_STATUSES as readonly string[]).includes(status)
    ? status as GenerationRecord['providerCancelStatus']
    : 'not_requested'
}

/** DB 行 → 前端 GenerationRecord（Date→string + recovery 分类） */
export function serializeRecord(record: GenerationRecordRow): GenerationRecord {
  const isTerminal = record.status === 'failed' || record.status === 'cancelled'
  const recovery = isTerminal
    ? classifyRecovery({
        errorMessage: record.errorMessage,
        status: record.status,
        traceId: record.traceId,
        entityId: record.id,
        source: 'workspace',
        billingMode: 'credit-ledger',
      })
    : null

  return {
    ...serialize(record),
    providerCancelStatus: serializeProviderCancelStatus(record.providerCancelStatus),
    recovery,
  }
}

// ===== 编排输入 =====

export interface OrchestrateGenerationInput {
  userId: string
  recordId: string
  taskId: string
  traceId?: string
  category: GenerationCategory
  modelConfig: ModelConfig
  validatedParams: ValidatedModelParameters
  referenceUrls?: string[]
  inputParams: GenerationInputParams
  dedupeKey?: string
  creditSource: 'generate' | 'retry'
  deps: GenerationDependencies
}

// ===== 编排函数 =====

/**
 * 核心生成编排 — submit/retry 共享。
 *
 * 编排阶段：预估费用 → 预留 credit → provider 执行 → 视频异步 task → 返回格式化。
 * 路由层负责所有前置校验（模型存在、参数合法、引用归属、去重/状态重置）。
 */
export async function orchestrateGeneration(
  input: OrchestrateGenerationInput,
): Promise<GenerateResponse> {
  const {
    userId,
    recordId,
    taskId,
    traceId,
    category,
    modelConfig,
    validatedParams,
    referenceUrls,
    inputParams,
    dedupeKey,
    creditSource,
    deps,
  } = input
  const model = modelConfig.id

  // 1. 预估费用
  const estimatedCost = svc.estimateGenerationCost(modelConfig, validatedParams)

  // 2. 预留 credit + 构造执行上下文
  const prep = await svc.prepareGeneration({
    recordId,
    accountId: userId,
    taskId,
    traceId,
    modelConfig,
    category,
    parameters: validatedParams,
    referenceUrls,
    inputParams,
    dedupeKey,
    estimatedCost,
    creditSource,
  })
  if (!prep.ok) {
    throw new PaymentRequiredError(prep.message)
  }

  // 3. 调用 provider 执行生成
  const result = await svc.executeGeneration(prep.context, deps)

  // 4. 视频异步任务：创建 generate.video task（Worker 轮询 DashScope 结果）
  if (
    result.success
    && category === 'video'
    && result.record?.outputResult?.type === 'processing'
    && result.record.outputResult.taskId
  ) {
    await createTask({
      accountId: userId,
      type: 'generate.video',
      domain: 'generate',
      priority: getTaskPriority({ type: 'generate.video', domain: 'generate' }),
      maxAttempts: 5000,
      generationRecordId: result.record.id,
      traceId,
      input: {
        recordId: result.record.id,
        providerTaskId: result.record.outputResult.taskId,
        model,
      } satisfies Record<string, unknown>,
    })
  }

  // 5. 返回格式化结果
  if (result.success) {
    return { success: true, record: serializeRecord(result.record) } satisfies GenerateResponse
  }
  return { success: false, record: serializeRecord(result.record) } satisfies GenerateResponse
}
