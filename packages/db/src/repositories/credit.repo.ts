import type { CreditAccountRow, CreditTransactionRow, GenerationStatus } from '../types'
import { getPgErrorCode } from '@excuse/shared'
import { and, desc, eq, inArray, lte, or, sql } from 'drizzle-orm'
import { getDb } from '../db'
import { creditAccounts, creditTransactions, generationRecords, usageEvents } from '../schema'

// ===== Credit Account =====

/**
 * 获取或创建用户信用账户（每用户一行）
 */
export async function getOrCreateCreditAccount(accountId: string): Promise<CreditAccountRow> {
  const existing = await getCreditAccount(accountId)
  if (existing)
    return existing

  const [created] = await getDb().insert(creditAccounts).values({ accountId }).returning()
  return created!
}

/**
 * 获取用户信用账户
 */
export async function getCreditAccount(accountId: string): Promise<CreditAccountRow | null> {
  const [row] = await getDb()
    .select()
    .from(creditAccounts)
    .where(eq(creditAccounts.accountId, accountId))
    .limit(1)
  return row ?? null
}

// ===== Reserve / Debit / Refund =====

/**
 * 预留资金 — 生成开始时冻结预估费用
 *
 * 原子操作：检查余额 → 扣减可用 → 增加冻结 → 写交易流水 → 写使用事件
 * 使用 SQL UPDATE ... WHERE 确保并发安全
 *
 * @throws 余额不足时抛出 Error
 */
export async function reserveCredit(opts: {
  accountId: string
  generationRecordId: string
  amountCents: number
  description?: string
}): Promise<CreditTransactionRow> {
  const { accountId, generationRecordId, amountCents, description } = opts
  assertPositiveAmount(amountCents)

  const existing = await getCreditTransactionByRecordAndType(generationRecordId, 'reserve')
  if (existing)
    return existing

  try {
    return await getDb().transaction(async (txDb) => {
      // 原子扣减：只有 availableCents >= amountCents 时才更新
      const [updated] = await txDb
        .update(creditAccounts)
        .set({
          availableCents: sql`${creditAccounts.availableCents} - ${amountCents}`,
          frozenCents: sql`${creditAccounts.frozenCents} + ${amountCents}`,
          updatedAt: new Date(),
        })
        .where(and(
          eq(creditAccounts.accountId, accountId),
          sql`${creditAccounts.availableCents} >= ${amountCents}`,
        ))
        .returning()

      if (!updated) {
        const [account] = await txDb
          .select()
          .from(creditAccounts)
          .where(eq(creditAccounts.accountId, accountId))
          .limit(1)
        throw new CreditError(
          'INSUFFICIENT_BALANCE',
          `余额不足：需要 ${amountCents} 分，可用 ${account?.availableCents ?? 0} 分`,
        )
      }

      // 写交易流水。若并发重复预留触发唯一索引，事务会回滚上面的余额更新。
      const [txRow] = await txDb.insert(creditTransactions).values({
        accountId,
        type: 'reserve',
        amountCents,
        balanceAfterCents: updated.availableCents,
        frozenAfterCents: updated.frozenCents,
        generationRecordId,
        description: description ?? '生成任务预留',
      }).returning()

      await txDb.insert(usageEvents).values({
        accountId,
        generationRecordId,
        reserveTxId: txRow!.id,
        reservedCents: amountCents,
      }).onConflictDoNothing()

      return txRow!
    })
  }
  catch (error) {
    if (getPgErrorCode(error) === '23505') {
      const duplicated = await getCreditTransactionByRecordAndType(generationRecordId, 'reserve')
      if (duplicated)
        return duplicated
    }
    throw error
  }
}

/**
 * 扣款 — 生成成功后从冻结中扣除实际费用
 *
 * 如果实际费用 < 预留金额，差额退还到可用余额
 * 幂等：同一 generationRecordId 只能 debit 一次
 */
export async function debitCredit(opts: {
  accountId: string
  generationRecordId: string
  actualCents: number
  description?: string
}): Promise<CreditTransactionRow> {
  const { accountId, generationRecordId, actualCents, description } = opts
  assertPositiveAmount(actualCents)

  const existing = await getCreditTransactionByRecordAndType(generationRecordId, 'debit')
  if (existing)
    return existing

  try {
    return await getDb().transaction(async (txDb) => {
      const [event] = await txDb
        .select()
        .from(usageEvents)
        .where(eq(usageEvents.generationRecordId, generationRecordId))
        .for('update')
        .limit(1)

      const settled = await getSettledGenerationTransaction(generationRecordId, txDb)
      if (settled) {
        if (settled.type === 'debit')
          return settled
        throw new CreditError('ALREADY_SETTLED', `生成记录已退款，不能再次扣款: ${generationRecordId}`)
      }

      const reservedCents = event?.reservedCents ?? 0
      const refundCents = Math.max(0, reservedCents - actualCents)
      const extraDebitCents = Math.max(0, actualCents - reservedCents)

      // 原子更新：冻结减少预留金额；实际费用低于预留时退差额，高于预留时从可用余额补扣差额。
      const [updated] = await txDb
        .update(creditAccounts)
        .set({
          frozenCents: sql`${creditAccounts.frozenCents} - ${reservedCents}`,
          availableCents: sql`${creditAccounts.availableCents} + ${refundCents} - ${extraDebitCents}`,
          updatedAt: new Date(),
        })
        .where(and(
          eq(creditAccounts.accountId, accountId),
          sql`${creditAccounts.frozenCents} >= ${reservedCents}`,
          sql`${creditAccounts.availableCents} >= ${extraDebitCents}`,
        ))
        .returning()

      if (!updated) {
        throw new CreditError('INSUFFICIENT_BALANCE', `余额不足，无法完成实际扣款: ${accountId}`)
      }

      const [txRow] = await txDb.insert(creditTransactions).values({
        accountId,
        type: 'debit',
        amountCents: actualCents,
        balanceAfterCents: updated.availableCents,
        frozenAfterCents: updated.frozenCents,
        generationRecordId,
        description: description ?? '生成完成扣款',
      }).returning()

      if (event) {
        await txDb
          .update(usageEvents)
          .set({ debitTxId: txRow!.id, debitedCents: actualCents, updatedAt: new Date() })
          .where(eq(usageEvents.id, event.id))
      }

      return txRow!
    })
  }
  catch (error) {
    if (getPgErrorCode(error) === '23505') {
      const duplicated = await getCreditTransactionByRecordAndType(generationRecordId, 'debit')
      if (duplicated)
        return duplicated
    }
    throw error
  }
}

/**
 * 退还 — 生成失败时全额退还冻结资金
 *
 * 幂等：同一 generationRecordId 只能 refund 一次
 */
export async function refundCredit(opts: {
  accountId: string
  generationRecordId: string
  description?: string
}): Promise<CreditTransactionRow> {
  const { accountId, generationRecordId, description } = opts

  const existing = await getCreditTransactionByRecordAndType(generationRecordId, 'refund')
  if (existing)
    return existing

  try {
    return await getDb().transaction(async (txDb) => {
      const [event] = await txDb
        .select()
        .from(usageEvents)
        .where(eq(usageEvents.generationRecordId, generationRecordId))
        .for('update')
        .limit(1)

      const settled = await getSettledGenerationTransaction(generationRecordId, txDb)
      if (settled) {
        if (settled.type === 'refund')
          return settled
        throw new CreditError('ALREADY_SETTLED', `生成记录已扣款，不能再次退款: ${generationRecordId}`)
      }

      const reservedCents = event?.reservedCents ?? 0
      if (reservedCents <= 0) {
        throw new CreditError('NO_RESERVED_CREDIT', `生成记录没有可退还的冻结金额: ${generationRecordId}`)
      }

      // 原子更新：冻结减少，可用增加
      const [updated] = await txDb
        .update(creditAccounts)
        .set({
          frozenCents: sql`${creditAccounts.frozenCents} - ${reservedCents}`,
          availableCents: sql`${creditAccounts.availableCents} + ${reservedCents}`,
          updatedAt: new Date(),
        })
        .where(and(
          eq(creditAccounts.accountId, accountId),
          sql`${creditAccounts.frozenCents} >= ${reservedCents}`,
        ))
        .returning()

      if (!updated) {
        throw new CreditError('ACCOUNT_NOT_FOUND', `账户不存在或冻结金额不足: ${accountId}`)
      }

      const [txRow] = await txDb.insert(creditTransactions).values({
        accountId,
        type: 'refund',
        amountCents: reservedCents,
        balanceAfterCents: updated.availableCents,
        frozenAfterCents: updated.frozenCents,
        generationRecordId,
        description: description ?? '生成失败退还',
      }).returning()

      if (event) {
        await txDb
          .update(usageEvents)
          .set({ refundTxId: txRow!.id, updatedAt: new Date() })
          .where(eq(usageEvents.id, event.id))
      }

      return txRow!
    })
  }
  catch (error) {
    if (getPgErrorCode(error) === '23505') {
      const duplicated = await getCreditTransactionByRecordAndType(generationRecordId, 'refund')
      if (duplicated)
        return duplicated
    }
    throw error
  }
}

// ===== Credit (充值) =====

/**
 * 充值 — 增加用户可用余额
 */
export async function creditBalance(opts: {
  accountId: string
  amountCents: number
  description?: string
  metadata?: Record<string, unknown>
}): Promise<CreditTransactionRow> {
  const { accountId, amountCents, description, metadata } = opts

  const [updated] = await getDb()
    .update(creditAccounts)
    .set({
      availableCents: sql`${creditAccounts.availableCents} + ${amountCents}`,
      updatedAt: new Date(),
    })
    .where(eq(creditAccounts.accountId, accountId))
    .returning()

  if (!updated) {
    throw new CreditError('ACCOUNT_NOT_FOUND', `账户不存在: ${accountId}`)
  }

  const [tx] = await getDb().insert(creditTransactions).values({
    accountId,
    type: 'credit',
    amountCents,
    balanceAfterCents: updated.availableCents,
    frozenAfterCents: updated.frozenCents,
    description: description ?? '充值',
    metadata,
  }).returning()

  return tx!
}

// ===== Query =====

/**
 * 查询交易流水
 */
export async function listCreditTransactions(opts: {
  accountId: string
  limit?: number
  offset?: number
}): Promise<CreditTransactionRow[]> {
  const { accountId, limit = 50, offset = 0 } = opts
  return getDb()
    .select()
    .from(creditTransactions)
    .where(eq(creditTransactions.accountId, accountId))
    .orderBy(desc(creditTransactions.createdAt))
    .limit(limit)
    .offset(offset)
}

/**
 * 查找孤立的 reserve 交易 — 已 reserve 超过阈值但无对应 debit/refund 收尾的记录。
 *
 * 用于信用对账 job（worker 周期任务，TODO §1.3）：防止 server/worker 崩溃或流式中断
 * 导致用户余额永久 frozen。正常 reserve → debit/refund 应在数分钟内完成，
 * 超过 thresholdMinutes 的孤立 reserve 应自动 refund。
 */
export async function findStaleReservedCredits(thresholdMinutes = 60): Promise<Array<{
  reserveTxId: string
  accountId: string
  generationRecordId: string
  status: GenerationStatus
  reservedCents: number
  createdAt: Date
  recordUpdatedAt: Date
}>> {
  const reserveCutoff = new Date(Date.now() - thresholdMinutes * 60 * 1000)
  const activeRecordCutoff = new Date(Date.now() - Math.max(thresholdMinutes * 6, 360) * 60 * 1000)
  const terminalStatuses = ['failed', 'cancelled'] as const
  const activeStatuses = ['pending', 'submitting', 'processing', 'saving_output'] as const

  // 子查询：查找有 reserve 但无 debit 也无 refund 的 generationRecordId
  const recordsWithDebitOrRefund = getDb()
    .select({ generationRecordId: creditTransactions.generationRecordId })
    .from(creditTransactions)
    .where(
      and(
        sql`${creditTransactions.generationRecordId} IS NOT NULL`,
        or(
          eq(creditTransactions.type, 'debit'),
          eq(creditTransactions.type, 'refund'),
        ),
      ),
    )
    .as('records_with_debit_or_refund')

  const rows = await getDb()
    .select({
      reserveTxId: creditTransactions.id,
      accountId: creditTransactions.accountId,
      generationRecordId: creditTransactions.generationRecordId,
      status: generationRecords.status,
      reservedCents: creditTransactions.amountCents,
      createdAt: creditTransactions.createdAt,
      recordUpdatedAt: generationRecords.updatedAt,
    })
    .from(creditTransactions)
    .innerJoin(generationRecords, eq(generationRecords.id, creditTransactions.generationRecordId))
    .where(and(
      eq(creditTransactions.type, 'reserve'),
      lte(creditTransactions.createdAt, reserveCutoff),
      sql`${creditTransactions.generationRecordId} IS NOT NULL`,
      sql`${creditTransactions.generationRecordId} NOT IN (SELECT ${recordsWithDebitOrRefund.generationRecordId} FROM ${recordsWithDebitOrRefund})`,
      or(
        inArray(generationRecords.status, [...terminalStatuses]),
        and(
          inArray(generationRecords.status, [...activeStatuses]),
          lte(generationRecords.updatedAt, activeRecordCutoff),
        ),
      ),
    ))

  return rows
    .filter((r): r is typeof r & { generationRecordId: string } => r.generationRecordId !== null)
    .map(r => ({
      reserveTxId: r.reserveTxId,
      accountId: r.accountId,
      generationRecordId: r.generationRecordId,
      status: r.status,
      reservedCents: Number(r.reservedCents),
      createdAt: r.createdAt,
      recordUpdatedAt: r.recordUpdatedAt,
    }))
}

// ===== Error =====

export class CreditError extends Error {
  readonly code: CreditErrorCode
  constructor(
    code: CreditErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'CreditError'
    this.code = code
  }
}

export type CreditErrorCode
  = | 'INSUFFICIENT_BALANCE'
    | 'ACCOUNT_NOT_FOUND'
    | 'ALREADY_RESERVED'
    | 'ALREADY_SETTLED'
    | 'INVALID_AMOUNT'
    | 'NO_RESERVED_CREDIT'

type GenerationCreditTransactionType = 'reserve' | 'debit' | 'refund'

function assertPositiveAmount(amountCents: number) {
  // 允许小数分：分值列已改为 numeric(20,4)，文本（按 token）与音频（按秒）计价产生 sub-cent
  // 金额（如 qwen-max 1000/500 token → 0.72 分）。仍拒绝 0 / 负数 / NaN。
  if (!(amountCents > 0)) {
    throw new CreditError('INVALID_AMOUNT', `金额必须是正数: ${amountCents}`)
  }
}

async function getCreditTransactionByRecordAndType(
  generationRecordId: string,
  type: GenerationCreditTransactionType,
): Promise<CreditTransactionRow | null> {
  const [row] = await getDb()
    .select()
    .from(creditTransactions)
    .where(and(
      eq(creditTransactions.generationRecordId, generationRecordId),
      eq(creditTransactions.type, type),
    ))
    .limit(1)
  return row ?? null
}

type DbClient = ReturnType<typeof getDb>

async function getSettledGenerationTransaction(
  generationRecordId: string,
  db: Pick<DbClient, 'select'> = getDb(),
): Promise<CreditTransactionRow | null> {
  const [row] = await db
    .select()
    .from(creditTransactions)
    .where(and(
      eq(creditTransactions.generationRecordId, generationRecordId),
      or(eq(creditTransactions.type, 'debit'), eq(creditTransactions.type, 'refund')),
    ))
    .for('update')
    .limit(1)
  return row ?? null
}
