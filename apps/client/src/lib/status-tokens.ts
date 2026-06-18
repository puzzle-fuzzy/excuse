import type { CanvasFailureKind } from '@excuse/shared'
import { cn } from './utils'

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent'

const TONE_CLASSES: Record<StatusTone, string> = {
  neutral: 'border-[color:var(--status-neutral-border)] bg-[color:var(--status-neutral-bg)] text-[color:var(--status-neutral-fg)]',
  info: 'border-[color:var(--status-info-border)] bg-[color:var(--status-info-bg)] text-[color:var(--status-info-fg)]',
  success: 'border-[color:var(--status-success-border)] bg-[color:var(--status-success-bg)] text-[color:var(--status-success-fg)]',
  warning: 'border-[color:var(--status-warning-border)] bg-[color:var(--status-warning-bg)] text-[color:var(--status-warning-fg)]',
  danger: 'border-[color:var(--status-danger-border)] bg-[color:var(--status-danger-bg)] text-[color:var(--status-danger-fg)]',
  accent: 'border-[color:var(--status-accent-border)] bg-[color:var(--status-accent-bg)] text-[color:var(--status-accent-fg)]',
}

const TEXT_CLASSES: Record<StatusTone, string> = {
  neutral: 'text-[color:var(--status-neutral-fg)]',
  info: 'text-[color:var(--status-info-fg)]',
  success: 'text-[color:var(--status-success-fg)]',
  warning: 'text-[color:var(--status-warning-fg)]',
  danger: 'text-[color:var(--status-danger-fg)]',
  accent: 'text-[color:var(--status-accent-fg)]',
}

const DOT_CLASSES: Record<StatusTone, string> = {
  neutral: 'bg-[color:var(--status-neutral-fg)]',
  info: 'bg-[color:var(--status-info-fg)]',
  success: 'bg-[color:var(--status-success-fg)]',
  warning: 'bg-[color:var(--status-warning-fg)]',
  danger: 'bg-[color:var(--status-danger-fg)]',
  accent: 'bg-[color:var(--status-accent-fg)]',
}

export function statusToneClass(tone: StatusTone, className?: string) {
  return cn(TONE_CLASSES[tone], className)
}

export function statusTextClass(tone: StatusTone, className?: string) {
  return cn(TEXT_CLASSES[tone], className)
}

export function statusDotClass(tone: StatusTone, className?: string) {
  return cn(DOT_CLASSES[tone], className)
}

export function statusBadgeClass(tone: StatusTone, className?: string) {
  return cn(
    'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
    TONE_CLASSES[tone],
    className,
  )
}

export const CATEGORY_TOKENS: Record<string, { icon: string, active: string, bar: string }> = {
  text: {
    icon: 'text-[color:var(--brand-text)]',
    active: 'bg-[color:var(--brand-text)] text-white',
    bar: 'bg-[color:var(--brand-text)]',
  },
  image: {
    icon: 'text-[color:var(--brand-image)]',
    active: 'bg-[color:var(--brand-image)] text-white',
    bar: 'bg-[color:var(--brand-image)]',
  },
  video: {
    icon: 'text-[color:var(--brand-video)]',
    active: 'bg-[color:var(--brand-video)] text-white',
    bar: 'bg-[color:var(--brand-video)]',
  },
  audio: {
    icon: 'text-[color:var(--primary)]',
    active: 'bg-primary text-primary-foreground',
    bar: 'bg-primary',
  },
  subtitle: {
    icon: 'text-[color:var(--primary)]',
    active: 'bg-primary text-primary-foreground',
    bar: 'bg-primary',
  },
}

export const GENERATION_STATUS_TONES: Record<string, StatusTone> = {
  pending: 'warning',
  submitting: 'warning',
  processing: 'info',
  saving_output: 'info',
  succeeded: 'success',
  failed: 'danger',
  cancelled: 'neutral',
}

export const CANVAS_PROJECT_STATUS_TONES: Record<string, StatusTone> = {
  draft: 'neutral',
  analyzed: 'info',
  characters_ready: 'info',
  locations_ready: 'info',
  refs_ready: 'accent',
  refs_all_ready: 'accent',
  storyboard_ready: 'success',
  continuity_checked: 'success',
  prompts_ready: 'success',
  generating: 'warning',
  partial_failed: 'warning',
  completed: 'success',
  failed: 'danger',
}

export const SHOT_STATUS_TONES: Record<string, StatusTone> = {
  draft: 'neutral',
  ready: 'info',
  generating: 'warning',
  completed: 'success',
  failed: 'danger',
}

export const TASK_STATUS_TONES: Record<string, StatusTone> = {
  queued: 'neutral',
  pending: 'neutral',
  running: 'info',
  submitting: 'warning',
  processing: 'info',
  saving_output: 'info',
}

export const FAILURE_KIND_TONES: Record<CanvasFailureKind, StatusTone> = {
  balance: 'danger',
  content: 'warning',
  network: 'warning',
  storage: 'accent',
  cancel: 'neutral',
  provider: 'info',
  system: 'neutral',
}
