import type { DeleteGenerationRecordResponse, GenerateResponse, GenerationRecordListResponse, GenerationRecordResponse, ModelConfig, UploadResponse } from '@excuse/shared'
import { api, unwrapEden } from './client'

// ===== 生成 & 记录 API =====

function createGenerationIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return `gen:${crypto.randomUUID()}`

  return `gen:${Date.now()}:${Math.random().toString(36).slice(2)}`
}

export async function fetchModels(): Promise<{ models: ModelConfig[] }> {
  return unwrapEden<{ models: ModelConfig[] }>(
    await api.api.models.get(),
  )
}

/** 发起生成 — 返回完整 GenerationRecord */
export async function generate(params: {
  model: string
  parameters: Record<string, unknown>
  referenceFileIds?: string[]
  idempotencyKey?: string
}): Promise<GenerateResponse> {
  const { idempotencyKey, ...body } = params

  return unwrapEden<GenerateResponse>(
    await api.api.generate.post(body, {
      headers: {
        'Idempotency-Key': idempotencyKey ?? createGenerationIdempotencyKey(),
      },
    }),
  )
}

export async function fetchRecords(params?: {
  category?: string
  status?: string
  limit?: number
  offset?: number
}): Promise<GenerationRecordListResponse> {
  return unwrapEden<GenerationRecordListResponse>(
    await api.api.records.get({
      query: {
        category: params?.category || undefined,
        status: params?.status || undefined,
        limit: params?.limit ?? 50,
        offset: params?.offset ?? 0,
      },
    }),
  )
}

export async function fetchRecord(id: string): Promise<GenerationRecordResponse> {
  return unwrapEden<GenerationRecordResponse>(
    await api.api.records({ id }).get(),
  )
}

export async function deleteRecord(id: string): Promise<DeleteGenerationRecordResponse> {
  return unwrapEden<DeleteGenerationRecordResponse>(
    await api.api.records({ id }).delete(),
  )
}

export async function retryRecord(id: string): Promise<GenerateResponse> {
  return unwrapEden<GenerateResponse>(
    await api.api.records({ id }).retry.post(),
  )
}

export async function cancelRecord(id: string): Promise<GenerationRecordResponse> {
  return unwrapEden<GenerationRecordResponse>(
    await api.api.records({ id }).cancel.post(),
  )
}

// ===== 上传 API =====

export async function uploadFile(file: File): Promise<UploadResponse> {
  return unwrapEden<UploadResponse>(
    await api.api.upload.post({ file }),
  )
}

export async function deleteUploadedFile(id: string): Promise<{ success: boolean }> {
  return unwrapEden<{ success: boolean }>(
    await api.api.upload({ id }).delete(),
  )
}

/** 编辑上传文件（重命名/用途） — 返回更新后的 DTO */
export async function updateUploadedFile(
  id: string,
  patch: { fileName?: string, purpose?: string },
): Promise<UploadResponse> {
  return unwrapEden<UploadResponse>(
    await api.api.upload({ id }).patch(patch),
  )
}
