export type BillingSurface
  = | 'workspace.generate'
    | 'openai.gateway.chat'
    | 'canvas.pipeline.beta'
    | 'subtitle.asr.beta'

export type CreditLedgerLifecycle = 'reserve' | 'debit' | 'refund'

export interface CreditLedgerBillingPolicy {
  surface: BillingSurface
  mode: 'credit-ledger'
  lifecycle: readonly CreditLedgerLifecycle[]
  usageEventRequired: true
  generationRecordRequired: true
  description: string
}

export interface FreeBillingPolicy {
  surface: BillingSurface
  mode: 'free'
  lifecycle: readonly []
  usageEventRequired: false
  generationRecordRequired: false
  description: string
}

export interface CostOnlyBillingPolicy {
  surface: BillingSurface
  mode: 'cost-only'
  lifecycle: readonly []
  usageEventRequired: false
  generationRecordRequired: true
  description: string
}

export type BillingPolicy = CreditLedgerBillingPolicy | FreeBillingPolicy | CostOnlyBillingPolicy

const CREDIT_LEDGER_LIFECYCLE = ['reserve', 'debit', 'refund'] as const

const BILLING_POLICIES: Record<BillingSurface, BillingPolicy> = {
  'workspace.generate': {
    surface: 'workspace.generate',
    mode: 'credit-ledger',
    lifecycle: CREDIT_LEDGER_LIFECYCLE,
    usageEventRequired: true,
    generationRecordRequired: true,
    description: 'Workspace 文本、图片、视频生成：创建 generation_record 后预留余额，成功扣款，失败或取消退款。',
  },
  'openai.gateway.chat': {
    surface: 'openai.gateway.chat',
    mode: 'credit-ledger',
    lifecycle: CREDIT_LEDGER_LIFECYCLE,
    usageEventRequired: true,
    generationRecordRequired: true,
    description: 'OpenAI 兼容 Chat Completions：创建 gateway generation_record 后预留余额，成功扣款，失败退款。',
  },
  'canvas.pipeline.beta': {
    surface: 'canvas.pipeline.beta',
    mode: 'free',
    lifecycle: [],
    usageEventRequired: false,
    generationRecordRequired: false,
    description: 'Canvas 前置流水线仍是 beta/free quota，不进入用户余额扣款闭环。',
  },
  'subtitle.asr.beta': {
    surface: 'subtitle.asr.beta',
    mode: 'cost-only',
    lifecycle: [],
    usageEventRequired: false,
    generationRecordRequired: true,
    description: 'Subtitle ASR 当前只记录 provider 成本用于审计展示，暂不从用户余额 reserve/debit/refund。',
  },
}

export function getBillingPolicy(surface: BillingSurface): BillingPolicy {
  return BILLING_POLICIES[surface]
}

export function isCreditLedgerPolicy(policy: BillingPolicy): policy is CreditLedgerBillingPolicy {
  return policy.mode === 'credit-ledger'
}

export function assertCreditLedgerPolicy(
  policy: BillingPolicy,
  context: string,
): asserts policy is CreditLedgerBillingPolicy {
  if (!isCreditLedgerPolicy(policy)) {
    throw new Error(`${context} 必须使用 credit-ledger 计费策略，当前为 ${policy.mode}`)
  }
}
