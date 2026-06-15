import type { EntityResponse } from './api-response'

/**
 * API 返回的用户信息类型（password 已剥离，Date → string）
 */
export interface AuthUser {
  id: string
  username: string
  email: string
  avatar: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface AuthSession {
  token: string
  user: AuthUser
}

export type AuthResponse = EntityResponse<AuthSession>

export type AuthCurrentUserResponse = EntityResponse<AuthUser>
