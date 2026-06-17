import { describe, expect, it } from 'bun:test'
import { hasDialogueAudio } from '../src/canvas'

describe('hasDialogueAudio', () => {
  it('中文「」引号 → 有对话音频', () => {
    expect(hasDialogueAudio('小明缓步上前：「我不能丢下你不管」')).toBe(true)
  })

  it('中文『』引号 → 有对话音频', () => {
    expect(hasDialogueAudio('旁白：『故事就此开始』')).toBe(true)
  })

  it('英文双引号 → 有对话音频', () => {
    expect(hasDialogueAudio('Alice walks closer and says "I will not leave you behind"')).toBe(true)
  })

  it('弯引号 “” → 有对话音频', () => {
    expect(hasDialogueAudio('小红轻声说：“真的吗？”')).toBe(true)
  })

  it('无引号的纯动作叙述 → 无对话音频', () => {
    expect(hasDialogueAudio('人物缓慢抬头看向远方，眼神聚焦，嘴唇微张')).toBe(false)
  })

  it('仅时间戳不含对白 → 无对话音频（避免时间轴误判）', () => {
    expect(hasDialogueAudio('0s-1s: 站立，5s: 抬头')).toBe(false)
  })

  it('null / undefined / 空串 → 无对话音频', () => {
    expect(hasDialogueAudio(null)).toBe(false)
    expect(hasDialogueAudio(undefined)).toBe(false)
    expect(hasDialogueAudio('')).toBe(false)
  })

  it('非字符串（防御） → 无对话音频', () => {
    expect(hasDialogueAudio(123 as unknown as string)).toBe(false)
  })
})
