import { and, eq, sql } from 'drizzle-orm'
import { getDb } from '../db'
import { passwordResetTokens } from '../schema'

/**
 * 创建密码重置令牌记录
 */
export async function createPasswordResetToken(opts: {
  accountId: string
  tokenHash: string
  expiresAt: Date
}) {
  const [record] = await getDb()
    .insert(passwordResetTokens)
    .values({
      accountId: opts.accountId,
      tokenHash: opts.tokenHash,
      expiresAt: opts.expiresAt,
    })
    .returning()
  return record!
}

/**
 * 查找并使用一个重置令牌（原子操作：一次性）
 *
 * 返回匹配的令牌记录（已标记为 used），或 null（无效/已过期/已使用）
 */
export async function consumePasswordResetToken(tokenHash: string): Promise<{ accountId: string, tokenId: string } | null> {
  const [record] = await getDb()
    .update(passwordResetTokens)
    .set({
      used: true,
      usedAt: new Date(),
    })
    .where(and(
      eq(passwordResetTokens.tokenHash, tokenHash),
      eq(passwordResetTokens.used, false),
      sql`${passwordResetTokens.expiresAt} > NOW()`,
    ))
    .returning({
      accountId: passwordResetTokens.accountId,
      tokenId: passwordResetTokens.id,
    })

  return record ?? null
}

/**
 * 清理已过期或已使用的令牌
 */
export async function cleanupExpiredTokens(): Promise<number> {
  const result = await getDb()
    .delete(passwordResetTokens)
    .where(
      sql`${passwordResetTokens.expiresAt} < NOW() OR ${passwordResetTokens.used} = true`,
    )
  return result.length
}
