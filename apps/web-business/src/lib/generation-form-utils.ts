import type { ModelConfig, ModelParameter } from '@/api/client'

// ===== 类型 =====

export type WorkspaceParameterValue = string | number | boolean | string[] | null

export interface WorkspaceParameters {
  [name: string]: WorkspaceParameterValue
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

// ===== 纯函数 =====

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
