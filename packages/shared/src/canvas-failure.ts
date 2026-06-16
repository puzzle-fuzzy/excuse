/**
 * Canvas 失败原因分类 — 历史公共 API，保留以避免回归。
 *
 * 规则已收口到 `@excuse/error-recovery`（统一失败 → UX 动作分类，覆盖
 * Workspace / Canvas / Subtitle / Gateway）。本模块内部委托 classifyRecovery
 * 并把更细的 FailureDomain 投影回 7 个 CanvasFailureKind：
 *   validation → system（CanvasFailureKind 无 validation）
 *   其余一一对应。
 *
 * 新代码应直接使用 @excuse/error-recovery 的 classifyRecovery。
 */

import type { FailureDomain } from '@excuse/error-recovery'
import { classifyRecovery } from '@excuse/error-recovery'

/** Canvas 任务失败类型 — 对应不同的下一步建议 */
export type CanvasFailureKind
  = | 'balance' // 余额/配额不足
    | 'content' // 内容审核未通过
    | 'network' // 网络超时/连接
    | 'storage' // 存储上传/下载
    | 'cancel' // 用户主动取消
    | 'provider' // 模型/服务端错误（限流、鉴权、不可用等）
    | 'system' // 系统未知错误

/** 失败分类结果 — kind + 中文标签 + 下一步建议 */
export interface CanvasFailureClassification {
  kind: CanvasFailureKind
  /** 简短中文标签，用于徽章展示 */
  label: string
  /** 下一步建议（给用户的可操作指引） */
  suggestion: string
}

/** FailureDomain → CanvasFailureKind 投影（CanvasFailureKind 无 validation）。 */
function domainToKind(domain: FailureDomain): CanvasFailureKind {
  if (domain === 'validation')
    return 'system'
  return domain
}

/**
 * 把失败错误信息分类为用户可理解的失败类型 + 下一步建议。
 *
 * 委托 @excuse/error-recovery.classifyRecovery，行为与历史关键词规则一致
 * （规则表已整体迁移到 error-recovery）。
 *
 * @param errorMessage 后端存储的错误信息（中文友好消息或原始错误码/文本）
 * @param status 可选：资产/记录状态，cancelled 直接归类为 cancel
 */
export function classifyCanvasFailure(
  errorMessage: string | null | undefined,
  status?: string,
): CanvasFailureClassification {
  const recovery = classifyRecovery({ errorMessage, status })
  return {
    kind: domainToKind(recovery.domain),
    label: recovery.label,
    suggestion: recovery.suggestion,
  }
}
