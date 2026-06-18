/**
 * @excuse/auth —— 纯规则包（无 IO 依赖）
 *
 * API Key 的创建、哈希验证与前缀识别。
 * - SHA-256 哈希用于数据库存储（不可逆）
 * - `exc_` 前缀用于区分 API Key 与 JWT token
 */

/** API Key 前缀标记，用于区分 API Key 与 JWT */
export const API_KEY_PREFIX = 'exc_'
/** API Key 前缀截取长度（含 exc_），用于 DB 索引查找 */
export const API_KEY_PREFIX_LENGTH = 8

/** API Key 创建结果：明文 key（仅创建时可见）与前缀 */
export interface CreatedApiKeySecret {
  /** 完整明文 key（仅创建时返回，之后不可恢复） */
  key: string
  /** 前缀（exc_ + 前 4 位随机字符），用于 DB 索引查找 */
  prefix: string
}

/** SHA-256 hash for API Key verification and lookup. */
export async function hashApiKey(key: string): Promise<string> {
  const data = new TextEncoder().encode(key)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

/** 生成一个 `exc_` 前缀的 API Key 密钥对。randomId 可注入（便于测试） */
export function createApiKeySecret(randomId: string = crypto.randomUUID()): CreatedApiKeySecret {
  const key = `${API_KEY_PREFIX}${randomId.replace(/-/g, '')}`
  return {
    key,
    prefix: extractApiKeyPrefix(key),
  }
}

/** 从完整 key 中提取前缀（前 API_KEY_PREFIX_LENGTH 位） */
export function extractApiKeyPrefix(key: string): string {
  return key.slice(0, API_KEY_PREFIX_LENGTH)
}

/** 判断字符串是否以 `exc_` 开头（即是否为 API Key 格式） */
export function isApiKeySecret(value: string): boolean {
  return value.startsWith(API_KEY_PREFIX)
}
