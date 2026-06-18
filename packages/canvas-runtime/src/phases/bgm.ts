/**
 * BGM 生成阶段 — Phase 10
 *
 * 输入：项目故事摘要 + 镜头主导情绪 → FunMusic (fun-music-v1) 生成 BGM
 * 输出：转存后的音频 URL（OSS / 本地）+ 时长
 *
 * 单次调用（项目级 BGM，非逐镜头）。音频 URL 写入 canvas_projects.bgm_url。
 */

import type { DashScopeClient } from '@excuse/provider'
import type { ShotEnvironment } from '@excuse/shared'
import type { AssetStorage } from '@excuse/storage'
import type { CanvasProjectDetail } from '../normalize'
import { buildBgmPrompt } from '@excuse/prompt-engine'
import { getModelById, validateAndMerge } from '@excuse/provider'

/** Canvas BGM 流水线使用的音频模型（邀测期唯一可选） */
export const CANVAS_BGM_MODEL = 'fun-music-v1'

export interface BgmPhaseInput {
  projectId: string
  detail: CanvasProjectDetail
  client: DashScopeClient
  storage: AssetStorage
}

export interface BgmPhaseResult {
  /** 转存后的音频 URL（OSS / 本地，长期有效） */
  audioUrl: string
  /** DashScope 原始音频 URL（24h 过期，仅供审计） */
  providerUrl: string
  /** 生成音频时长（秒），用于按秒计费 */
  durationSeconds: number
  /** 生成时使用的音乐 prompt */
  prompt: string
}

/**
 * 为项目生成 BGM
 *
 * 1. 从 analysis.summary（缺省 storyText）+ 镜头主导情绪推导音乐 prompt
 * 2. 调用 fun-music-v1 同步生成音频
 * 3. 转存到 OSS（DashScope url 24h 过期）
 */
export async function runBgmPhase(input: BgmPhaseInput): Promise<BgmPhaseResult> {
  const project = input.detail.project
  const storySummary = project.analysisJson?.summary || project.storyText
  const mood = pickDominantMood(input.detail.shots.map(s => s.environmentJson))
  const prompt = buildBgmPrompt({ storySummary, mood })

  const modelConfig = getModelById(CANVAS_BGM_MODEL)
  if (!modelConfig) {
    throw new Error(`BGM 模型 ${CANVAS_BGM_MODEL} 未在 provider 配置中声明`)
  }

  const validation = validateAndMerge(modelConfig, { prompt })
  if (!validation.ok) {
    const detail = validation.errors.map(e => `${e.field}: ${e.message}`).join('; ')
    throw new Error(`BGM 参数校验失败：${detail}`)
  }

  const result = await input.client.generateAudio(CANVAS_BGM_MODEL, validation.params)
  if (result.type === 'failed') {
    throw new Error(`BGM 生成失败：${result.error}`)
  }
  if (!result.output.url) {
    throw new Error('BGM 生成未返回音频 URL')
  }

  const ext = result.output.format === 'wav' ? 'wav' : 'mp3'
  const fileName = `bgm/${input.projectId}/bgm.${ext}`
  const audioUrl = await input.storage.downloadAndUpload(result.output.url, fileName)

  return {
    audioUrl,
    providerUrl: result.output.url,
    durationSeconds: result.output.durationSeconds,
    prompt,
  }
}

/**
 * 从镜头环境信息中提取主导情绪（出现频次最高的 mood）
 */
function pickDominantMood(environments: Array<ShotEnvironment | null | undefined>): string | null {
  const counts = new Map<string, number>()
  for (const env of environments) {
    const mood = env?.mood?.trim()
    if (!mood)
      continue
    counts.set(mood, (counts.get(mood) ?? 0) + 1)
  }
  if (counts.size === 0)
    return null
  let best: string | null = null
  let bestCount = 0
  for (const [mood, count] of counts) {
    if (count > bestCount) {
      best = mood
      bestCount = count
    }
  }
  return best
}
