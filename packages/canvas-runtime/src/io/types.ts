/**
 * Canvas 视频提交类型 — io/ 层共享
 */

import type { CanvasRuntimeLlmClient } from '../adapter-types'

export interface CanvasVideoSubmitInput {
  accountId: string
  projectId: string
  shotId: string
  assetId: string
  model: string
  videoPrompt: string
  negativePrompt?: string | null
  duration: number
  referenceUrls: string[]
  client: CanvasRuntimeLlmClient
  estimatedCost?: boolean
  diagnostics?: {
    workerTaskId?: string
    pipelineRunId?: string
    canvasAssetId?: string
  }
}

export interface CanvasVideoSubmitResult {
  taskId: string
  model: string
}
