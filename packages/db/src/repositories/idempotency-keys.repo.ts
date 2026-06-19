import type { IdempotencyKeyRow } from '../types'
import { getPgErrorCode } from '@excuse/shared'
import { and, eq } from 'drizzle-orm'
import { getDb } from '../db'
import { idempotencyKeys } from '../schema'

export type ClaimIdempotencyKeyResult
  = | { claimed: true, row: IdempotencyKeyRow }
    | { claimed: false, conflict: false, row: IdempotencyKeyRow }
    | { claimed: false, conflict: true, row: IdempotencyKeyRow }

export async function claimIdempotencyKey(input: {
  accountId: string
  scope: string
  keyHash: string
  requestHash: string
  expiresAt?: Date
}): Promise<ClaimIdempotencyKeyResult> {
  try {
    const [row] = await getDb()
      .insert(idempotencyKeys)
      .values({
        accountId: input.accountId,
        scope: input.scope,
        keyHash: input.keyHash,
        requestHash: input.requestHash,
        expiresAt: input.expiresAt,
      })
      .returning()

    return { claimed: true, row: row! }
  }
  catch (err) {
    if (getPgErrorCode(err) !== '23505')
      throw err

    const row = await findIdempotencyKey(input.accountId, input.scope, input.keyHash)
    if (!row)
      throw err

    return {
      claimed: false,
      conflict: row.requestHash !== input.requestHash,
      row,
    }
  }
}

export async function findIdempotencyKey(accountId: string, scope: string, keyHash: string) {
  const [row] = await getDb()
    .select()
    .from(idempotencyKeys)
    .where(and(
      eq(idempotencyKeys.accountId, accountId),
      eq(idempotencyKeys.scope, scope),
      eq(idempotencyKeys.keyHash, keyHash),
    ))
    .limit(1)

  return row ?? null
}

export async function attachGenerationRecordToIdempotencyKey(id: string, generationRecordId: string) {
  const [row] = await getDb()
    .update(idempotencyKeys)
    .set({ generationRecordId, updatedAt: new Date() })
    .where(eq(idempotencyKeys.id, id))
    .returning()

  return row ?? null
}
