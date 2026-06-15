import { describe, expect, it } from 'bun:test'
import { assertCreditLedgerPolicy, getBillingPolicy, isCreditLedgerPolicy } from '../src/policy'

describe('billing policy', () => {
  it('Workspace 生成走正式 credit ledger 闭环', () => {
    const policy = getBillingPolicy('workspace.generate')

    expect(policy).toMatchObject({
      surface: 'workspace.generate',
      mode: 'credit-ledger',
      usageEventRequired: true,
      generationRecordRequired: true,
    })
    expect(policy.lifecycle).toEqual(['reserve', 'debit', 'refund'])
    expect(isCreditLedgerPolicy(policy)).toBe(true)
    expect(() => assertCreditLedgerPolicy(policy, 'workspace.generate')).not.toThrow()
  })

  it('OpenAI Gateway 走正式 credit ledger 闭环', () => {
    const policy = getBillingPolicy('openai.gateway.chat')

    expect(policy).toMatchObject({
      surface: 'openai.gateway.chat',
      mode: 'credit-ledger',
      usageEventRequired: true,
      generationRecordRequired: true,
    })
    expect(policy.lifecycle).toEqual(['reserve', 'debit', 'refund'])
  })

  it('Canvas beta 明确不进入余额扣款闭环', () => {
    const policy = getBillingPolicy('canvas.pipeline.beta')

    expect(policy.mode).toBe('free')
    expect(policy.lifecycle).toEqual([])
    expect(policy.usageEventRequired).toBe(false)
    expect(() => assertCreditLedgerPolicy(policy, 'canvas.pipeline.beta')).toThrow('必须使用 credit-ledger 计费策略')
  })

  it('Subtitle ASR 当前只做成本记录，不生成用户资金流水', () => {
    const policy = getBillingPolicy('subtitle.asr.beta')

    expect(policy.mode).toBe('cost-only')
    expect(policy.generationRecordRequired).toBe(true)
    expect(policy.usageEventRequired).toBe(false)
    expect(policy.lifecycle).toEqual([])
  })
})
