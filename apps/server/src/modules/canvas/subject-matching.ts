/**
 * 主体资产库匹配 — analyze 阶段自动复用已有资产
 *
 * 在 characters / locations 阶段，LLM 提取名称后先查询用户资产库，
 * 若找到匹配条目则跳过 AI 生成，直接复用已保存的 profile。
 */

import type { CharacterProfile, LocationProfile } from '@excuse/shared/domain-types'
import { createCanvasCharacter, createCanvasLocation, searchSubjectsByName } from '@excuse/db'

export interface MatchedCharacterResult {
  matched: true
  character: Awaited<ReturnType<typeof createCanvasCharacter>>
}
export interface MatchedLocationResult {
  matched: true
  location: Awaited<ReturnType<typeof createCanvasLocation>>
}
export interface NoMatchResult {
  matched: false
}

/**
 * 检查角色名是否已存在于用户资产库，存在则直接创建角色行。
 * 返回 matched=true + 角色行，或 matched=false 表示需调用 LLM。
 */
export async function tryMatchCharacter(
  accountId: string,
  projectId: string,
  characterName: string,
): Promise<MatchedCharacterResult | NoMatchResult> {
  const matches = await searchSubjectsByName(accountId, characterName, 'character')
  if (matches.length === 0)
    return { matched: false }

  const subject = matches[0]!
  const character = await createCanvasCharacter({
    projectId,
    name: subject.name,
    identityPrompt: subject.identityPrompt ?? undefined,
    negativePrompt: subject.negativePrompt ?? undefined,
    profileJson: subject.profileJson as CharacterProfile | null ?? undefined,
    referenceImageUrl: subject.referenceImageUrl ?? undefined,
    turnaroundSheetUrl: subject.turnaroundSheetUrl ?? undefined,
  })

  return { matched: true, character }
}

/**
 * 检查场景名是否已存在于用户资产库，存在则直接创建场景行。
 */
export async function tryMatchLocation(
  accountId: string,
  projectId: string,
  locationName: string,
): Promise<MatchedLocationResult | NoMatchResult> {
  const matches = await searchSubjectsByName(accountId, locationName, 'location')
  if (matches.length === 0)
    return { matched: false }

  const subject = matches[0]!
  const location = await createCanvasLocation({
    projectId,
    name: subject.name,
    scenePrompt: subject.scenePrompt ?? undefined,
    negativePrompt: subject.negativePrompt ?? undefined,
    profileJson: subject.profileJson as LocationProfile | null ?? undefined,
    referenceImageUrl: subject.referenceImageUrl ?? undefined,
  })

  return { matched: true, location }
}
