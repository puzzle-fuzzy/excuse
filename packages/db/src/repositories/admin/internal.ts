/**
 * admin 仓储内部共享 helper —— 仅供 `admin/` 子目录内各域文件使用，
 * **不**经 `admin.repo.ts` barrel 再导出（不进入对外 API）。
 *
 * 抽离原因：`numberValue` / `iso` 被 overview / tasks / users / providers /
 * projects / gateway 六个域共用，集中一处避免重复。
 */

/** DB 聚合返回的 numeric 可能是 string / null，统一转 number（缺省 0）。 */
export function numberValue(value: unknown): number {
  return Number(value ?? 0)
}

/** Date / ISO string / null → ISO string | null；非空保证由调用方（`!`）声明。 */
export function iso(value: Date | string | null | undefined): string | null {
  if (!value)
    return null
  return value instanceof Date ? value.toISOString() : value
}
