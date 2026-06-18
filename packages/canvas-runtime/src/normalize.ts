import type { NormalizedCharacter, NormalizedLocation, NormalizedShot } from '@excuse/canvas-engine'
import type { CanvasRuntimeRepoAdapter } from './adapter-types'

/**
 * Canvas 项目详情行的派生类型 — normalize 映射的输入形状。
 * server 与 worker 共用 `getCanvasProjectDetail` 的返回，所以归一化逻辑也共用。
 */
export type CanvasProjectDetail = NonNullable<Awaited<ReturnType<CanvasRuntimeRepoAdapter['getCanvasProjectDetail']>>>

export function toNormalizedShot(shot: CanvasProjectDetail['shots'][number]): NormalizedShot {
  return {
    id: shot.id,
    shotIndex: shot.shotIndex,
    locationId: shot.locationId,
    characterIds: (shot.characterIdsJson ?? []) as string[],
    narrative: shot.narrative,
    duration: shot.duration,
    camera: shot.cameraJson,
    continuity: shot.continuityJson,
    timeline: shot.timelineJson ?? undefined,
    environment: shot.environmentJson ?? undefined,
  }
}

export function toNormalizedCharacter(character: CanvasProjectDetail['characters'][number]): NormalizedCharacter {
  return {
    id: character.id,
    name: character.name,
    identityPrompt: character.identityPrompt ?? '',
    negativePrompt: character.negativePrompt ?? '',
  }
}

export function toNormalizedLocation(location: CanvasProjectDetail['locations'][number]): NormalizedLocation {
  const cameraRules = location.profileJson?.cameraRules
  return {
    id: location.id,
    name: location.name,
    scenePrompt: location.scenePrompt ?? '',
    negativePrompt: location.negativePrompt ?? '',
    cameraRules: cameraRules ?? { axisDirection: '', allowedAngles: [], forbiddenAngles: [] },
  }
}
