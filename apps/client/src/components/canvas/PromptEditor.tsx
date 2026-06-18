import type { CharacterDTO, LocationDTO, ShotDTO } from '@excuse/shared'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'

interface MentionItem {
  type: 'character' | 'location' | 'shot'
  id: string
  name: string
  label: string
}

interface MentionGroup {
  heading: string
  type: 'character' | 'location' | 'shot'
  items: MentionItem[]
}

interface PromptEditorProps {
  value: string
  onChange: (value: string) => void
  characters: CharacterDTO[]
  locations: LocationDTO[]
  shots?: ShotDTO[]
  placeholder?: string
  rows?: number
  disabled?: boolean
}

const TYPE_PREFIX = { character: 'Character', location: 'Location', shot: 'Shot' } as const
const TYPE_LABEL = { character: '角色', location: '场景', shot: '镜头' } as const
const TYPE_COLORS = {
  character: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  location: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  shot: 'border border-[color:var(--status-info-border)] bg-[color:var(--status-info-bg)] text-[color:var(--status-info-fg)]',
} as const

export function PromptEditor({
  value,
  onChange,
  characters,
  locations,
  shots,
  placeholder = '输入提示词，@ 插入角色/场景/镜头引用...',
  rows = 4,
  disabled = false,
}: PromptEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [showMentions, setShowMentions] = useState(false)
  const [mentionFilter, setMentionFilter] = useState('')
  const [mentionIndex, setMentionIndex] = useState(0)
  const [mentionStart, setMentionStart] = useState(-1)

  const mentionGroups: MentionGroup[] = [
    {
      heading: '角色',
      type: 'character',
      items: characters.map(c => ({ type: 'character', id: c.id, name: c.name, label: c.name })),
    },
    {
      heading: '场景',
      type: 'location',
      items: locations.map(l => ({ type: 'location', id: l.id, name: l.name, label: l.name })),
    },
    ...(shots?.length
      ? [{
          heading: '镜头',
          type: 'shot' as const,
          items: shots.map(s => ({ type: 'shot' as const, id: s.id, name: `镜头 ${s.shotIndex}`, label: String(s.shotIndex) })),
        }]
      : []),
  ]

  const filteredGroups = mentionGroups
    .map(g => ({
      ...g,
      items: g.items.filter(item => item.name.toLowerCase().includes(mentionFilter.toLowerCase())),
    }))
    .filter(g => g.items.length > 0)

  const filteredItems = filteredGroups.flatMap(g => g.items)

  const insertMention = useCallback((item: MentionItem) => {
    const textarea = textareaRef.current
    if (!textarea)
      return

    const before = value.slice(0, mentionStart)
    const after = value.slice(textarea.selectionStart)
    const tag = `[${TYPE_PREFIX[item.type]}:${item.label}]`
    const newValue = `${before}${tag}${after}`

    onChange(newValue)
    setShowMentions(false)
    setMentionFilter('')

    requestAnimationFrame(() => {
      const cursorPos = before.length + tag.length
      textarea.focus()
      textarea.setSelectionRange(cursorPos, cursorPos)
    })
  }, [value, mentionStart, onChange])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!showMentions)
      return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setMentionIndex(prev => Math.min(prev + 1, filteredItems.length - 1))
    }
    else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setMentionIndex(prev => Math.max(prev - 1, 0))
    }
    else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      const item = filteredItems[mentionIndex]
      if (item)
        insertMention(item)
    }
    else if (e.key === 'Escape') {
      setShowMentions(false)
    }
  }, [showMentions, filteredItems, mentionIndex, insertMention])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value
    const cursorPos = e.target.selectionStart
    onChange(newValue)

    const textBeforeCursor = newValue.slice(0, cursorPos)
    const atIndex = textBeforeCursor.lastIndexOf('@')

    if (atIndex !== -1) {
      const textAfterAt = textBeforeCursor.slice(atIndex + 1)
      if (atIndex === 0 || /[\s[]$/.test(newValue[atIndex - 1])) {
        if (textAfterAt.includes(' ') || textAfterAt.includes('\n')) {
          setShowMentions(false)
          return
        }
        setShowMentions(true)
        setMentionFilter(textAfterAt)
        setMentionStart(atIndex)
        setMentionIndex(0)
      }
      else {
        setShowMentions(false)
      }
    }
    else {
      setShowMentions(false)
    }
  }, [onChange])

  useEffect(() => {
    setMentionIndex(0)
  }, [filteredItems.length])

  // Compute flat index for each item across groups for highlight tracking
  let flatIndex = 0

  return (
    <Popover open={showMentions} onOpenChange={setShowMentions} modal={false}>
      <PopoverAnchor asChild>
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={() => setTimeout(setShowMentions, 150, false)}
          placeholder={placeholder}
          rows={rows}
          disabled={disabled}
          className="resize-y font-mono"
        />
      </PopoverAnchor>
      <PopoverContent
        onOpenAutoFocus={e => e.preventDefault()}
        className="w-[--radix-popover-trigger-width] max-h-64 overflow-auto p-1"
        align="start"
        sideOffset={4}
      >
        {filteredGroups.length === 0 && (
          <p className="px-3 py-2 text-sm text-muted-foreground">无匹配结果</p>
        )}
        {filteredGroups.map(group => (
          <div key={group.type} className="mb-1 last:mb-0">
            <p className="px-2 py-1 text-xs font-medium text-muted-foreground">{group.heading}</p>
            {group.items.map((item) => {
              const currentIndex = flatIndex++
              return (
                <button
                  key={`${item.type}-${item.id}`}
                  type="button"
                  className={`w-full px-2 py-1.5 text-left text-sm flex items-center gap-2 rounded-sm transition-colors ${
                    currentIndex === mentionIndex
                      ? 'bg-accent text-accent-foreground'
                      : 'hover:bg-accent/50'
                  }`}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    insertMention(item)
                  }}
                >
                  <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${TYPE_COLORS[item.type]}`}>
                    {TYPE_LABEL[item.type]}
                  </span>
                  <span>{item.name}</span>
                </button>
              )
            })}
          </div>
        ))}
      </PopoverContent>
    </Popover>
  )
}
