import type { CanvasFailureKind } from '../src/canvas-failure'
import { describe, expect, it } from 'bun:test'
import { classifyCanvasFailure } from '../src/canvas-failure'

describe('classifyCanvasFailure', () => {
  // ── status 优先 ──

  it('status=cancelled 直接归类为 cancel，忽略 errorMessage', () => {
    const result = classifyCanvasFailure('超时 timeout', 'cancelled')
    expect(result.kind).toBe('cancel')
    expect(result.label).toBe('已取消')
    expect(result.suggestion).toBeTruthy()
  })

  // ── 空输入 → system ──

  it('errorMessage 为 null 时归类为 system', () => {
    expect(classifyCanvasFailure(null).kind).toBe('system')
  })

  it('errorMessage 为 undefined 时归类为 system', () => {
    expect(classifyCanvasFailure(undefined).kind).toBe('system')
  })

  it('errorMessage 为空字符串时归类为 system', () => {
    expect(classifyCanvasFailure('').kind).toBe('system')
  })

  // ── balance ──

  it.each([
    '账号欠费，请充值',
    '配额不足',
    '免费额度已耗尽',
    'Arrearage',
    'AllocationQuota exceeded',
    'insufficient_quota',
  ])('余额关键词 "%s" → balance', (msg) => {
    const result = classifyCanvasFailure(msg)
    expect(result.kind).toBe('balance')
    expect(result.label).toBe('余额不足')
  })

  // ── content ──

  it.each([
    '内容不合规',
    '包含敏感信息',
    '审核未通过',
    'DataInspection failed',
    'IPInfringement detected',
    'Blocked by policy',
  ])('内容审核关键词 "%s" → content', (msg) => {
    const result = classifyCanvasFailure(msg)
    expect(result.kind).toBe('content')
    expect(result.label).toBe('内容审核未通过')
  })

  // ── network ──

  it.each([
    '请求超时',
    'timeout exceeded',
    '网络连接失败',
    'ConnectionRefused',
    'RequestTimeOut',
  ])('网络关键词 "%s" → network', (msg) => {
    const result = classifyCanvasFailure(msg)
    expect(result.kind).toBe('network')
    expect(result.label).toBe('网络异常')
  })

  // ── storage ──

  it.each([
    '上传失败',
    'OSS 下载错误',
    'FileUpload error',
    '文件下载失败',
  ])('存储关键词 "%s" → storage', (msg) => {
    const result = classifyCanvasFailure(msg)
    expect(result.kind).toBe('storage')
    expect(result.label).toBe('存储异常')
  })

  // ── cancel (文本匹配) ──

  it('文本中包含"用户取消"归类为 cancel', () => {
    expect(classifyCanvasFailure('用户取消').kind).toBe('cancel')
  })

  it('文本中包含"cancelled"归类为 cancel', () => {
    expect(classifyCanvasFailure('task cancelled by user').kind).toBe('cancel')
  })

  // ── provider ──

  it.each([
    '限流，请稍后重试',
    'Throttling.RateQuota',
    'AccessDenied',
    'API Key 无效',
    '模型不存在',
    'InternalError',
    '推理异常',
    'model_not_found',
  ])('Provider 关键词 "%s" → provider', (msg) => {
    const result = classifyCanvasFailure(msg)
    expect(result.kind).toBe('provider')
    expect(result.label).toBe('模型/服务异常')
  })

  // ── 兜底 → system ──

  it('无法识别的错误信息归类为 system', () => {
    const result = classifyCanvasFailure('some random unknown error')
    expect(result.kind).toBe('system')
    expect(result.label).toBe('系统错误')
  })

  // ── 优先级（具体在前，宽泛在后） ──

  it('同时含余额和 provider 关键词时，优先匹配 balance', () => {
    const result = classifyCanvasFailure('配额不足，InternalError')
    expect(result.kind).toBe('balance')
  })

  it('同时含内容和网络关键词时，优先匹配 content', () => {
    const result = classifyCanvasFailure('审核未通过，请求超时')
    expect(result.kind).toBe('content')
  })

  it('同时含网络和存储关键词时，优先匹配 network', () => {
    const result = classifyCanvasFailure('超时导致上传失败')
    expect(result.kind).toBe('network')
  })

  // ── 大小写不敏感 ──

  it('关键词匹配大小写不敏感', () => {
    expect(classifyCanvasFailure('TIMEOUT error').kind).toBe('network')
    expect(classifyCanvasFailure('ARREARAGE detected').kind).toBe('balance')
    expect(classifyCanvasFailure('THROTTLING rate').kind).toBe('provider')
  })

  // ── 返回结构完整性 ──

  it('每种 kind 都有对应的 label 和 suggestion', () => {
    const kinds: CanvasFailureKind[] = ['balance', 'content', 'network', 'storage', 'cancel', 'provider', 'system']
    const triggerMessages: Record<CanvasFailureKind, string> = {
      balance: '欠费',
      content: '审核未通过',
      network: '超时',
      storage: '上传失败',
      cancel: '用户取消',
      provider: '限流',
      system: '未知错误',
    }
    for (const kind of kinds) {
      const result = classifyCanvasFailure(triggerMessages[kind])
      expect(result.kind).toBe(kind)
      expect(result.label).toBeTruthy()
      expect(result.suggestion).toBeTruthy()
    }
  })
})
