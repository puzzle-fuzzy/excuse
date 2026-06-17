import type { CanvasVideoReference } from '@excuse/shared'
import { describe, expect, it } from 'bun:test'
import { buildR2VRequest, extractSpeakingCharacterIds, R2V_MAX_REFERENCES } from '../src/pure/r2v'

const char = (id: string, url = `https://cdn/${id}.jpg`): CanvasVideoReference => ({ url, role: 'character', characterId: id })
const loc = (id: string, url = `https://cdn/loc-${id}.jpg`): CanvasVideoReference => ({ url, role: 'location', locationId: id })
const firstFrame = (url: string): CanvasVideoReference => ({ url, role: 'firstFrame' })
const extra = (url: string): CanvasVideoReference => ({ url, role: 'other' })

describe('buildR2VRequest', () => {
  it('说话角色优先（turnaround）于非说话角色（portrait）', () => {
    const refs = [char('a'), char('b'), char('c')]
    const media = buildR2VRequest({ references: refs, speakingCharacterIds: ['b'] })
    expect(media).toHaveLength(3)
    expect(media[0]).toMatchObject({ characterId: 'b', kind: 'turnaround', imageNumber: 1 })
    expect(media[1]?.kind).toBe('portrait')
    expect(media[2]?.kind).toBe('portrait')
  })

  it('排序：turnaround → portrait → scene → extra', () => {
    // 故意打乱输入顺序
    const refs = [extra('x'), loc('L'), char('b'), char('a')]
    const media = buildR2VRequest({ references: refs, speakingCharacterIds: ['a'] })
    expect(media.map(m => m.kind)).toEqual(['turnaround', 'portrait', 'scene', 'extra'])
    expect(media.map(m => m.imageNumber)).toEqual([1, 2, 3, 4])
  })

  it('裁剪到 R2V_MAX_REFERENCES（9）', () => {
    const refs = Array.from({ length: 12 }, (_, i) => char(`c${i}`))
    const media = buildR2VRequest({ references: refs })
    expect(media).toHaveLength(R2V_MAX_REFERENCES)
    expect(media[0]?.imageNumber).toBe(1)
    expect(media[8]?.imageNumber).toBe(9)
  })

  it('firstFrame 不参与 R2V 预算（属 I2V 语义）', () => {
    const refs = [firstFrame('https://cdn/ff.jpg'), char('a')]
    const media = buildR2VRequest({ references: refs })
    expect(media).toHaveLength(1)
    expect(media[0]?.characterId).toBe('a')
  })

  it('无说话者时全部角色为 portrait', () => {
    const media = buildR2VRequest({ references: [char('a'), char('b')] })
    expect(media.every(m => m.kind === 'portrait')).toBe(true)
  })

  it('保留 characterId / locationId + imageNumber 连续', () => {
    const media = buildR2VRequest({ references: [char('a'), loc('L')], speakingCharacterIds: ['a'] })
    expect(media[0]).toMatchObject({ characterId: 'a', kind: 'turnaround' })
    expect(media[1]).toMatchObject({ locationId: 'L', kind: 'scene' })
  })

  it('max 可覆盖默认上限', () => {
    const refs = [char('a'), char('b'), char('c')]
    expect(buildR2VRequest({ references: refs, max: 2 })).toHaveLength(2)
  })

  it('空引用返回空数组', () => {
    expect(buildR2VRequest({ references: [] })).toEqual([])
  })

  it('跳过无 url 的引用', () => {
    const refs: CanvasVideoReference[] = [{ url: '', role: 'character', characterId: 'a' }, char('b')]
    expect(buildR2VRequest({ references: refs })).toHaveLength(1)
  })
})

describe('extractSpeakingCharacterIds', () => {
  const characters = [{ id: 'a', name: '小明' }, { id: 'b', name: '小红' }]

  it('把 speaker 名映射为角色 ID 并去重', () => {
    const dialogueJson = { lines: [{ speaker: '小明' }, { speaker: '小红' }, { speaker: '小明' }] }
    expect(extractSpeakingCharacterIds(dialogueJson, characters).sort()).toEqual(['a', 'b'])
  })

  it('非受信输入安全收窄（null / 非对象 / 缺 lines / 非数组）', () => {
    expect(extractSpeakingCharacterIds(null, characters)).toEqual([])
    expect(extractSpeakingCharacterIds(undefined, characters)).toEqual([])
    expect(extractSpeakingCharacterIds('string', characters)).toEqual([])
    expect(extractSpeakingCharacterIds({}, characters)).toEqual([])
    expect(extractSpeakingCharacterIds({ lines: 'not-array' }, characters)).toEqual([])
  })

  it('speaker 非字符串或未知名被忽略', () => {
    const dialogueJson = { lines: [{ speaker: 123 }, { speaker: '陌生人' }, { text: '无 speaker' }] }
    expect(extractSpeakingCharacterIds(dialogueJson, characters)).toEqual([])
  })
})
