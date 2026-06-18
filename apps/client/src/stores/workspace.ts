import type { GenerateResponse, GenerationRecord, ModelConfig, ModelParameter } from '@/api/client'
import { create } from 'zustand'
import {
  deleteRecord,
  generate,
  uploadFile,
} from '@/api/client'
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
  parameters: WorkspaceParameters
  referenceFiles: ReferenceFile[]
  mediaUploadState: Record<string, MediaUploadEntry>
  loading: boolean
  uploadingRefs: boolean

  // Actions
  setParameter: (name: string, value: WorkspaceParameterValue) => void
  setParameters: (params: WorkspaceParameters) => void
  addReferenceFile: (file: ReferenceFile) => void
  removeReferenceFile: (id: string) => void
  setUploadingRefs: (v: boolean) => void
  setMediaUploadEntry: (paramName: string, entry: MediaUploadEntry) => void
  clearMediaUpload: (paramName: string) => void
  resetForm: (model: ModelConfig) => void

  submit: (model: ModelConfig) => Promise<GenerationRecord | null>
  regenerate: (modelId: string, params: WorkspaceParameters, referenceFileIds?: string[]) => Promise<GenerationRecord | null>
  removeRecord: (id: string) => Promise<void>
  uploadReferenceFiles: (files: FileList) => Promise<void>
  uploadMediaParam: (paramName: string, accept: string) => Promise<void>
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  parameters: {},
  referenceFiles: [],
  mediaUploadState: {},
  loading: false,
  uploadingRefs: false,

  setParameter: (name, value) => {
    set((state) => {
      return { parameters: { ...state.parameters, [name]: value } }
    })
  },

  setParameters: (params) => {
    set({ parameters: params })
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

  resetForm: (model) => {
    set({
      parameters: buildInitialParameters(model),
      referenceFiles: [],
      mediaUploadState: {},
    })
  },

  submit: async (model) => {
    const { parameters, referenceFiles } = get()
    if (!model || !checkCanGenerate(model, parameters))
      return null
    set({ loading: true })
    try {
      const referenceFileIds = referenceFiles.map(f => f.id)
      const result: GenerateResponse = await generate({
        model: model.id,
        parameters,
        referenceFileIds: referenceFileIds.length > 0 ? referenceFileIds : undefined,
      })
      if (result.success && result.record)
        return result.record
      return null
    }
    catch (err) {
      handleApiError(err, '生成请求失败')
      return null
    }
    finally {
      set({ loading: false })
    }
  },

  regenerate: async (modelId, params, referenceFileIds) => {
    set({ loading: true })
    try {
      const result: GenerateResponse = await generate({
        model: modelId,
        parameters: params,
        referenceFileIds: referenceFileIds && referenceFileIds.length > 0 ? referenceFileIds : undefined,
      })
      if (result.success && result.record)
        return result.record
      return null
    }
    catch (err) {
      handleApiError(err, '生成请求失败')
      return null
    }
    finally {
      set({ loading: false })
    }
  },

  removeRecord: async (id) => {
    try {
      await deleteRecord(id)
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
