/**
 * 百炼 DashScope 错误码 → 中文友好消息映射
 *
 * 涵盖认证、模型、限流、内容审核、参数、服务端、文件等常见错误。
 * 参考文档：docs/bailian/错误码.md
 */

import { sanitizeErrorMessage } from '@excuse/shared'

const DASHSCOPE_ERROR_MESSAGES: Record<string, string> = {
  // ── 认证 / 授权 ──
  'Arrearage': '账号欠费，请前往阿里云控制台充值后重试',
  'InvalidApiKey': 'API Key 无效，请在 .env 中检查 DASHSCOPE_API_KEY 配置',
  'invalid_api_key': 'API Key 无效，请在 .env 中检查 DASHSCOPE_API_KEY 配置',
  'AccessDenied': '无权限访问该模型，可能需在百炼控制台申请模型权限',
  'Model.AccessDenied': '无权限调用该模型，请检查模型是否已开通',
  'App.AccessDenied': '应用访问被拒绝，请检查应用 ID 和 API Key',
  'Workspace.AccessDenied': '工作空间无权限，请使用主账号 API Key',
  'AccessDenied.Unpurchased': '未开通百炼服务，请前往百炼控制台开通',

  // ── 模型错误 ──
  'ModelNotFound': '模型不存在或已下线，请检查模型名称',
  'model_not_found': '模型不存在或已下线，请检查模型名称',
  'model_not_supported': '该模型不支持当前调用方式',

  // ── 限流 ──
  'Throttling': '请求过于频繁，请稍后重试',
  'Throttling.RateQuota': '请求频率超限（RPS），请稍后重试',
  'Throttling.BurstRate': '请求频率增长过快，请平滑增加请求',
  'Throttling.AllocationQuota': 'Token 消耗超限（TPM），请在百炼控制台提升配额',
  'limit_requests': '请求频率超限，请稍后重试',
  'limit_burst_rate': '请求增长过快，请放缓请求速度',
  'insufficient_quota': '配额不足，请稍后重试',
  'AllocationQuota.FreeTierOnly': '免费额度已耗尽，请关闭"免费额度用完即停"后重试',

  // ── 内容审核 ──
  'DataInspectionFailed': '输入或输出内容不合规，请修改后重试',
  'data_inspection_failed': '输入或输出内容不合规，请修改后重试',
  'DataInspectionFailed.Input': '输入内容可能包含敏感信息，请修改后重试',
  'DataInspectionFailed.Output': '生成内容不合规，请调整提示词后重试',

  // ── 参数错误 ──
  'InvalidParameter': '请求参数有误，请检查输入参数',
  'InvalidParameter.DataInspection': '媒体资源下载失败，请检查 URL 是否可访问',
  'InvalidParameter.NotSupportEnableThinking': '当前模型不支持思考模式',
  'BadRequestException': '请求格式错误，请检查请求参数',
  'BadRequest.EmptyInput': '缺少必要参数 input',
  'BadRequest.EmptyParameters': '缺少必要参数 parameters',
  'BadRequest.EmptyModel': '缺少必要参数 model',
  'BadRequest.IllegalInput': '入参格式不符合要求，请使用标准 JSON',
  'BadRequest.TooLarge': '文件大小超出限制',

  // ── URL / 资源错误 ──
  'InvalidURL': '提供的 URL 无效或无法访问',
  'InvalidURL.Timeout': '下载资源超时，请检查网络连接',
  'InvalidURL.ConnectionRefused': '资源服务器拒绝连接，请检查 URL',

  // ── 服务端错误 ──
  'InternalError': '百炼服务内部错误，请稍后重试',
  'internal_error': '百炼服务内部错误，请稍后重试',
  'InternalError.Timeout': '异步任务超时，请重试',
  'InternalError.Algo': '模型推理异常，请稍后重试',
  'InternalError.FileUpload': '文件上传失败，请检查存储配置',
  'InternalError.Upload': '生成结果上传失败，请稍后重试',
  'RequestTimeOut': '请求超时，请检查网络或简化输入内容后重试',
  'ResponseTimeout': '服务响应超时，请稍后重试',
  'ModelUnavailable': '模型暂时不可用，请稍后重试',

  // ── 文件错误 ──
  'InvalidFile.Size': '文件大小不符合要求',
  'InvalidFile.Format': '文件格式不支持',
  'InvalidFile.Duration': '文件时长不符合要求',
  'InvalidFile.Resolution': '文件分辨率不符合要求',
  'InvalidFile.NoHuman': '未检测到人物，请上传包含清晰人物的图片',
  'InvalidImage.ImageSize': '图片大小超出限制',
  'InvalidImageResolution:': '图片分辨率不符合要求',
  'InvalidImageFormat': '图片格式不支持',

  // ── 音频错误 ──
  'Audio.AudioShortError': '音频有效时长过短',
  'Audio.AudioSilentError': '音频文件为静音或有效语音过短',
  'Audio.DecoderError': '音频解码失败，文件可能损坏',
  'Audio.DurationLimitError': '音频时长超出限制',

  // ── 视频生成特殊错误 ──
  'IPInfringementSuspect': '输入内容涉嫌侵权，请修改后重试',
  'CustomRoleBlocked': '内容未通过自定义策略审核，请修改后重试',
  'FaqRuleBlocked': '内容被规则拦截，请修改后重试',
}

/**
 * 根据 DashScope 错误码获取中文友好消息
 */
export function getDashScopeErrorMessage(code: string, fallback: string): string {
  return DASHSCOPE_ERROR_MESSAGES[code] || fallback
}

/**
 * 解析 DashScope API 返回的错误响应，返回中文友好消息
 *
 * 支持 4 种响应格式：
 * 1. DashScope 原生: { code, message }
 * 2. OpenAI 兼容 (带 code): { error: { code, message } }
 * 3. OpenAI 兼容 (无 code): { error: { message } }
 * 4. 异步任务失败: { output: { task_status: "FAILED", message } }
 */
export function parseDashScopeError(response: unknown): string {
  const raw = parseRawDashScopeError(response)
  return sanitizeErrorMessage(raw)
}

/** 解析原始 DashScope 错误响应（未脱敏），供内部调用 */
function parseRawDashScopeError(response: unknown): string {
  if (!response || typeof response !== 'object') {
    return '未知错误'
  }

  const r = response as Record<string, unknown>
  const code = typeof r.code === 'string' ? r.code : undefined
  const message = typeof r.message === 'string' ? r.message : undefined
  const error = typeof r.error === 'object' && r.error !== null ? r.error as Record<string, unknown> : undefined
  const output = typeof r.output === 'object' && r.output !== null ? r.output as Record<string, unknown> : undefined

  // DashScope 原生格式: { code, message }
  if (code) {
    return getDashScopeErrorMessage(code, message ?? '未知错误')
  }

  // OpenAI 兼容格式（带 code）: { error: { code, message } }
  if (error && typeof error.code === 'string') {
    return getDashScopeErrorMessage(error.code, typeof error.message === 'string' ? error.message : '未知错误')
  }

  // OpenAI 兼容格式（仅 message）
  if (error && typeof error.message === 'string') {
    return error.message
  }

  // 异步任务失败格式: { output: { task_status: "FAILED", message } }
  if (output && typeof output.message === 'string') {
    return getDashScopeErrorMessage(
      (typeof output.code === 'string' ? output.code : '') || (typeof output.task_status === 'string' ? output.task_status : ''),
      output.message,
    )
  }

  return '未知错误'
}
