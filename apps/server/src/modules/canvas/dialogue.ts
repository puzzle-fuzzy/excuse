/**
 * 对话层生成服务 — Phase 8.5
 *
 * 从项目 storyboard + characters 为每个 shot 生成对白/音效/环境音，
 * 并更新 shot 的 dialoguePrompt 和 dialogueJson 字段。
 */

import type { DashScopeClient } from '@excuse/provider'
import { getCanvasProjectDetail, updateCanvasShot } from '@excuse/db'
import { getTextModel } from './service-helpers'

export async function generateDialogue(projectId: string, client: DashScopeClient) {
  const detail = await getCanvasProjectDetail(projectId)
  if (!detail)
    throw new Error('项目不存在')

  const textModel = getTextModel(detail.project.modelPreferencesJson)
  const { runDialoguePhase } = await import('@excuse/canvas-runtime')

  const { results } = await runDialoguePhase({
    projectId,
    detail,
    client,
    textModel,
  })

  // 更新每个镜头的对话字段 + R2V 参考媒体预算
  for (const result of results) {
    if (result.dialoguePrompt === null && result.dialogueJson === null && result.referenceMedia.length === 0)
      continue
    const patch: Record<string, unknown> = {
      dialoguePrompt: result.dialoguePrompt ?? undefined,
      referenceMedia: result.referenceMedia,
    }
    if (result.dialogueJson)
      patch.dialogueJson = result.dialogueJson
    await updateCanvasShot(result.shotId, patch as Parameters<typeof updateCanvasShot>[1])
  }

  return results
}
