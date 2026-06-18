import type { ModelConfig } from '@/api/client'
import type { Category } from '@/lib/generation-utils'
import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchModels } from '@/api/client'

export interface UseModelLabModelsReturn {
  models: ModelConfig[]
  loadingModels: boolean
  modelsError: string | null
  selectedCategory: Category
  selectedModelId: string
  selectedModel: ModelConfig | undefined
  categoryModels: ModelConfig[]
  chooseCategory: (category: Category) => void
  chooseModel: (id: string) => void
  loading: boolean
  error: string | null
}

export function useModelLabModels(): UseModelLabModelsReturn {
  const [models, setModels] = useState<ModelConfig[]>([])
  const [loadingModels, setLoadingModels] = useState(true)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [selectedCategory, setSelectedCategory] = useState<Category>('text')
  const [selectedModelId, setSelectedModelId] = useState('')
  const didLoadModelsRef = useRef(false)

  const selectedModel = useMemo(
    () => models.find(model => model.id === selectedModelId),
    [models, selectedModelId],
  )
  const categoryModels = useMemo(
    () => models.filter(model => model.category === selectedCategory),
    [models, selectedCategory],
  )

  useEffect(() => {
    if (didLoadModelsRef.current)
      return
    didLoadModelsRef.current = true
    let cancelled = false
    async function loadModelLabModels() {
      setLoadingModels(true)
      setModelsError(null)
      try {
        const data = await fetchModels()
        if (cancelled)
          return
        setModels(data.models)
        const firstText = data.models.find(model => model.category === 'text') ?? data.models[0]
        if (firstText) {
          setSelectedCategory(firstText.category as Category)
          setSelectedModelId(firstText.id)
        }
      }
      catch (err) {
        if (!cancelled)
          setModelsError(err instanceof Error ? err.message : '模型列表加载失败')
      }
      finally {
        if (!cancelled)
          setLoadingModels(false)
      }
    }
    loadModelLabModels()
    return () => {
      cancelled = true
    }
  }, [])

  function chooseCategory(category: Category) {
    setSelectedCategory(category)
    const nextModel = models.find(model => model.category === category)
    if (!nextModel)
      return
    setSelectedModelId(nextModel.id)
  }

  function chooseModel(id: string) {
    const nextModel = models.find(model => model.id === id)
    if (!nextModel)
      return
    setSelectedModelId(id)
    setSelectedCategory(nextModel.category as Category)
  }

  return {
    models,
    loadingModels,
    modelsError,
    selectedCategory,
    selectedModelId,
    selectedModel,
    categoryModels,
    chooseCategory,
    chooseModel,
    get loading() { return loadingModels },
    get error() { return modelsError },
  }
}
