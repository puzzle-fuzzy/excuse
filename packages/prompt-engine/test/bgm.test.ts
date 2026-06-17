import { describe, expect, it } from 'bun:test'
import { buildBgmPrompt } from '../src/bgm'

describe('buildBgmPrompt (Phase 10 BGM)', () => {
  it('情绪命中映射时输出对应风格 + 配器 + 节奏', () => {
    const prompt = buildBgmPrompt({ storySummary: '主角穿越森林寻找失落的神器', mood: '紧张' })
    expect(prompt).toContain('紧张悬疑')
    expect(prompt).toContain('弦乐顿弓')
    expect(prompt).toContain('急促')
    expect(prompt).toContain('主角穿越森林寻找失落的神器')
  })

  it('用户显式 genre 优先，仍叠加情绪节奏', () => {
    const prompt = buildBgmPrompt({ storySummary: '都市爱情故事', mood: '温馨', genre: '民谣' })
    expect(prompt.startsWith('民谣风格')).toBe(true)
    expect(prompt).toContain('温馨')
    expect(prompt).toContain('都市爱情故事')
  })

  it('未命中映射的情绪回退到中性氛围配乐', () => {
    const prompt = buildBgmPrompt({ storySummary: '一段日常片段', mood: '平淡无奇' })
    expect(prompt).toContain('舒缓柔和')
    expect(prompt).toContain('钢琴')
  })

  it('无情绪时使用中性氛围', () => {
    const prompt = buildBgmPrompt({ storySummary: '风景记录片' })
    expect(prompt).toContain('舒缓柔和')
  })

  it('长摘要被截断（不超过 FunMusic 2000 字符上限）', () => {
    const longSummary = '故事'.repeat(2000) // 4000 字符
    const prompt = buildBgmPrompt({ storySummary: longSummary })
    expect(prompt.length).toBeLessThan(2000)
    expect(prompt).toContain('…')
  })

  it('情绪关键词模糊匹配（"略带紧张" 命中紧张）', () => {
    const prompt = buildBgmPrompt({ storySummary: 'x', mood: '略带紧张的氛围' })
    expect(prompt).toContain('紧张悬疑')
  })
})
