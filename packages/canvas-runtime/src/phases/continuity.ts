import type { ContinuityIssue } from '@excuse/shared'
import type { CanvasRuntimeRepoAdapter } from '../adapter-types'
import type { CanvasProjectDetail } from '../normalize'
import { validateShotContinuity } from '@excuse/canvas-engine'
import { toNormalizedCharacter, toNormalizedLocation, toNormalizedShot } from '../normalize'

/**
 * 连续性校验阶段共享核心（单次、纯计算）：validateShotContinuity → createContinuityReport。
 * 不调 LLM、不写项目状态；归一化映射复用 toNormalized*，host 负责 runCanvasAssetStep / 状态 / 通知。
 */
export interface ContinuityPhaseInput {
  projectId: string
  detail: CanvasProjectDetail
  repo: CanvasRuntimeRepoAdapter
}

export interface ContinuityPhaseResult {
  issues: ContinuityIssue[]
}

export async function runContinuityPhase(input: ContinuityPhaseInput): Promise<ContinuityPhaseResult> {
  const issues = validateShotContinuity({
    shots: input.detail.shots.map(toNormalizedShot),
    characters: input.detail.characters.map(toNormalizedCharacter),
    locations: input.detail.locations.map(toNormalizedLocation),
  })

  await input.repo.createContinuityReport({
    projectId: input.projectId,
    issuesJson: issues,
  })

  return { issues }
}
