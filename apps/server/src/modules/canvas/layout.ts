import type { CanvasLayoutDto, CanvasLayoutEdge, CanvasLayoutNode, CanvasLayoutViewport } from '@excuse/shared'
import { ValidationError } from '../../utils/app-errors'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0)
    throw new ValidationError(`画布布局字段 ${field} 必须是非空字符串`)
  return value
}

function assertNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new ValidationError(`画布布局字段 ${field} 必须是有效数字`)
  return value
}

function parseData(value: unknown, field: string): Record<string, unknown> | undefined {
  if (value === undefined)
    return undefined
  if (!isRecord(value))
    throw new ValidationError(`画布布局字段 ${field} 必须是对象`)
  return value
}

function parsePosition(value: unknown, field: string) {
  if (!isRecord(value))
    throw new ValidationError(`画布布局字段 ${field} 必须是对象`)
  return {
    x: assertNumber(value.x, `${field}.x`),
    y: assertNumber(value.y, `${field}.y`),
  }
}

function parseNode(value: unknown, index: number): CanvasLayoutNode {
  if (!isRecord(value))
    throw new ValidationError(`画布布局节点 ${index} 必须是对象`)

  const node: CanvasLayoutNode = {
    id: assertString(value.id, `nodes[${index}].id`),
    position: parsePosition(value.position, `nodes[${index}].position`),
  }

  if (value.type !== undefined)
    node.type = assertString(value.type, `nodes[${index}].type`)
  if (value.width !== undefined)
    node.width = assertNumber(value.width, `nodes[${index}].width`)
  if (value.height !== undefined)
    node.height = assertNumber(value.height, `nodes[${index}].height`)
  const data = parseData(value.data, `nodes[${index}].data`)
  if (data)
    node.data = data

  return node
}

function parseEdge(value: unknown, index: number): CanvasLayoutEdge {
  if (!isRecord(value))
    throw new ValidationError(`画布布局边 ${index} 必须是对象`)

  const edge: CanvasLayoutEdge = {
    id: assertString(value.id, `edges[${index}].id`),
    source: assertString(value.source, `edges[${index}].source`),
    target: assertString(value.target, `edges[${index}].target`),
  }

  if (value.type !== undefined)
    edge.type = assertString(value.type, `edges[${index}].type`)
  const data = parseData(value.data, `edges[${index}].data`)
  if (data)
    edge.data = data

  return edge
}

function parseViewport(value: unknown): CanvasLayoutViewport | undefined {
  if (value === undefined)
    return undefined
  const position = parsePosition(value, 'viewport')
  return {
    ...position,
    zoom: assertNumber((value as Record<string, unknown>).zoom, 'viewport.zoom'),
  }
}

export function parseCanvasLayout(value: unknown): CanvasLayoutDto {
  if (!isRecord(value))
    throw new ValidationError('画布布局必须是对象')
  if (!Array.isArray(value.nodes))
    throw new ValidationError('画布布局字段 nodes 必须是数组')
  if (!Array.isArray(value.edges))
    throw new ValidationError('画布布局字段 edges 必须是数组')

  const layout: CanvasLayoutDto = {
    nodes: value.nodes.map(parseNode),
    edges: value.edges.map(parseEdge),
  }

  const viewport = parseViewport(value.viewport)
  if (viewport)
    layout.viewport = viewport

  return layout
}
