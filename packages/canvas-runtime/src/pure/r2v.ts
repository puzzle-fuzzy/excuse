/**
 * 纯函数：R2V 多参考图请求组装
 *
 * 无 IO 依赖。把镜头解析出的参考引用按 R2V 参考图预算规范排序裁剪：
 *   主要角色 turnaround → 次要角色 portrait → 关键场景 → 预留额外
 *   最多 R2V_MAX_REFERENCES 张（DashScope happyhorse-r2v / wan2.7-r2v 上限 9）。
 *
 * 「主要角色」由 dialogue 产出的说话角色判定（说话者 = 该镜头的重点角色），
 * 即 TODO 所述「依赖 dialogue 产出 reference_media」的数据流。
 */

import type { CanvasVideoReference, R2VReferenceMedia } from '@excuse/shared'

/** DashScope R2V 模型参考图上限（happyhorse-r2v / wan2.7-r2v 均为 1~9 张） */
export const R2V_MAX_REFERENCES = 9

export interface BuildR2VRequestInput {
  /** 镜头解析出的全部参考引用（来自 resolveShotVideoReferences，已按 URL 去重） */
  references: ReadonlyArray<CanvasVideoReference>
  /** 镜头中说话的角色 ID（来自 dialogue）— 作为主要角色优先编入 turnaround 预算 */
  speakingCharacterIds?: ReadonlyArray<string>
  /** 最大参考图数，缺省 R2V_MAX_REFERENCES */
  max?: number
}

/**
 * 组装 R2V 参考媒体预算。
 *
 * 排序优先级：说话角色（turnaround）→ 非说话角色（portrait）→ 场景（scene）→ 额外（extra）。
 * firstFrame 不参与 R2V 预算（它是 I2V 语义，由 i2v 模型的 first_frame_url 参数承载）。
 * 裁剪到 max 张，imageNumber 按 1-based 数组顺序赋值。
 */
export function buildR2VRequest(input: BuildR2VRequestInput): R2VReferenceMedia[] {
  const max = input.max ?? R2V_MAX_REFERENCES
  const speakers = new Set(input.speakingCharacterIds ?? [])

  const speaking: CanvasVideoReference[] = []
  const otherCharacters: CanvasVideoReference[] = []
  const scenes: CanvasVideoReference[] = []
  const extras: CanvasVideoReference[] = []

  for (const ref of input.references) {
    if (!ref.url)
      continue
    if (ref.role === 'firstFrame') {
      // firstFrame 属于 I2V 语义，不进 R2V 多参考预算
      continue
    }
    if (ref.role === 'character') {
      if (ref.characterId && speakers.has(ref.characterId))
        speaking.push(ref)
      else otherCharacters.push(ref)
    }
    else if (ref.role === 'location') {
      scenes.push(ref)
    }
    else {
      extras.push(ref)
    }
  }

  const ordered = [...speaking, ...otherCharacters, ...scenes, ...extras].slice(0, Math.max(0, max))

  return ordered.map((ref, index): R2VReferenceMedia => {
    const kind: R2VReferenceMedia['kind'] = ref.role === 'character'
      ? (ref.characterId && speakers.has(ref.characterId) ? 'turnaround' : 'portrait')
      : ref.role === 'location' ? 'scene' : 'extra'
    return {
      url: ref.url,
      kind,
      ...(ref.characterId !== undefined && { characterId: ref.characterId }),
      ...(ref.locationId !== undefined && { locationId: ref.locationId }),
      imageNumber: index + 1,
    }
  })
}

/**
 * 从 dialogue 产出的结构化对话数据中提取「说话角色 ID」列表。
 *
 * dialogueJson.lines[].speaker 是角色名（LLM 输出），经 characters 的 name→id 映射转为 ID。
 * 用于 buildR2VRequest 把说话角色作为主要角色优先编入 turnaround 预算。
 *
 * 入参为 LLM 产出的非受信 JSON，故以 unknown 接收并做运行时收窄，避免类型泄漏。
 */
export function extractSpeakingCharacterIds(
  dialogueJson: unknown,
  characters: ReadonlyArray<{ id: string, name: string }>,
): string[] {
  if (!dialogueJson || typeof dialogueJson !== 'object')
    return []
  const lines = (dialogueJson as Record<string, unknown>).lines
  if (!Array.isArray(lines) || lines.length === 0)
    return []
  const nameToId = new Map(characters.map(c => [c.name, c.id]))
  const ids = new Set<string>()
  for (const line of lines) {
    if (!line || typeof line !== 'object')
      continue
    const speaker = (line as Record<string, unknown>).speaker
    if (typeof speaker !== 'string')
      continue
    const id = nameToId.get(speaker)
    if (id)
      ids.add(id)
  }
  return [...ids]
}
