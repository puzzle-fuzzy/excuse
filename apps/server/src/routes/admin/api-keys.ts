import { resetApiKeySpend, revokeApiKeyAdmin, updateApiKeyConfig } from '@excuse/db'
import { logger } from '@excuse/shared'
import { audit } from '../../services/audit'
import { notifyApiKeyRevoked } from '../../services/notifications'
import { ConflictError, NotFoundError } from '../../utils/app-errors'

export async function handleUpdateApiKeyConfig(
  keyId: string,
  body: {
    userId: string
    scope?: string
    rateLimitPerMinute?: number | null
    quotaMaxCents?: number | null
  },
  operatorUserId: string,
): Promise<{ success: true }> {
  const updated = await updateApiKeyConfig(keyId, body.userId, {
    scope: body.scope as 'all' | 'gateway' | undefined,
    rateLimitPerMinute: body.rateLimitPerMinute,
    quotaMaxCents: body.quotaMaxCents,
  })
  if (!updated)
    throw new NotFoundError('API Key 不存在')
  audit('admin_action', {
    accountId: operatorUserId,
    targetId: keyId,
    detail: { type: 'api_key_config', scope: body.scope, rateLimitPerMinute: body.rateLimitPerMinute, quotaMaxCents: body.quotaMaxCents },
  })
  return { success: true }
}

export async function handleResetApiKeyQuota(keyId: string, operatorUserId: string): Promise<{ success: true }> {
  await resetApiKeySpend(keyId)
  audit('admin_action', { accountId: operatorUserId, targetId: keyId, detail: { type: 'api_key_quota_reset' } })
  return { success: true }
}

export async function handleRevokeApiKey(keyId: string, operatorUserId: string): Promise<{ success: true }> {
  const revoked = await revokeApiKeyAdmin(keyId)
  if (!revoked)
    throw new ConflictError('API Key 不存在或已撤销')
  audit('api_key_revoke', { accountId: operatorUserId, targetId: keyId })
  notifyApiKeyRevoked(revoked.accountId, revoked.id).catch(err => logger.warn({ err, accountId: revoked.accountId }, 'notifyApiKeyRevoked failed'))
  return { success: true }
}
