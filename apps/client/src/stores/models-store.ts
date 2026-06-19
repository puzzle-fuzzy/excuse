import type { ModelConfig } from '@/api/client'
import type { Category } from '@/lib/generation-utils'
import { create } from 'zustand'
import { fetchModels } from '@/api/client'

export interface ModelsState {
  models: ModelConfig[]
  selectedCategory: Category
  selectedModelId: string
  loading: boolean

  // Actions
  loadModels: () => Promise<void>
  setCategory: (category: Category) => void
  setModelId: (id: string) => void
}

export const useModelsStore = create<ModelsState>((set, get) => ({
  models: [],
  selectedCategory: 'image',
  selectedModelId: '',
  loading: false,

  loadModels: async () => {
    set({ loading: true })
    try {
      const data = await fetchModels()
      const { selectedCategory, selectedModelId } = get()
      const models = data.models
      // 如果当前没有选中模型，自动选中当前分类的第一个模型
      if (!selectedModelId || !models.some(m => m.id === selectedModelId)) {
        const categoryModels = models.filter(m => m.category === selectedCategory)
        if (categoryModels.length > 0) {
          const model = categoryModels[0]
          set({
            models,
            selectedModelId: model.id,
            loading: false,
          })
          return
        }
      }
      set({ models, loading: false })
    }
    catch {
      set({ loading: false })
    }
  },

  setCategory: (category) => {
    set({ selectedCategory: category })
    const categoryModels = get().models.filter(m => m.category === category)
    if (categoryModels.length > 0) {
      const model = categoryModels[0]
      set({
        selectedModelId: model.id,
      })
    }
  },

  setModelId: (id) => {
    const model = get().models.find(m => m.id === id)
    if (model) {
      set({ selectedModelId: id })
    }
  },
}))
