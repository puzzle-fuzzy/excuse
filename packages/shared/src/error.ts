/**
 * 从 catch 捕获的 unknown error 中安全提取错误消息
 *
 * 使用场景：catch (err: unknown) 时替代 catch (err: any) + err?.message
 *
 * @example
 * catch (err: unknown) {
 *   setError(getErrorMessage(err))
 * }
 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error)
    return err.message
  if (typeof err === 'string')
    return err
  return String(err)
}

/**
 * 检测 PostgreSQL "undefined_table" 错误 (42P01)
 *
 * DrizzleQueryError 把 PG 错误放在 .cause 中，PostgresError 直接带 .code。
 * 此函数同时检测两种情况，附带 message fallback。
 */
export function isPgTableNotFoundError(err: unknown): boolean {
  if (!(err instanceof Error))
    return false

  // DrizzleQueryError: PG error code is in .cause.code
  const cause = (err as { cause?: { code?: string } }).cause
  if (cause?.code === '42P01')
    return true

  // Direct PostgresError: code is on the error itself
  if ((err as { code?: string }).code === '42P01')
    return true

  // Fallback: check message for "relation ... does not exist"
  if (err.message?.includes('does not exist'))
    return true

  return false
}

/**
 * 从错误中提取 PostgreSQL 错误码
 *
 * DrizzleQueryError → err.cause.code
 * PostgresError → err.code
 * 其他 → undefined
 */
export function getPgErrorCode(err: unknown): string | undefined {
  if (!(err instanceof Error))
    return undefined
  const cause = (err as { cause?: { code?: string } }).cause
  return cause?.code ?? (err as { code?: string }).code
}

/** 错误消息最大长度（防止 prompt 全文泄露到 DB/SSE） */
const MAX_ERROR_MESSAGE_LENGTH = 500

/**
 * 脱敏并截断错误消息，防止敏感内容（如 prompt 全文）泄露到 DB 或 SSE。
 *
 * 调用点：DashScope 错误解析、DB errorMessage 写入、SSE NOTIFY 载荷构建。
 *
 * @param message 原始错误消息
 * @param maxLength 最大长度（默认 500）
 * @returns 脱敏后的错误消息
 */
export function sanitizeErrorMessage(message: string, maxLength: number = MAX_ERROR_MESSAGE_LENGTH): string {
  // 截断过长消息
  let sanitized = message.length > maxLength
    ? `${message.slice(0, maxLength)}…`
    : message

  // 移除常见敏感模式：prompt/input/content 字段的 JSON 嵌入
  sanitized = sanitized.replace(/"prompt"\s*:\s*"[^"]{50,}"/gi, '"prompt":"[REDACTED]"')
  sanitized = sanitized.replace(/"input"\s*:\s*\{[^}]{50,}\}/gi, '"input":"[REDACTED]"')

  return sanitized
}
