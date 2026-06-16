/**
 * @excuse/error-recovery —— 纯规则包（无 IO 依赖）
 *
 * 统一的失败 → 用户可操作恢复策略分类。把 Workspace / Canvas / Subtitle /
 * Gateway 各处零散的失败展示收口为一份分类：
 *   - `classifyRecovery(input)` —— 由错误码 / 文案 / 状态 / 计费模式，得出
 *     `domain`（失败领域）+ `action`（下一步动作）+ label/suggestion +
 *     `recharges`（重试是否重新扣费）+ `diagnostics`（可复制诊断信息）。
 *
 * 设计约束：本包只导出纯函数，禁止 import @excuse/db、@excuse/provider 或 apps/*。
 * `packages/shared/canvas-failure.ts` 内部委托本包（保留其公共 API 以避免回归）。
 *
 * 规则顺序：状态优先（cancelled）→ 结构化错误码 → 文案关键词 → 兜底 system。
 */

/** 计费模式 —— 决定重试是否重新扣费。来自 @excuse/billing BillingPolicy.mode 的镜像枚举。 */
export type BillingMode = 'credit-ledger' | 'free' | 'cost-only'

/** 失败领域 —— 比 task-engine 的 TaskErrorCategory 更细，覆盖 content/storage/balance/cancel。 */
export type FailureDomain
  = | 'balance' // 余额/配额不足
    | 'content' // 内容审核未通过
    | 'network' // 网络超时/连接
    | 'storage' // 存储上传/下载
    | 'cancel' // 用户主动取消
    | 'provider' // 模型/服务端错误（限流、鉴权、不可用、降级）
    | 'validation' // 参数/输入非法
    | 'system' // 系统未知错误

/** 给用户的下一步动作。 */
export type RecoveryAction
  = | 'retry' // 直接重试（瞬时/可恢复）
    | 'edit_prompt' // 修改提示词/故事后重试（内容审核/参数）
    | 'change_model' // 换模型（模型不可用/降级/不兼容）
    | 'top_up' // 充值/提升配额
    | 'contact_support' // 联系客服（带诊断信息）
    | 'wait' // 等待（限流/降级冷却）
    | 'none' // 已取消 / 无可操作

export interface RecoveryInput {
  errorMessage?: string | null
  /** provider/任务错误码（如 'Throttling', 'DataInspection', 'MODEL_DEGRADED', 'insufficient_balance'） */
  code?: string | null
  /** task-engine category（provider_error/timeout/validation/system），结构化 errorJson 来源 */
  category?: string | null
  /** 资产/记录状态（cancelled → cancel 域） */
  status?: string | null
  /** 跨服务追踪 ID，写入诊断信息供客服定位 */
  traceId?: string | null
  /** 该 surface 的计费模式；决定 recharges 提示 */
  billingMode?: BillingMode | null
  /** 任务/记录/资产 ID（诊断信息用） */
  entityId?: string | null
  /** 来源标识（如 'workspace' / 'canvas' / 'gateway'），诊断信息用 */
  source?: string | null
}

export interface RecoveryClassification {
  domain: FailureDomain
  action: RecoveryAction
  /** 简短中文标签（徽章展示） */
  label: string
  /** 下一步建议（给用户的可操作指引） */
  suggestion: string
  /** 重试是否重新扣费（可重试动作 且 billingMode==='credit-ledger' 时为 true） */
  recharges: boolean
  /** 可一键复制的诊断信息文本（给客服/运营定位 task/record/asset） */
  diagnostics: string
  /** 仍有可操作恢复路径（action 非 none/contact_support） */
  recoverable: boolean
}

// ── 标签 / 建议 ────────────────────────────────────────────

const DOMAIN_LABELS: Record<FailureDomain, string> = {
  balance: '余额不足',
  content: '内容审核未通过',
  network: '网络异常',
  storage: '存储异常',
  cancel: '已取消',
  provider: '模型/服务异常',
  validation: '参数错误',
  system: '系统错误',
}

const DOMAIN_SUGGESTIONS: Record<FailureDomain, string> = {
  balance: '账号欠费或配额耗尽，请前往阿里云控制台充值/提升配额后重试。',
  content: '输入或生成内容未通过审核，请修改故事文本或提示词中可能敏感的部分后重试。',
  network: '请求超时或网络中断，请检查网络连接后重试；若持续超时可尝试简化输入。',
  storage: '结果文件上传/下载失败，请检查 OSS/本地存储配置后重试。',
  cancel: '该任务已被取消，如需继续可重新执行。',
  provider: '模型服务暂时异常或被限流，请稍后重试；如多次失败请检查模型是否已开通。',
  validation: '请求参数有误，请检查输入后重试。',
  system: '发生未知系统错误，请稍后重试；如持续出现请联系管理员查看日志。',
}

/** 每个领域对应的默认动作。 */
const DOMAIN_ACTION: Record<FailureDomain, RecoveryAction> = {
  balance: 'top_up',
  content: 'edit_prompt',
  network: 'retry',
  storage: 'retry',
  cancel: 'none',
  provider: 'wait',
  validation: 'edit_prompt',
  system: 'retry',
}

// ── 结构化错误码 → 领域（优先于文案关键词）────────────────────

/** 错误码前缀/全等匹配，按优先级排序。 */
const CODE_RULES: Array<{ match: RegExp, domain: FailureDomain, action?: RecoveryAction }> = [
  // 余额/配额
  { match: /^(insufficient_balance|insufficient_quota|arrearage|allocationquota|api_key_quota_exceeded)$/i, domain: 'balance' },
  // 内容审核
  { match: /^(datainspection|ipinfringement|blocked|content.blocked)$/i, domain: 'content' },
  // 模型不可用/降级/不兼容
  { match: /^(model_not_found|invalid_model|model_degraded)$/i, domain: 'provider', action: 'change_model' },
  { match: /^(throttling)$/i, domain: 'provider', action: 'wait' },
  // 网络/超时
  { match: /^(econnrefused|etimedout|econnreset|timeout|requesttimeout|responsetimeout|invalidurl)$/i, domain: 'network' },
  // 参数
  { match: /^(invalid_parameters|invalidparameter|missing_user_message|invalid_model_parameters|api_key_scope_not_allowed)$/i, domain: 'validation' },
  // 生成失败（provider 内部） → provider 域
  { match: /^(generation_failed)$/i, domain: 'provider' },
  // 取消
  { match: /^(cancelled| canceled)$/i, domain: 'cancel' },
]

// ── 文案关键词规则（结构化码缺失时回退）──────────────────────
//
// 与历史 packages/shared/canvas-failure.ts 的 RULES 同口径，确保委托后行为一致。

const KEYWORD_RULES: Array<{ domain: FailureDomain, keywords: string[] }> = [
  {
    domain: 'balance',
    keywords: ['欠费', '充值', '配额不足', '免费额度已耗尽', '配额耗尽', 'arrearage', 'allocationquota', 'insufficient_quota', '额度'],
  },
  {
    domain: 'content',
    keywords: ['不合规', '敏感信息', '侵权', '审核', '审核未通过', '策略拦截', 'datainspection', 'ipinfringement', 'blocked', '内容未通过'],
  },
  {
    domain: 'network',
    keywords: ['超时', 'timeout', '网络', '拒绝连接', 'connectionrefused', 'requesttimeout', 'responsetimeout', 'invalidurl', '无法访问'],
  },
  {
    domain: 'storage',
    keywords: ['存储', '上传失败', '下载失败', 'fileupload', 'internalerror.upload', 'download', 'oss', '文件上传', '文件下载'],
  },
  {
    domain: 'cancel',
    keywords: ['用户取消', '已取消', 'cancelled', '手动取消', '任务已取消'],
  },
  {
    domain: 'provider',
    keywords: ['限流', 'throttling', '无权限', 'accessdenied', 'apikey', 'api key 无效', '模型不存在', '模型已下线', '不可用', 'internalerror', '内部错误', '推理异常', '模型暂时', '未开通', '不支持的模型', 'model_not_found', '降级'],
  },
]

/** 文案关键词 → 领域（小写匹配）。返回 null 表示无命中。 */
function domainFromText(message: string): FailureDomain | null {
  const text = message.toLowerCase()
  if (!text)
    return null
  for (const rule of KEYWORD_RULES) {
    if (rule.keywords.some(kw => text.includes(kw.toLowerCase())))
      return rule.domain
  }
  return null
}

function domainFromCode(code: string): { domain: FailureDomain, action?: RecoveryAction } | null {
  const c = code.trim().toLowerCase()
  for (const rule of CODE_RULES) {
    if (rule.match.test(c))
      return { domain: rule.domain, action: rule.action }
  }
  return null
}

/** task-engine category → 领域（结构化 errorJson 路径）。 */
function domainFromCategory(category: string | null | undefined): FailureDomain | null {
  switch (category) {
    case 'timeout': return 'network'
    case 'provider_error': return 'provider'
    case 'validation': return 'validation'
    case 'system': return 'system'
    default: return null
  }
}

/** 可重试动作集合（这些动作在 credit-ledger surface 上会重新扣费）。 */
const RETRY_LIKE_ACTIONS: ReadonlySet<RecoveryAction> = new Set(['retry', 'edit_prompt', 'change_model', 'wait'])

/**
 * 统一失败分类。
 *
 * 判定顺序：status=cancelled → 结构化 code → task-engine category → 文案关键词 → system 兜底。
 * `action` 由领域默认动作决定（code 可覆盖，如 MODEL_DEGRADED → change_model）。
 * `recharges` = action ∈ retry-like 且 billingMode==='credit-ledger'。
 * `diagnostics` 拼装为可复制文本块（领域/错误码/追踪ID/来源/详情）。
 */
export function classifyRecovery(input: RecoveryInput = {}): RecoveryClassification {
  const { errorMessage, code, category, status, traceId, billingMode, entityId, source } = input

  // 1. 状态优先：取消
  let domain: FailureDomain
  let actionOverride: RecoveryAction | undefined
  if (status === 'cancelled') {
    domain = 'cancel'
  }
  else {
    // 2. 结构化码
    const byCode = code ? domainFromCode(code) : null
    // 3. category
    const byCategory = domainFromCategory(category)
    // 4. 文案
    const byText = errorMessage ? domainFromText(errorMessage) : null

    domain = byCode?.domain ?? byCategory ?? byText ?? 'system'
    actionOverride = byCode?.action
  }

  const action = actionOverride ?? DOMAIN_ACTION[domain]
  const recharges = RETRY_LIKE_ACTIONS.has(action) && billingMode === 'credit-ledger'
  const recoverable = action !== 'none' && action !== 'contact_support'

  const diagnostics = buildDiagnostics({
    domain,
    code: code ?? null,
    traceId: traceId ?? null,
    entityId: entityId ?? null,
    source: source ?? null,
    errorMessage: errorMessage ?? null,
  })

  return {
    domain,
    action,
    label: DOMAIN_LABELS[domain],
    suggestion: DOMAIN_SUGGESTIONS[domain],
    recharges,
    diagnostics,
    recoverable,
  }
}

interface DiagnosticsParts {
  domain: FailureDomain
  code: string | null
  traceId: string | null
  entityId: string | null
  source: string | null
  errorMessage: string | null
}

function buildDiagnostics(parts: DiagnosticsParts): string {
  const lines = ['[Excuse 诊断信息]', `领域: ${DOMAIN_LABELS[parts.domain]}`]
  if (parts.code)
    lines.push(`错误码: ${parts.code}`)
  if (parts.traceId)
    lines.push(`追踪ID: ${parts.traceId}`)
  if (parts.source)
    lines.push(`来源: ${parts.source}`)
  if (parts.entityId)
    lines.push(`ID: ${parts.entityId}`)
  const detail = (parts.errorMessage ?? '').trim()
  if (detail)
    lines.push(`详情: ${truncate(detail, 500)}`)
  return lines.join('\n')
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}
