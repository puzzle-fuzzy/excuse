import type {
  CanvasAssetCategory,
  CanvasAssetRow,
  CanvasShotReferenceAsset,
  CanvasShotReferenceRole,
  GenerationRecordRow,
} from '@excuse/db'
import {
  getCanvasAssetByIdForAccount,
  getGenerationRecordByIdForAccount,
  getUploadedFileByIdForAccount,
} from '@excuse/db'
import { isImageOutput, parseOutputResult } from '@excuse/shared'

/**
 * 镜头参考资产服务端校验（P1-2 v0.3）
 *
 * 在 PATCH /api/canvas/shots/:shotId 保存 referenceAssetsJson 前，对每一项做：
 *   1. 格式归一化（role 枚举、label trim、source 默认 manual）
 *   2. URL 合法性（必须 http/https）
 *   3. 账号归属（uploaded_file / asset_library 必须按 assetId 查到且属于当前用户）
 *   4. URL 可信度（必须匹配资产记录中的稳定 URL，不接受伪造 URL）
 *   5. 去重（assetId 优先，其次 url）与数量上限（≤ 8）
 *
 * 设计原则：不信任前端 source 字符串，统一按 assetId 回查真实记录判断归属和 URL。
 * 仓库函数 `*ForAccount` 在 SQL 层强制 accountId 约束，避免遗漏归属判断。
 */

/** 镜头参考资产数量上限（与 PATCH schema maxItems: 8 对齐） */
export const MAX_REFERENCE_ASSETS = 8

const VALID_ROLES: ReadonlySet<CanvasShotReferenceRole> = new Set([
  'character',
  'location',
  'style',
  'firstFrame',
  'other',
])

/** 图片类 canvas_assets.category（角色/场景参考图；shotVideo 是视频，排除） */
const CANVAS_IMAGE_CATEGORIES: ReadonlySet<CanvasAssetCategory> = new Set([
  'characterPortrait',
  'characterTurnaround',
  'locationRef',
])

/**
 * 校验异常 — 携带 HTTP 状态码供路由选择 422（格式/数量/URL）或 403（归属/匹配）
 */
export class ReferenceAssetValidationError extends Error {
  readonly status: 403 | 422
  constructor(message: string, status: 403 | 422 = 422) {
    super(message)
    this.name = 'ReferenceAssetValidationError'
    this.status = status
  }
}

/**
 * 校验并归一化镜头参考资产列表
 *
 * @returns
 *   - `undefined`：本次 PATCH 不修改参考资产（调用方据此跳过列更新）
 *   - `[]`：清空参考资产
 *   - `CanvasShotReferenceAsset[]`：归一化、去重后的资产列表
 * @throws {ReferenceAssetValidationError} 格式/数量/URL/归属/匹配校验失败
 */
export async function validateShotReferenceAssetsForAccount(
  accountId: string,
  assets: CanvasShotReferenceAsset[] | undefined,
): Promise<CanvasShotReferenceAsset[] | undefined> {
  // undefined：本次不修改参考资产
  if (assets === undefined)
    return undefined
  // 空数组：清空参考资产
  if (assets.length === 0)
    return []

  if (assets.length > MAX_REFERENCE_ASSETS)
    throw new ReferenceAssetValidationError('参考资产不能超过 8 个')

  // 逐项校验 + 归一化，然后按 assetId 优先 / url 其次去重
  const seenAssetIds = new Set<string>()
  const seenUrls = new Set<string>()
  const validated: CanvasShotReferenceAsset[] = []

  for (const raw of assets) {
    const item = await validateOne(accountId, raw)
    if (seenAssetIds.has(item.assetId) || seenUrls.has(item.url))
      continue
    seenAssetIds.add(item.assetId)
    seenUrls.add(item.url)
    validated.push(item)
  }

  return validated
}

/** 校验并归一化单条参考资产 */
async function validateOne(
  accountId: string,
  raw: CanvasShotReferenceAsset,
): Promise<CanvasShotReferenceAsset> {
  if (!isValidHttpUrl(raw.url))
    throw new ReferenceAssetValidationError('参考资产 URL 不合法')
  if (!VALID_ROLES.has(raw.role))
    throw new ReferenceAssetValidationError('参考资产 role 不合法')
  if (typeof raw.assetId !== 'string' || raw.assetId.trim().length === 0)
    throw new ReferenceAssetValidationError('参考资产缺少 assetId')

  // label 归一化：trim 后空字符串 → 不输出 label 字段
  const trimmedLabel = typeof raw.label === 'string' ? raw.label.trim() : ''
  const label = trimmedLabel.length > 0 ? trimmedLabel.slice(0, 100) : undefined

  const source = raw.source ?? 'manual'

  switch (source) {
    case 'manual':
      return buildAsset(raw.assetId, raw.url, raw.role, label, 'manual')

    case 'uploaded_file':
      return validateUploadedFile(accountId, raw.assetId, raw.url, raw.role, label)

    case 'asset_library':
      return validateAssetLibrary(accountId, raw.assetId, raw.url, raw.role, label)
  }
}

/** uploaded_file：必须属于当前账号 + 图片类型 + URL 匹配 publicUrl */
async function validateUploadedFile(
  accountId: string,
  assetId: string,
  url: string,
  role: CanvasShotReferenceRole,
  label: string | undefined,
): Promise<CanvasShotReferenceAsset> {
  const file = await getUploadedFileByIdForAccount(assetId, accountId)
  if (!file)
    throw new ReferenceAssetValidationError('参考资产不存在或无权限访问', 403)
  if (!file.mimeType || !file.mimeType.startsWith('image/'))
    throw new ReferenceAssetValidationError('参考资产不是图片类型')
  if (!urlMatches(url, [file.publicUrl]))
    throw new ReferenceAssetValidationError('参考资产 URL 与资产记录不匹配', 403)
  return buildAsset(assetId, url, role, label, 'uploaded_file')
}

/**
 * asset_library：先查 canvas_assets，未命中再查 generation_records
 *
 * canvas_assets：图片类 category + succeeded + URL 匹配 publicUrl/outputJson.urls
 * generation_records：category=image + succeeded + URL 匹配 outputResult.savedUrls/urls
 */
async function validateAssetLibrary(
  accountId: string,
  assetId: string,
  url: string,
  role: CanvasShotReferenceRole,
  label: string | undefined,
): Promise<CanvasShotReferenceAsset> {
  // 1. canvas_assets
  const canvasAsset = await getCanvasAssetByIdForAccount(assetId, accountId)
  if (canvasAsset) {
    if (canvasAsset.status !== 'succeeded')
      throw new ReferenceAssetValidationError('参考资产尚未生成完成')
    if (!CANVAS_IMAGE_CATEGORIES.has(canvasAsset.category))
      throw new ReferenceAssetValidationError('参考资产不是图片类型')
    const trusted = trustedUrlsForCanvasAsset(canvasAsset)
    if (!urlMatches(url, trusted))
      throw new ReferenceAssetValidationError('参考资产 URL 与资产记录不匹配', 403)
    return buildAsset(assetId, url, role, label, 'asset_library')
  }

  // 2. generation_records 回退
  const record = await getGenerationRecordByIdForAccount(assetId, accountId)
  if (record) {
    if (record.status !== 'succeeded')
      throw new ReferenceAssetValidationError('参考资产尚未生成完成')
    if (record.category !== 'image')
      throw new ReferenceAssetValidationError('参考资产不是图片类型')
    const trusted = trustedUrlsForGenerationRecord(record)
    if (!urlMatches(url, trusted))
      throw new ReferenceAssetValidationError('参考资产 URL 与资产记录不匹配', 403)
    return buildAsset(assetId, url, role, label, 'asset_library')
  }

  // 既不是 canvas_asset 也不是 generation_record
  throw new ReferenceAssetValidationError('参考资产不存在或无权限访问', 403)
}

/** canvas_assets 可信 URL：publicUrl（稳定）+ outputJson.urls（图片列表），不暴露 providerUrl */
function trustedUrlsForCanvasAsset(asset: CanvasAssetRow): string[] {
  const urls: string[] = []
  if (asset.publicUrl)
    urls.push(asset.publicUrl)
  const outputUrls = asset.outputJson?.urls
  if (Array.isArray(outputUrls)) {
    for (const u of outputUrls) {
      if (typeof u === 'string' && u.length > 0)
        urls.push(u)
    }
  }
  return urls
}

/** generation_records 可信 URL：outputResult 解析为 image 输出后的 savedUrls + urls */
function trustedUrlsForGenerationRecord(record: GenerationRecordRow): string[] {
  const output = parseOutputResult(record.outputResult)
  if (!output || !isImageOutput(output))
    return []
  const urls: string[] = []
  for (const u of output.savedUrls)
    urls.push(u)
  if (output.urls) {
    for (const u of output.urls)
      urls.push(u)
  }
  return urls
}

// ── 纯工具函数 ──────────────────────────────────────────────────────────

/** 判断是否为合法 http(s) URL（拒绝 javascript:/file:/空串等） */
function isValidHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0)
    return false
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  }
  catch {
    return false
  }
}

/** 规范化 URL 用于精确匹配（忽略 host 大小写、默认端口、末尾斜杠等差异） */
function normalizeUrl(url: string): string {
  try {
    return new URL(url).href
  }
  catch {
    return url
  }
}

/** candidate 是否匹配任一可信 URL（规范化后精确匹配，不做 host/前缀模糊匹配） */
function urlMatches(candidate: string, trusted: string[]): boolean {
  if (trusted.length === 0)
    return false
  const normalized = normalizeUrl(candidate)
  return trusted.some(t => normalizeUrl(t) === normalized)
}

/** 构造归一化后的 CanvasShotReferenceAsset（label 为空时不输出 label 键） */
function buildAsset(
  assetId: string,
  url: string,
  role: CanvasShotReferenceRole,
  label: string | undefined,
  source: NonNullable<CanvasShotReferenceAsset['source']>,
): CanvasShotReferenceAsset {
  const asset: CanvasShotReferenceAsset = { assetId, url, role, source }
  if (label)
    asset.label = label
  return asset
}
