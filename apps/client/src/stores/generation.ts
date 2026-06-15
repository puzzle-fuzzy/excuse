import type { ProjectDTO, SSEGenerationStatusEvent } from '@excuse/shared'
import type { GenerationRecord } from '@/api/client'
import { parseCostDetail, parseOutputResult } from '@excuse/shared'
import { create } from 'zustand'
import { fetchRecords, listCanvasProjects } from '@/api/client'

/** 将后端原始 GenerationRecord 的 outputResult/cost 规范化为前端可用的域类型 */
function normalizeRecord(raw: GenerationRecord): GenerationRecord {
  return {
    ...raw,
    outputResult: raw.outputResult ? parseOutputResult(raw.outputResult) : raw.outputResult,
    cost: raw.cost ? parseCostDetail(raw.cost) : raw.cost,
    cancelRequestedAt: raw.cancelRequestedAt ?? null,
    providerCancelStatus: raw.providerCancelStatus ?? 'not_requested',
  }
}

interface GenerationState {
  records: GenerationRecord[]
  projectMap: Map<string, ProjectDTO>
  loadingRecords: boolean

  fetchRecords: () => Promise<void>
  fetchProjects: () => Promise<void>
  addRecord: (record: GenerationRecord) => void
  removeRecord: (id: string) => void
  updateRecordFromSSE: (event: SSEGenerationStatusEvent) => void
}

export const useGenerationStore = create<GenerationState>((set, get) => ({
  records: [],
  projectMap: new Map(),
  loadingRecords: false,

  fetchRecords: async () => {
    set({ loadingRecords: true })
    try {
      const data = await fetchRecords({ limit: 100 })
      set({ records: data.items.map(normalizeRecord), loadingRecords: false })
    }
    catch {
      set({ loadingRecords: false })
    }
  },

  fetchProjects: async () => {
    try {
      const data = await listCanvasProjects()
      const map = new Map<string, ProjectDTO>()
      for (const p of data.items) {
        map.set(p.id, p)
      }
      set({ projectMap: map })
    }
    catch {}
  },

  addRecord: (record) => {
    set({ records: [normalizeRecord(record), ...get().records] })
  },

  removeRecord: (id) => {
    set({ records: get().records.filter(r => r.id !== id) })
  },

  updateRecordFromSSE: (event) => {
    const { records } = get()
    const existingIndex = records.findIndex(r => r.id === event.id)
    if (existingIndex >= 0) {
      const next = [...records]
      next[existingIndex] = {
        ...next[existingIndex],
        status: event.status,
        ...(event.outputResult && { outputResult: parseOutputResult(event.outputResult) }),
        ...(event.errorMessage && { errorMessage: event.errorMessage }),
        ...(event.cost && { cost: parseCostDetail(event.cost) }),
      }
      set({ records: next })
    }
    else {
      get().fetchRecords()
    }
  },
}))
