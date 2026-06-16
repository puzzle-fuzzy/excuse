import { describe, expect, it } from 'bun:test'
import { classifyRecovery } from '../src'

describe('@excuse/error-recovery · classifyRecovery', () => {
  describe('状态优先', () => {
    it('cancelled → cancel / none', () => {
      const r = classifyRecovery({ status: 'cancelled' })
      expect(r.domain).toBe('cancel')
      expect(r.action).toBe('none')
      expect(r.recoverable).toBe(false)
      expect(r.recharges).toBe(false)
    })
  })

  describe('结构化错误码优先于文案', () => {
    it('insufficient_balance → balance / top_up', () => {
      const r = classifyRecovery({ code: 'insufficient_balance' })
      expect(r.domain).toBe('balance')
      expect(r.action).toBe('top_up')
    })

    it('DataInspection → content / edit_prompt', () => {
      const r = classifyRecovery({ code: 'DataInspection' })
      expect(r.domain).toBe('content')
      expect(r.action).toBe('edit_prompt')
    })

    it('model_not_found → provider / change_model（覆盖领域默认 wait）', () => {
      const r = classifyRecovery({ code: 'model_not_found' })
      expect(r.domain).toBe('provider')
      expect(r.action).toBe('change_model')
    })

    it('MODEL_DEGRADED → provider / change_model', () => {
      const r = classifyRecovery({ code: 'MODEL_DEGRADED' })
      expect(r.domain).toBe('provider')
      expect(r.action).toBe('change_model')
    })

    it('Throttling → provider / wait', () => {
      const r = classifyRecovery({ code: 'Throttling' })
      expect(r.domain).toBe('provider')
      expect(r.action).toBe('wait')
    })

    it('ETIMEDOUT → network / retry', () => {
      const r = classifyRecovery({ code: 'ETIMEDOUT' })
      expect(r.domain).toBe('network')
      expect(r.action).toBe('retry')
    })

    it('invalid_parameters → validation / edit_prompt', () => {
      const r = classifyRecovery({ code: 'invalid_parameters' })
      expect(r.domain).toBe('validation')
      expect(r.action).toBe('edit_prompt')
    })

    it('api_key_quota_exceeded → balance / top_up（gateway 配额耗尽）', () => {
      const r = classifyRecovery({ code: 'api_key_quota_exceeded' })
      expect(r.domain).toBe('balance')
      expect(r.action).toBe('top_up')
    })

    it('api_key_scope_not_allowed → validation / edit_prompt', () => {
      const r = classifyRecovery({ code: 'api_key_scope_not_allowed' })
      expect(r.domain).toBe('validation')
      expect(r.action).toBe('edit_prompt')
    })

    it('generation_failed → provider / wait', () => {
      const r = classifyRecovery({ code: 'generation_failed' })
      expect(r.domain).toBe('provider')
      expect(r.action).toBe('wait')
    })
  })

  describe('task-engine category 回退', () => {
    it('provider_error → provider / wait', () => {
      const r = classifyRecovery({ category: 'provider_error' })
      expect(r.domain).toBe('provider')
    })
    it('timeout → network / retry', () => {
      const r = classifyRecovery({ category: 'timeout' })
      expect(r.domain).toBe('network')
    })
    it('validation → validation', () => {
      const r = classifyRecovery({ category: 'validation' })
      expect(r.domain).toBe('validation')
    })
  })

  describe('文案关键词回退', () => {
    it('含「欠费」→ balance', () => {
      const r = classifyRecovery({ errorMessage: '账号欠费，请充值' })
      expect(r.domain).toBe('balance')
    })
    it('含「审核未通过」→ content', () => {
      const r = classifyRecovery({ errorMessage: '内容审核未通过' })
      expect(r.domain).toBe('content')
    })
    it('含「超时」→ network', () => {
      const r = classifyRecovery({ errorMessage: '请求超时' })
      expect(r.domain).toBe('network')
    })
    it('含「限流」→ provider', () => {
      const r = classifyRecovery({ errorMessage: '模型限流，请稍后重试' })
      expect(r.domain).toBe('provider')
    })
    it('空文案 → system 兜底', () => {
      const r = classifyRecovery({ errorMessage: '' })
      expect(r.domain).toBe('system')
      expect(r.action).toBe('retry')
    })
    it('无任何输入 → system 兜底', () => {
      const r = classifyRecovery({})
      expect(r.domain).toBe('system')
    })
  })

  describe('recharges（重扣费提示）', () => {
    it('retry 动作 + credit-ledger → recharges=true', () => {
      const r = classifyRecovery({ code: 'ETIMEDOUT', billingMode: 'credit-ledger' })
      expect(r.action).toBe('retry')
      expect(r.recharges).toBe(true)
    })
    it('retry 动作 + free → recharges=false', () => {
      const r = classifyRecovery({ code: 'ETIMEDOUT', billingMode: 'free' })
      expect(r.recharges).toBe(false)
    })
    it('cancel → recharges=false（无可重试）', () => {
      const r = classifyRecovery({ status: 'cancelled', billingMode: 'credit-ledger' })
      expect(r.recharges).toBe(false)
    })
    it('top_up → recharges=false（先充值，不是重试扣费）', () => {
      const r = classifyRecovery({ code: 'insufficient_balance', billingMode: 'credit-ledger' })
      expect(r.action).toBe('top_up')
      expect(r.recharges).toBe(false)
    })
  })

  describe('diagnostics（可复制诊断信息）', () => {
    it('包含领域/错误码/追踪ID/来源/详情', () => {
      const r = classifyRecovery({
        code: 'Throttling',
        errorMessage: '模型 qwen-max 限流',
        traceId: 'trace-123',
        source: 'canvas',
        entityId: 'shot-1',
      })
      expect(r.diagnostics).toContain('[Excuse 诊断信息]')
      expect(r.diagnostics).toContain('领域: 模型/服务异常')
      expect(r.diagnostics).toContain('错误码: Throttling')
      expect(r.diagnostics).toContain('追踪ID: trace-123')
      expect(r.diagnostics).toContain('来源: canvas')
      expect(r.diagnostics).toContain('ID: shot-1')
      expect(r.diagnostics).toContain('详情: 模型 qwen-max 限流')
    })
    it('缺省字段不出现在诊断中', () => {
      const r = classifyRecovery({ errorMessage: 'boom' })
      expect(r.diagnostics).not.toContain('错误码')
      expect(r.diagnostics).not.toContain('追踪ID')
    })
    it('超长详情被截断', () => {
      const long = 'x'.repeat(600)
      const r = classifyRecovery({ errorMessage: long })
      expect(r.diagnostics).toContain('…')
      expect(r.diagnostics.length).toBeLessThan(long.length)
    })
  })

  describe('label / suggestion 非空', () => {
    it('每个分类都有 label 与 suggestion', () => {
      for (const input of [
        { code: 'insufficient_balance' },
        { code: 'DataInspection' },
        { code: 'ETIMEDOUT' },
        { status: 'cancelled' },
        { code: 'Throttling' },
        { errorMessage: '' },
      ]) {
        const r = classifyRecovery(input)
        expect(r.label.length).toBeGreaterThan(0)
        expect(r.suggestion.length).toBeGreaterThan(0)
      }
    })
  })

  describe('结构化码未命中 → 回退到文案/category/system', () => {
    it('未识别的 code 回退到文案关键词', () => {
      const r = classifyRecovery({ code: 'SOME_UNKNOWN_CODE', errorMessage: '账号欠费请充值' })
      expect(r.domain).toBe('balance')
    })

    it('未识别的 code + 无文案 → 回退到 category', () => {
      const r = classifyRecovery({ code: 'SOME_UNKNOWN_CODE', category: 'timeout' })
      expect(r.domain).toBe('network')
    })

    it('未识别的 code + 无文案 + 无 category → system 兜底', () => {
      const r = classifyRecovery({ code: 'SOME_UNKNOWN_CODE' })
      expect(r.domain).toBe('system')
    })
  })
})
