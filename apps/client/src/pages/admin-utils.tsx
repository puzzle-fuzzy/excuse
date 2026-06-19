import type { AdminTaskGenerationRecord, AdminUserRecentRecord } from '@excuse/shared'
import { TASK_CATEGORY_LABELS } from '@/lib/category-labels'

export const TASK_LIMIT = 40
export const USERS_PAGE_SIZE = 20

export const STATUS_LABELS: Record<string, string> = {
  queued: '等待',
  running: '运行',
  retrying: '重试',
  succeeded: '成功',
  failed: '失败',
  cancelled: '取消',
  pending: '待处理',
  submitting: '提交中',
  processing: '处理中',
  saving_output: '保存中',
  draft: '草稿',
  completed: '完成',
  partial_failed: '部分失败',
}

export const KIND_LABELS: Record<string, string> = {
  generation: '生成',
  task: '任务',
  canvas_pipeline: 'Canvas',
}

export const TASK_STATUS_OPTIONS = [
  { label: '全部状态', value: 'all' },
  { label: '等待', value: 'queued' },
  { label: '运行', value: 'running' },
  { label: '重试', value: 'retrying' },
  { label: '失败', value: 'failed' },
  { label: '成功', value: 'succeeded' },
  { label: '取消', value: 'cancelled' },
]

export const TASK_DOMAIN_OPTIONS = [
  { label: '全部领域', value: 'all' },
  { label: 'Canvas', value: 'canvas' },
  { label: '生成', value: 'generate' },
  { label: '字幕', value: 'subtitle' },
  { label: 'Gateway', value: 'gateway' },
]

export const USER_STATUS_OPTIONS = [
  { label: '全部状态', value: 'all' },
  { label: '已启用', value: 'true' },
  { label: '已禁用', value: 'false' },
]

export const PROVIDER_WINDOW_OPTIONS = [
  { label: '近 1 小时', value: '1' },
  { label: '近 6 小时', value: '6' },
  { label: '近 24 小时', value: '24' },
  { label: '近 7 天', value: '168' },
]

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  login: '登录',
  register: '注册',
  generate: '生成',
  file_delete: '删除文件',
  file_update: '更新文件',
  billing_transaction: '计费交易',
  api_key_create: '创建 API 密钥',
  api_key_revoke: '撤销 API 密钥',
  admin_action: '管理员操作',
  canvas_project_create: '创建项目',
  canvas_project_delete: '删除项目',
  canvas_phase_run: '运行阶段',
  canvas_cancel: '取消操作',
  canvas_asset_regenerate: '重新生成资产',
  canvas_apply_reference_assets: '应用参考资产',
  asset_hide: '隐藏资产',
  gateway_call: 'Gateway 调用',
  generation_retry: '重试生成',
  generation_cancel: '取消生成',
  credit_reserve: '预留额度',
  credit_debit: '扣费',
  credit_refund: '退款',
}

export type AdminTab = 'overview' | 'users' | 'providers' | 'projects' | 'gateway' | 'audit'

export function statusLabel(status: string) {
  return STATUS_LABELS[status] ?? status
}

export function formatDate(value: string | null) {
  if (!value)
    return '-'
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

export function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'succeeded' || status === 'completed')
    return 'default'
  if (status === 'failed' || status === 'partial_failed')
    return 'destructive'
  if (status === 'running' || status === 'processing' || status === 'submitting' || status === 'saving_output')
    return 'secondary'
  return 'outline'
}

export function shortId(value: string | null) {
  if (!value)
    return '-'
  return value.length > 8 ? `${value.slice(0, 8)}…` : value
}

export function auditActionLabel(action: string) {
  return AUDIT_ACTION_LABELS[action] ?? action
}

/** @deprecated 使用 TASK_CATEGORY_LABELS（自 @/lib/category-labels） */
export const PROVIDER_CATEGORY_LABELS = TASK_CATEGORY_LABELS

export function generationRecordMatchLabel(matchReason: AdminTaskGenerationRecord['matchReason']) {
  switch (matchReason) {
    case 'direct':
      return '直接关联'
    case 'worker-task':
      return '统一任务'
    case 'pipeline-run':
      return '流水线'
    case 'time-window':
      return '候选·时间窗口'
  }
}

export function recentRecordExecutionLabel(kind: AdminUserRecentRecord['executionKind']) {
  switch (kind) {
    case 'legacy-provider-task':
      return '旧版生成任务'
    case 'canvas-worker':
      return 'Canvas 工作进程'
    case 'gateway':
      return 'Gateway'
    case 'inline':
      return '同步'
  }
}
