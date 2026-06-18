import { describe, expect, it } from 'bun:test'
import { parseCanvasLayout } from '../src/modules/canvas/layout'
import { ValidationError } from '../src/utils/app-errors'

describe('canvas 布局解析器', () => {
  it('解析 React Flow 风格的 layout DTO', () => {
    const layout = parseCanvasLayout({
      nodes: [{
        id: 'shot-1',
        type: 'shot',
        position: { x: 100, y: 200 },
        width: 240,
        data: { label: 'Shot 1' },
      }],
      edges: [{
        id: 'edge-1',
        source: 'shot-1',
        target: 'shot-2',
      }],
      viewport: { x: 0, y: 0, zoom: 1 },
    })

    expect(layout.nodes[0]?.position).toEqual({ x: 100, y: 200 })
    expect(layout.edges[0]?.source).toBe('shot-1')
    expect(layout.viewport?.zoom).toBe(1)
  })

  it('缺少 nodes 数组时拒绝', () => {
    expect(() => parseCanvasLayout({ edges: [] })).toThrow('nodes')
  })

  it('无效节点坐标时拒绝', () => {
    expect(() =>
      parseCanvasLayout({
        nodes: [{ id: 'shot-1', position: { x: '100', y: 200 } }],
        edges: [],
      }),
    ).toThrow('nodes[0].position.x')
  })

  it('无效边端点时拒绝', () => {
    expect(() =>
      parseCanvasLayout({
        nodes: [],
        edges: [{ id: 'edge-1', source: 'shot-1' }],
      }),
    ).toThrow('edges[0].target')
  })

  it('校验失败抛 ValidationError（statusCode=422）— TODO2 §2.3', () => {
    try {
      parseCanvasLayout({ edges: [] })
      expect.unreachable('应抛 ValidationError')
    }
    catch (err) {
      expect(err).toBeInstanceOf(ValidationError)
      expect((err as ValidationError).statusCode).toBe(422)
    }
  })
})
