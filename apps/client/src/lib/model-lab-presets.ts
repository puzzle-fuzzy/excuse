import type { CanvasModelPreferences } from '@excuse/shared'
import type { ModelConfig } from '@/api/client'

const CANVAS_DEFAULTS_STORAGE_KEY = 'excuse:model-lab:canvas-defaults'

export interface SavedCanvasModelDefaults {
  preferences: CanvasModelPreferences
  updatedAt: string
  source: 'model-lab'
}

function isCanvasModelPreferences(value: unknown): value is CanvasModelPreferences {
  if (typeof value !== 'object' || value === null)
    return false
  const prefs = value as Record<string, unknown>
  return ['textModel', 'imageModel', 'videoModel'].every(key => prefs[key] === undefined || typeof prefs[key] === 'string')
    && (prefs.autoProgress === undefined || typeof prefs.autoProgress === 'boolean')
}

export function modelToCanvasPreferencePatch(model: ModelConfig): CanvasModelPreferences {
  if (model.category === 'text')
    return { textModel: model.id }
  if (model.category === 'image')
    return { imageModel: model.id }
  if (model.category === 'video')
    return { videoModel: model.id }
  return {}
}

export function loadCanvasModelDefaults(storage: Pick<Storage, 'getItem'> = localStorage): SavedCanvasModelDefaults | null {
  try {
    const raw = storage.getItem(CANVAS_DEFAULTS_STORAGE_KEY)
    if (!raw)
      return null
    const parsed = JSON.parse(raw) as Partial<SavedCanvasModelDefaults>
    if (!isCanvasModelPreferences(parsed.preferences) || typeof parsed.updatedAt !== 'string')
      return null
    return {
      preferences: parsed.preferences,
      updatedAt: parsed.updatedAt,
      source: 'model-lab',
    }
  }
  catch {
    return null
  }
}

export function saveCanvasModelDefaults(
  patch: CanvasModelPreferences,
  storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
): SavedCanvasModelDefaults {
  const current = loadCanvasModelDefaults(storage)?.preferences ?? {}
  const next: SavedCanvasModelDefaults = {
    preferences: { ...current, ...patch },
    updatedAt: new Date().toISOString(),
    source: 'model-lab',
  }
  storage.setItem(CANVAS_DEFAULTS_STORAGE_KEY, JSON.stringify(next))
  return next
}
