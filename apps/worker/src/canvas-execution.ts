import type { CanvasModelPreferences } from '@excuse/shared'
import { getCanvasVideoModel } from '@excuse/canvas-runtime'
import {
  getCanvasProjectDetail,
} from '@excuse/db'

type CanvasProjectDetail = NonNullable<Awaited<ReturnType<typeof getCanvasProjectDetail>>>
const DEFAULT_TEXT_MODEL = 'qwen3.7-plus'
const DEFAULT_IMAGE_MODEL = 'qwen-image-2.0-pro'

export function getTextModel(prefs: CanvasModelPreferences | null | undefined): string {
  return prefs?.textModel || DEFAULT_TEXT_MODEL
}

export function getImageModel(prefs: CanvasModelPreferences | null | undefined): string {
  return prefs?.imageModel || DEFAULT_IMAGE_MODEL
}

export function getVideoModel(prefs: CanvasModelPreferences | null | undefined, referenceUrls: string[]): string {
  return getCanvasVideoModel(prefs, referenceUrls)
}

export async function loadRunnableCanvasProject(projectId: string): Promise<CanvasProjectDetail> {
  const detail = await getCanvasProjectDetail(projectId)
  if (!detail)
    throw new Error('项目不存在')
  assertCanvasProjectNotGenerating(detail.project.status)
  return detail
}

export function assertCanvasProjectNotGenerating(status: string | null | undefined): void {
  if (status === 'generating')
    throw new Error('项目正在生成中，请等待完成后再操作')
}
