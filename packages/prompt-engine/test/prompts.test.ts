import { describe, expect, it } from 'bun:test'
import { buildAnalysisPrompt, buildCharacterPrompt, buildLocationPrompt, buildStoryboardPrompt } from '../src'

const storyText = '在一个遥远的王国里，住着一位勇敢的少年。他踏上了一段冒险旅程。'
const analysis = {
  summary: '一个关于勇敢少年的冒险故事',
  mainConflict: '善与恶的对抗',
  timeline: ['少年出发', '遇到挑战', '最终胜利'],
}

describe('buildAnalysisPrompt', () => {
  it('返回 system 和 prompt 字段', () => {
    const result = buildAnalysisPrompt(storyText)
    expect(result).toHaveProperty('system')
    expect(result).toHaveProperty('prompt')
  })

  it('system 中包含 JSON 格式指令', () => {
    const { system } = buildAnalysisPrompt(storyText)
    expect(system).toContain('JSON')
    expect(system).toContain('summary')
    expect(system).toContain('characterNames')
    expect(system).toContain('sceneNames')
  })

  it('prompt 中包含故事文本', () => {
    const { prompt } = buildAnalysisPrompt(storyText)
    expect(prompt).toContain(storyText)
  })
})

describe('buildCharacterPrompt', () => {
  it('返回 system 和 prompt 字段', () => {
    const result = buildCharacterPrompt(storyText, analysis, '小明')
    expect(result).toHaveProperty('system')
    expect(result).toHaveProperty('prompt')
  })

  it('prompt 中包含角色名称', () => {
    const { prompt } = buildCharacterPrompt(storyText, analysis, '小明')
    expect(prompt).toContain('小明')
  })

  it('prompt 中包含故事文本', () => {
    const { prompt } = buildCharacterPrompt(storyText, analysis, '小明')
    expect(prompt).toContain(storyText.slice(0, 3000))
  })

  it('prompt 中包含分析摘要', () => {
    const { prompt } = buildCharacterPrompt(storyText, analysis, '小明')
    expect(prompt).toContain(analysis.summary)
    expect(prompt).toContain(analysis.mainConflict)
  })

  it('system 中包含 identityPrompt 规则', () => {
    const { system } = buildCharacterPrompt(storyText, analysis, '小明')
    expect(system).toContain('identityPrompt')
    expect(system).toContain('negativePrompt')
  })

  it('system 中包含 JSON 输出格式', () => {
    const { system } = buildCharacterPrompt(storyText, analysis, '小明')
    expect(system).toContain('face')
    expect(system).toContain('hair')
    expect(system).toContain('costume')
  })
})

describe('buildLocationPrompt', () => {
  it('返回 system 和 prompt 字段', () => {
    const result = buildLocationPrompt(storyText, analysis, '王城')
    expect(result).toHaveProperty('system')
    expect(result).toHaveProperty('prompt')
  })

  it('prompt 中包含场景名称', () => {
    const { prompt } = buildLocationPrompt(storyText, analysis, '王城')
    expect(prompt).toContain('王城')
  })

  it('prompt 中包含分析摘要', () => {
    const { prompt } = buildLocationPrompt(storyText, analysis, '王城')
    expect(prompt).toContain(analysis.summary)
  })

  it('system 中包含 cameraRules 格式', () => {
    const { system } = buildLocationPrompt(storyText, analysis, '王城')
    expect(system).toContain('cameraRules')
    expect(system).toContain('axisDirection')
    expect(system).toContain('forbiddenAngles')
  })

  it('system 中包含 scenePrompt 格式', () => {
    const { system } = buildLocationPrompt(storyText, analysis, '王城')
    expect(system).toContain('scenePrompt')
    expect(system).toContain('visualRules')
  })
})

describe('buildStoryboardPrompt', () => {
  const characters = [
    { id: 'char-uuid-1', name: '小明', identityPrompt: 'A brave young boy' },
    { id: 'char-uuid-2', name: '小红', identityPrompt: 'A clever girl' },
  ]
  const locations = [
    { id: 'loc-uuid-1', name: '王城', scenePrompt: 'A grand castle' },
    { id: 'loc-uuid-2', name: '森林', scenePrompt: 'A dark mysterious forest' },
  ]

  it('返回 system 和 prompt 字段', () => {
    const result = buildStoryboardPrompt(storyText, analysis, characters, locations)
    expect(result).toHaveProperty('system')
    expect(result).toHaveProperty('prompt')
  })

  it('prompt 中包含角色列表及 ID', () => {
    const { prompt } = buildStoryboardPrompt(storyText, analysis, characters, locations)
    expect(prompt).toContain('char-uuid-1')
    expect(prompt).toContain('小明')
    expect(prompt).toContain('char-uuid-2')
    expect(prompt).toContain('小红')
  })

  it('prompt 中包含场景列表及 ID', () => {
    const { prompt } = buildStoryboardPrompt(storyText, analysis, characters, locations)
    expect(prompt).toContain('loc-uuid-1')
    expect(prompt).toContain('王城')
    expect(prompt).toContain('loc-uuid-2')
    expect(prompt).toContain('森林')
  })

  it('prompt 中包含故事文本', () => {
    const { prompt } = buildStoryboardPrompt(storyText, analysis, characters, locations)
    expect(prompt).toContain(storyText.slice(0, 4000))
  })

  it('system 中包含时间线要求', () => {
    const { system } = buildStoryboardPrompt(storyText, analysis, characters, locations)
    expect(system).toContain('timeline')
    expect(system).toContain('duration')
    expect(system).toContain('continuity')
    expect(system).toContain('environment')
  })

  it('system 中包含 UUID 要求', () => {
    const { system } = buildStoryboardPrompt(storyText, analysis, characters, locations)
    expect(system).toContain('UUID')
  })

  it('system 中包含对话与音频要求（narrative 须交织对白+音效）', () => {
    const { system } = buildStoryboardPrompt(storyText, analysis, characters, locations)
    expect(system).toContain('对话与音频')
    expect(system).toContain('narrative')
  })

  it('prompt 要求 narrative 交织对白与环境音效', () => {
    const { prompt } = buildStoryboardPrompt(storyText, analysis, characters, locations)
    expect(prompt).toContain('对白')
    expect(prompt).toContain('环境音效')
  })

  it('处理空角色和场景列表', () => {
    const { prompt } = buildStoryboardPrompt(storyText, analysis, [], [])
    expect(prompt).toContain(storyText)
  })

  it('prompt 中包含分析内容', () => {
    const { prompt } = buildStoryboardPrompt(storyText, analysis, characters, locations)
    expect(prompt).toContain(analysis.summary)
    expect(prompt).toContain(analysis.mainConflict)
    expect(prompt).toContain(analysis.timeline.join(' → '))
  })
})
