import type { CanvasAssetsPoll, ProjectDTO } from '@excuse/shared'
import type { Edge, Node, NodeTypes } from '@xyflow/react'
import type { RunningPhaseInfo } from './PipelineController'
import dagre from '@dagrejs/dagre'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react'
import { useCallback, useEffect, useRef } from 'react'
import { buildActiveImageTaskMaps } from '@/lib/canvas-poll'
import AnalysisNode from './nodes/AnalysisNode'
import CharacterNode from './nodes/CharacterNode'
import ContinuityCheckNode from './nodes/ContinuityCheckNode'
import LocationNode from './nodes/LocationNode'
import ShotNode from './nodes/ShotNode'
import StoryInputNode from './nodes/StoryInputNode'
import '@xyflow/react/dist/style.css'

const NODE_WIDTH = 340
const NODE_SEP = 80
const RANK_SEP = 120

const nodeTypes: NodeTypes = {
  storyInput: StoryInputNode,
  analysis: AnalysisNode,
  character: CharacterNode,
  location: LocationNode,
  shot: ShotNode,
  continuityCheck: ContinuityCheckNode,
}

const PHASE_NODE_TYPE: Record<string, string> = {
  analyze: 'analysis',
  characters: 'character',
  locations: 'location',
  characterRefs: 'character',
  locationRefs: 'location',
  storyboard: 'shot',
  continuity: 'continuityCheck',
  rebuild: 'shot',
  videos: 'shot',
}

function computeLayout(nodes: Node[], edges: Edge[]): Node[] {
  if (nodes.length === 0)
    return nodes

  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'TB', nodesep: NODE_SEP, ranksep: RANK_SEP })

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: node.measured?.height ?? 200 })
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target)
  }

  dagre.layout(g)

  return nodes.map((node) => {
    const pos = g.node(node.id)
    if (!pos)
      return node
    return {
      ...node,
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - (node.measured?.height ?? 200) / 2 },
    }
  })
}

export function buildNodesAndEdges(project: ProjectDTO, runningPhase: RunningPhaseInfo | null = null, pollData?: CanvasAssetsPoll | null): { nodes: Node[], edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []
  const runningNodeType = runningPhase ? PHASE_NODE_TYPE[runningPhase.key] : null
  const isRunning = (type: string) => runningNodeType === type

  // 角色/场景 → 活跃图片任务 ID 映射（驱动节点「正在生成参考图」占位与「生成中」角标）
  const { character: characterActiveTaskIds, location: locationActiveTaskIds } = buildActiveImageTaskMaps(pollData)

  nodes.push({
    id: 'story',
    type: 'storyInput',
    position: { x: 0, y: 0 },
    data: { project, isRunning: false, runningPhaseInfo: null },
  })

  if (project.analysis) {
    nodes.push({
      id: 'analysis',
      type: 'analysis',
      position: { x: 0, y: 0 },
      data: { project, isRunning: isRunning('analysis'), runningPhaseInfo: isRunning('analysis') ? runningPhase : null },
    })
    edges.push({ id: 'e-story-analysis', source: 'story', target: 'analysis' })
  }

  for (const char of project.characters) {
    const nodeId = `char-${char.id}`
    nodes.push({
      id: nodeId,
      type: 'character',
      position: { x: 0, y: 0 },
      data: { character: char, project, isRunning: isRunning('character'), runningPhaseInfo: isRunning('character') ? runningPhase : null, activeImageTaskIds: characterActiveTaskIds.get(char.id) ?? [] },
    })
    if (project.analysis) {
      edges.push({ id: `e-analysis-${nodeId}`, source: 'analysis', target: nodeId })
    }
  }

  for (const loc of project.locations) {
    const nodeId = `loc-${loc.id}`
    nodes.push({
      id: nodeId,
      type: 'location',
      position: { x: 0, y: 0 },
      data: { location: loc, project, isRunning: isRunning('location'), runningPhaseInfo: isRunning('location') ? runningPhase : null, activeImageTaskIds: locationActiveTaskIds.get(loc.id) ?? [] },
    })
    if (project.analysis) {
      edges.push({ id: `e-analysis-${nodeId}`, source: 'analysis', target: nodeId })
    }
  }

  for (const shot of project.shots) {
    const nodeId = `shot-${shot.id}`
    nodes.push({
      id: nodeId,
      type: 'shot',
      position: { x: 0, y: 0 },
      data: { shot, project, isRunning: isRunning('shot'), runningPhaseInfo: isRunning('shot') ? runningPhase : null },
    })
    for (const charId of shot.characterIds) {
      edges.push({ id: `e-char-${charId}-${shot.id}`, source: `char-${charId}`, target: nodeId })
    }
    if (shot.locationId) {
      edges.push({ id: `e-loc-${shot.locationId}-${shot.id}`, source: `loc-${shot.locationId}`, target: nodeId })
    }
  }

  if (project.continuityIssues.length > 0) {
    nodes.push({
      id: 'continuity',
      type: 'continuityCheck',
      position: { x: 0, y: 0 },
      data: { project, isRunning: isRunning('continuityCheck'), runningPhaseInfo: isRunning('continuityCheck') ? runningPhase : null },
    })
    for (const shot of project.shots) {
      edges.push({ id: `e-shot-${shot.id}-cont`, source: `shot-${shot.id}`, target: 'continuity' })
    }
  }

  return { nodes, edges }
}

function CanvasFlowInner(props: {
  project: ProjectDTO
  runningPhase: RunningPhaseInfo | null
  pollData?: CanvasAssetsPoll | null
  onNodeClick?: (nodeId: string, nodeType: string) => void
}) {
  const { project, runningPhase, pollData, onNodeClick } = props
  const { fitView, getNodes, getEdges } = useReactFlow()
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges] = useEdgesState<Edge>([])
  const fittedOnceRef = useRef(false)
  const savedPositionsRef = useRef(new Map<string, { x: number, y: number }>())
  const measuredSigRef = useRef('')

  // Build nodes when project or running phase changes
  useEffect(() => {
    const { nodes: built, edges: builtEdges } = buildNodesAndEdges(project, runningPhase, pollData)

    // Merge with existing nodes to preserve positions and measurements
    const current = getNodes()
    const existing = new Map(current.map(n => [n.id, n]))

    const merged = built.map((n) => {
      const prev = existing.get(n.id)
      if (prev) {
        return { ...n, position: prev.position, measured: prev.measured }
      }
      return n
    })

    // Run dagre layout
    const laidOut = computeLayout(merged, builtEdges)

    // Existing nodes keep saved positions; new nodes get dagre positions.
    // 不在此处保存——节点尚未被 DOM 测量（height=200 占位），保存会阻止第二 useEffect 的实测重排。
    const final = laidOut.map((n) => {
      const saved = savedPositionsRef.current.get(n.id)
      if (saved) {
        return { ...n, position: saved }
      }
      return n
    })

    setNodes(final)
    setEdges(builtEdges)
    // pollData 携带 activeImageTaskIds（图片生成中的节点状态），必须作为依赖，
    // 否则单次重新生成或在阶段内部图片开始/完成时，节点的「生成中」角标不会刷新（stale closure）。
  }, [project, runningPhase, pollData, getNodes, setNodes, setEdges])

  // After render: capture measurements and re-layout nodes
  useEffect(() => {
    let timer: number | undefined
    const raf = requestAnimationFrame(() => {
      const current = getNodes()
      if (current.length === 0)
        return

      // 找出未保存位置但已有实测高度的节点（首帧全部未保存，后续只算新增）
      const unsavedMeasured = current.filter(
        n => !savedPositionsRef.current.has(n.id) && n.measured?.height,
      )

      if (unsavedMeasured.length > 0) {
        // 用实测高度重排并保存位置
        const sig = current.map(n => `${n.id}:${n.measured?.height ?? 0}`).join('|')
        if (sig !== measuredSigRef.current) {
          measuredSigRef.current = sig
          const laidOut = computeLayout(current, getEdges())
          const final = laidOut.map((n) => {
            const saved = savedPositionsRef.current.get(n.id)
            if (saved) {
              return { ...n, position: saved }
            }
            savedPositionsRef.current.set(n.id, n.position)
            return n
          })
          setNodes(final)
        }
      }

      // 首帧等所有节点都测量完并布局好后再 fitView
      if (!fittedOnceRef.current) {
        const allDone = current.every(n => savedPositionsRef.current.has(n.id))
        if (allDone) {
          timer = window.setTimeout(fitView, 100, { padding: 0.15, duration: 300 })
          fittedOnceRef.current = true
        }
      }
    })
    return () => {
      cancelAnimationFrame(raf)
      if (timer)
        clearTimeout(timer)
    }
    // 依赖 nodes：第一 useEffect 设 nodes 后会重跑，有机会捕获测量值
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, getNodes, getEdges])

  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    onNodeClick?.(node.id, node.type ?? '')
  }, [onNodeClick])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onNodeClick={handleNodeClick}
      nodeTypes={nodeTypes}
      nodesDraggable={false}
      nodesConnectable={false}
      minZoom={0.1}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
      defaultViewport={{ x: 0, y: 0, zoom: 0.8 }}
    >
      <Background />
      <Controls position="bottom-left" />
      <MiniMap position="bottom-right" nodeStrokeWidth={3} zoomable pannable />
      {nodes.length <= 1 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center text-muted-foreground space-y-2">
            <p className="text-sm">暂无节点数据</p>
            <p className="text-xs">点击下方「自动执行全部」开始生成流水线</p>
          </div>
        </div>
      )}
    </ReactFlow>
  )
}

export default function CanvasFlow(props: {
  project: ProjectDTO
  runningPhase: RunningPhaseInfo | null
  pollData?: CanvasAssetsPoll | null
  onNodeClick?: (nodeId: string, nodeType: string) => void
}) {
  return (
    <ReactFlowProvider>
      <CanvasFlowInner {...props} />
    </ReactFlowProvider>
  )
}
