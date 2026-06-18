import type { GenerateResponse, GenerationRecord, ModelConfig, ModelParameter } from '@/api/client'
import type { Category } from '@/lib/generation-utils'
import { create } from 'zustand'
import {
  deleteRecord,
  fetchModels,
  generate,
  uploadFile,
} from '@/api/client'
import { useGenerationStore } from './generation'
import { handleApiError } from '@/lib/utils'

export type WorkspaceParameterValue = string | number | boolean | string[] | null

export interface WorkspaceParameters {
  [name: string]: WorkspaceParameterValue
}

function toWorkspaceParameterValue(value: unknown): WorkspaceParameterValue | undefined {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null)
    return value
  if (Array.isArray(value) && value.every(item => typeof item === 'string'))
    return value
  return undefined
}

/** 参数默认值：prompt 空字符串，数字 0，布尔 false，其余空字符串 */
export function getParamDefault(param: ModelParameter): WorkspaceParameterValue {
  if (param.name === 'prompt')
    return ''
  return toWorkspaceParameterValue(param.defaultValue) ?? (param.type === 'number' ? 0 : param.type === 'boolean' ? false : '')
}

/** 根据模型参数列表构建初始参数 */
export function buildInitialParameters(model: ModelConfig): WorkspaceParameters {
  const defaults: WorkspaceParameters = {}
  for (const p of model.parameters)
    defaults[p.name] = getParamDefault(p)
  return defaults
}

/** 检查必填参数是否都已填写 */
export function checkCanGenerate(model: ModelConfig, parameters: WorkspaceParameters): boolean {
  return model.parameters.filter(p => p.required && !parameters[p.name]).length === 0
}

function normalizeParameterValue(param: ModelParameter, value: WorkspaceParameterValue): WorkspaceParameterValue {
  if (param.type === 'number')
    return typeof value === 'number' && Number.isFinite(value) ? value : getParamDefault(param)
  if (param.type === 'boolean')
    return typeof value === 'boolean' ? value : getParamDefault(param)
  if (Array.isArray(value))
    return value
  if (value == null)
    return ''
  return String(value)
}

function normalizeParameters(model: ModelConfig | undefined, params: WorkspaceParameters): WorkspaceParameters {
  if (!model)
    return params

  const next: WorkspaceParameters = {}
  for (const param of model.parameters) {
    const value = params[param.name] ?? getParamDefault(param)
    next[param.name] = normalizeParameterValue(param, value)
  }
  return next
}

export interface ReferenceFile {
  id: string
  url: string
  name: string
}

export interface MediaUploadEntry {
  uploading: boolean
  uploadedUrl?: string
  uploadedName?: string
}

export interface WorkspaceState {
  models: ModelConfig[]
  selectedCategory: Category
  selectedModelId: string
  parameters: WorkspaceParameters
  referenceFiles: ReferenceFile[]
  mediaUploadState: Record<string, MediaUploadEntry>
  loading: boolean
  uploadingRefs: boolean

  // Derived (computed on demand)
  categoryModels: () => ModelConfig[]
  selectedModel: () => ModelConfig | undefined
  canGenerate: () => boolean
  showReferenceUpload: () => boolean

  // Actions
  loadModels: () => Promise<void>
  setCategory: (category: Category) => void
  setModelId: (id: string) => void
  setParameter: (name: string, value: WorkspaceParameterValue) => void
  setParameters: (params: WorkspaceParameters) => void
  addReferenceFile: (file: ReferenceFile) => void
  removeReferenceFile: (id: string) => void
  setUploadingRefs: (v: boolean) => void
  setMediaUploadEntry: (paramName: string, entry: MediaUploadEntry) => void
  clearMediaUpload: (paramName: string) => void

  submit: () => Promise<void>
  regenerate: (record: GenerationRecord) => Promise<void>
  removeRecord: (id: string) => Promise<void>
  uploadReferenceFiles: (files: FileList) => Promise<void>
  uploadMediaParam: (paramName: string, accept: string) => Promise<void>
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  models: [],
  selectedCategory: 'image',
  selectedModelId: '',
  parameters: {},
  referenceFiles: [],
  mediaUploadState: {},
  loading: false,
  uploadingRefs: false,

  categoryModels: () => {
    const { models, selectedCategory } = get()
    return models.filter(m => m.category === selectedCategory)
  },

  selectedModel: () => {
    const { models, selectedModelId } = get()
    return models.find(m => m.id === selectedModelId)
  },

  canGenerate: () => {
    const model = get().selectedModel()
    if (!model)
      return false
    return checkCanGenerate(model, get().parameters)
  },

  showReferenceUpload: () => {
    return get().selectedModel()?.referenceMediaType != null
  },

  loadModels: async () => {
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
          parameters: buildInitialParameters(model),
          mediaUploadState: {},
        })
        return
      }
    }
    set({ models })
  },

  setCategory: (category) => {
    set({ selectedCategory: category })
    const categoryModels = get().models.filter(m => m.category === category)
    if (categoryModels.length > 0) {
      const model = categoryModels[0]
      set({
        selectedModelId: model.id,
        parameters: buildInitialParameters(model),
        mediaUploadState: {},
      })
    }
  },

  setModelId: (id) => {
    const model = get().models.find(m => m.id === id)
    if (model) {
      set({
        selectedModelId: id,
        parameters: buildInitialParameters(model),
        mediaUploadState: {},
      })
    }
  },

  setParameter: (name, value) => {
    set((state) => {
      const model = get().selectedModel()
      const param = model?.parameters.find(p => p.name === name)
      if (!param)
        return { parameters: state.parameters }
      return { parameters: { ...state.parameters, [name]: normalizeParameterValue(param, value) } }
    })
  },

  setParameters: (params) => {
    set({ parameters: normalizeParameters(get().selectedModel(), params) })
  },

  addReferenceFile: (file) => {
    set(state => ({ referenceFiles: [...state.referenceFiles, file] }))
  },

  removeReferenceFile: (id) => {
    set(state => ({ referenceFiles: state.referenceFiles.filter(f => f.id !== id) }))
  },

  setUploadingRefs: (v) => {
    set({ uploadingRefs: v })
  },

  setMediaUploadEntry: (paramName, entry) => {
    set(state => ({ mediaUploadState: { ...state.mediaUploadState, [paramName]: entry } }))
  },

  clearMediaUpload: (paramName) => {
    set((state) => {
      const { [paramName]: _, ...rest } = state.mediaUploadState
      return {
        parameters: { ...state.parameters, [paramName]: '' },
        mediaUploadState: rest,
      }
    })
  },

  submit: async () => {
    const { selectedModel, parameters, referenceFiles } = get()
    const model = selectedModel()
    if (!model || !checkCanGenerate(model, parameters))
      return
    set({ loading: true })
    try {
      const referenceFileIds = referenceFiles.map(f => f.id)
      const result: GenerateResponse = await generate({
        model: model.id,
        parameters,
        referenceFileIds: referenceFileIds.length > 0 ? referenceFileIds : undefined,
      })
      if (result.success && result.record)
        useGenerationStore.getState().addRecord(result.record)
    }
    catch (err) {
      handleApiError(err, '生成请求失败')
    }
    finally {
      set({ loading: false })
    }
  },

  regenerate: async (record) => {
    set({ loading: true })
    try {
      const result: GenerateResponse = await generate({
        model: record.model,
        parameters: record.inputParams,
      })
      if (result.success && result.record)
        useGenerationStore.getState().addRecord(result.record)
    }
    catch (err) {
      handleApiError(err, '生成请求失败')
    }
    finally {
      set({ loading: false })
    }
  },

  removeRecord: async (id) => {
    try {
      await deleteRecord(id)
      useGenerationStore.getState().removeRecord(id)
    }
    catch (err) {
      handleApiError(err, '删除记录失败')
    }
  },

  uploadReferenceFiles: async (files) => {
    set({ uploadingRefs: true })
    try {
      for (const file of Array.from(files)) {
        const result = await uploadFile(file)
        if (result.success)
          get().addReferenceFile({ id: result.data.id, url: result.data.publicUrl, name: result.data.fileName })
      }
    }
    finally {
      set({ uploadingRefs: false })
    }
  },

  uploadMediaParam: async (paramName, accept) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file)
        return
      get().setMediaUploadEntry(paramName, { uploading: true })
      try {
        const result = await uploadFile(file)
        if (result.success) {
          set(state => ({
            parameters: { ...state.parameters, [paramName]: result.data.publicUrl },
            mediaUploadState: {
              ...state.mediaUploadState,
              [paramName]: { uploading: false, uploadedUrl: result.data.publicUrl, uploadedName: result.data.fileName },
            },
          }))
        }
        else {
          get().setMediaUploadEntry(paramName, { uploading: false })
        }
      }
      catch {
        get().setMediaUploadEntry(paramName, { uploading: false })
      }
    }
    input.click()
  },
}))
