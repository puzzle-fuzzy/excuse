import type { GenerateResponse, GenerationRecord, ModelConfig } from '@/api/client'
import type { MediaUploadEntry, ReferenceFile, WorkspaceParameters, WorkspaceParameterValue } from '@/lib/generation-form-utils'
import { toast } from 'sonner'
import { create } from 'zustand'
import {
  deleteRecord,
  generate,
  uploadFile,
} from '@/api/client'
import { buildInitialParameters, checkCanGenerate } from '@/lib/generation-form-utils'
import { handleApiError } from '@/lib/utils'

export type { MediaUploadEntry, ReferenceFile, WorkspaceParameters, WorkspaceParameterValue }

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
    catch (err) {
      toast.error('参考文件上传失败，请重试')
      console.error('uploadReferenceFiles failed:', err)
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
      catch (err) {
        toast.error('媒体文件上传失败，请重试')
        console.error('uploadMediaParam failed:', err)
        get().setMediaUploadEntry(paramName, { uploading: false })
      }
    }
    input.click()
  },
}))
