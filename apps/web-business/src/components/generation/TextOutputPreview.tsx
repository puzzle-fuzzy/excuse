import type { TextOutputResult } from '@excuse/shared'

export default function TextOutputPreview({ output }: { output: TextOutputResult }) {
  return (
    <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-2 text-xs">
      {output.text}
    </pre>
  )
}
