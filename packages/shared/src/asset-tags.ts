/**
 * 资产标签 DTO — 跨 DB / API / Client 共用
 *
 * 不使用 Date 类型（API 边界一律 ISO 字符串）。
 */

export interface AssetTagDTO {
  id: string
  name: string
  /** ISO 字符串 */
  createdAt: string
}

export interface AssetTagListResponse {
  success: true
  items: AssetTagDTO[]
}

export interface AssetTagCreateResponse {
  success: true
  data: AssetTagDTO
}

export interface AssetTagMutationResponse {
  success: true
}
