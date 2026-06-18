import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'

export default function StoryInputNode({ data }: NodeProps) {
  const project = (data as { project: { storyText: string, title: string | null } }).project

  return (
    <div className="rounded-lg border-2 border-[color:var(--status-info-border)] bg-[color:var(--status-info-bg)] shadow-md w-85">
      <div className="bg-[color:var(--status-info-fg)] text-white px-3 py-2 rounded-t-md font-semibold text-sm">
        故事输入
      </div>
      <div className="p-3 space-y-2 text-sm">
        {project.title && (
          <div>
            <span className="text-muted-foreground">标题：</span>
            <span className="font-medium">{project.title}</span>
          </div>
        )}
        <div>
          <span className="text-muted-foreground">故事文本：</span>
          <p className="mt-1 text-xs bg-white rounded p-2 max-h-30 overflow-auto whitespace-pre-wrap">
            {project.storyText.slice(0, 500)}
            {project.storyText.length > 500 ? '...' : ''}
          </p>
        </div>
        <div className="text-xs text-muted-foreground">
          共
          {project.storyText.length}
          {' '}
          字符
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-[color:var(--status-info-fg)]" />
    </div>
  )
}
