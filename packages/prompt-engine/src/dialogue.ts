/**
 * 对话层 Prompt 构建 — Phase 8.5
 *
 * 输入：镜头叙事文本 + 角色/场景信息
 * 输出：结构化对话 JSON（lines/soundEffects/ambientSound）
 */

// Inline types — prompt-engine is a pure package without @excuse/shared dependency
interface CharacterProfile { name: string, role?: string, age?: string, gender?: string, bodyShape?: string }
interface LocationProfile { name: string, type?: string, location?: string, era?: string, atmosphere?: string }

export interface DialogueInput {
  narrative: string
  characters: Array<{ id: string, name: string, identityPrompt?: string | null, profileJson?: CharacterProfile | null }>
  location?: { name: string, scenePrompt?: string | null, profileJson?: LocationProfile | null } | null
  environment?: { backgroundMotion?: string | null, lighting?: string | null, mood?: string | null, style?: string | null } | null
}

export function buildDialogueSystemPrompt(): string {
  return `你是一位专业的影视对话编剧。你的任务是根据镜头叙事文本，为每个镜头生成结构化对话数据。

请严格按照 JSON 格式输出，包含以下字段：
- lines: 对白数组。每句对白包含：
  - speaker: 说话角色名称
  - text: 对白文本
  - emotion: 说话时的情绪（高兴/愤怒/悲伤/惊讶/平静等）
  - volume: 音量（轻声/正常/大声/喊叫）
- soundEffects: 音效数组（枪声、脚步声、门铃声等），每项包含 type + description
- ambientSound: 环境音描述（雨声、风声、街道噪音等），string

要求：
1. 对白必须与镜头叙事内容一致
2. 对白使用自然的口语化表达
3. 单镜头 2-3 轮对话为上限
4. 根据叙事中的动作描述和环境描述推断音效和环境音
5. 如果镜头没有明显对白，lines 为空数组

仅输出 JSON，不要包含其他文字。`
}

export function buildDialogueUserPrompt(input: DialogueInput): string {
  const charInfo = input.characters.map(c => `- ${c.name}（${c.identityPrompt?.slice(0, 100) ?? ''}）`).join('\n')

  return `镜头叙事：${input.narrative}

出场角色：
${charInfo || '无特定角色'}

${input.location ? `场景：${input.location.name}` : ''}
${input.environment?.mood ? `情绪：${input.environment.mood}` : ''}
${input.environment?.backgroundMotion ? `背景：${input.environment.backgroundMotion}` : ''}
${input.environment?.lighting ? `光影：${input.environment.lighting}` : ''}

输出 JSON 格式对话数据：`
}
