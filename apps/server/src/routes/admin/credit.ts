import type { AdminCreditAddResponse } from '@excuse/shared'
import { creditBalance, getOrCreateCreditAccount } from '@excuse/db'
import { audit } from '../../services/audit'
import { ConflictError } from '../../utils/app-errors'

export async function handleCreditAdd(
  body: { accountId: string, amountCents: number, description?: string },
  operatorUserId: string,
): Promise<AdminCreditAddResponse> {
  await getOrCreateCreditAccount(body.accountId)
  let tx
  try {
    tx = await creditBalance({
      accountId: body.accountId,
      amountCents: body.amountCents,
      description: body.description ?? '管理后台充值',
      metadata: { operator: operatorUserId, type: 'admin_recharge' },
    })
  }
  catch (err) {
    const message = err instanceof Error ? err.message : '充值失败'
    throw new ConflictError(message)
  }
  audit('admin_action', { accountId: operatorUserId, targetId: body.accountId, detail: { action: 'credit_add', amountCents: body.amountCents, description: body.description } })
  return { success: true, data: { ...tx, createdAt: tx.createdAt.toISOString() } }
}
