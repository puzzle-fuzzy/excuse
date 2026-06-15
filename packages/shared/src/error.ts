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
  if (!(err instanceof Error)) return false

  // DrizzleQueryError: PG error code is in .cause.code
  const cause = (err as { cause?: { code?: string } }).cause
  if (cause?.code === '42P01') return true

  // Direct PostgresError: code is on the error itself
  if ((err as { code?: string }).code === '42P01') return true

  // Fallback: check message for "relation ... does not exist"
  if (err.message?.includes('does not exist')) return true

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
  if (!(err instanceof Error)) return undefined
  const cause = (err as { cause?: { code?: string } }).cause
  return cause?.code ?? (err as { code?: string }).code
}
