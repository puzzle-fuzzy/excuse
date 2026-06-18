import type { CreditFlowDetail } from '@excuse/shared'
import { CreditError, debitCredit, refundCredit, reserveCredit } from '@excuse/db'
import { logger } from '@excuse/shared'
import { audit } from './audit'
import { notifyInsufficientBalance } from './notifications'

export type BillingLedgerSource = CreditFlowDetail['source']

export type BillingReserveResult
  = | { ok: true }
    | { ok: false, reason: 'insufficient_balance', message: string }

export interface BillingLedgerInput {
  accountId: string
  recordId: string
  amountCents: number
  description: string
  source: BillingLedgerSource
}

export async function reserveAndTrack(opts: BillingLedgerInput): Promise<BillingReserveResult> {
  if (opts.amountCents <= 0)
    return { ok: true }

  try {
    await reserveCredit({
      accountId: opts.accountId,
      generationRecordId: opts.recordId,
      amountCents: opts.amountCents,
      description: opts.description,
    })
    auditCredit('credit_reserve', opts)
    return { ok: true }
  }
  catch (error) {
    const message = error instanceof Error ? error.message : '余额不足，无法发起生成'
    if (error instanceof CreditError && error.code === 'INSUFFICIENT_BALANCE') {
      await notifyInsufficientBalance(opts.accountId).catch(err => logger.warn({ err, accountId: opts.accountId }, 'notifyInsufficientBalance failed'))
    }
    return { ok: false, reason: 'insufficient_balance', message }
  }
}

export async function debitReservedAndTrack(opts: BillingLedgerInput): Promise<void> {
  if (opts.amountCents <= 0)
    return

  await debitCredit({
    accountId: opts.accountId,
    generationRecordId: opts.recordId,
    actualCents: opts.amountCents,
    description: opts.description,
  })
  auditCredit('credit_debit', opts)
}

export async function refundReservedAndTrack(opts: BillingLedgerInput): Promise<void> {
  if (opts.amountCents <= 0)
    return

  await refundCredit({
    accountId: opts.accountId,
    generationRecordId: opts.recordId,
    description: opts.description,
  })
  auditCredit('credit_refund', opts)
}

function auditCredit(action: 'credit_reserve' | 'credit_debit' | 'credit_refund', opts: BillingLedgerInput): void {
  audit(action, {
    accountId: opts.accountId,
    targetId: opts.recordId,
    detail: {
      accountId: opts.accountId,
      generationRecordId: opts.recordId,
      amountCents: opts.amountCents,
      description: opts.description,
      source: opts.source,
    },
  })
}
