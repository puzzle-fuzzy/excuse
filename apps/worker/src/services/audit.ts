import type { auditActionEnum, AuditDetail } from '@excuse/db'
import { createAuditLog } from '@excuse/db'
import { createLogger } from '@excuse/shared'

const logger = createLogger('worker-audit')

type AuditAction = typeof auditActionEnum.enumValues[number]

export interface WorkerAuditEntry {
  accountId?: string
  action: AuditAction
  targetId?: string
  /** 审计详情 — 结构化 AuditDetail DTO，每种 action 有对应形状 */
  detail?: AuditDetail
}

export type WorkerAuditWriter = (entry: WorkerAuditEntry) => Promise<void>

let auditWriter: WorkerAuditWriter = createAuditLog
let auditEnabled = Bun.env.NODE_ENV !== 'test'

/** 测试注入：替换 writer（与 server 的 setAuditWriter 风格一致） */
export function setWorkerAuditWriter(writer: WorkerAuditWriter): void {
  auditWriter = writer
  auditEnabled = true
}

/** 测试清理：恢复默认 writer */
export function resetWorkerAuditWriter(): void {
  auditWriter = createAuditLog
  auditEnabled = Bun.env.NODE_ENV !== 'test'
}

/**
 * 记录审计日志 — 失败时仅 log 不阻塞业务。
 *
 * 与 server 的 audit() 行为一致；独立路径避免 worker → server 反向依赖。
 * worker 不在 HTTP 请求上下文，所以入参没有 ip 字段。
 */
export async function audit(
  action: AuditAction,
  opts?: {
    accountId?: string
    targetId?: string
    detail?: AuditDetail
  },
): Promise<void> {
  if (!auditEnabled)
    return
  try {
    await auditWriter({ action, ...opts })
  }
  catch (err) {
    logger.error({ action, err }, 'worker 审计日志写入失败')
  }
}
