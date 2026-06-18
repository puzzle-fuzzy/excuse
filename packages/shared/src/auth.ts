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
  /** 最后一次登录时间（null 表示从未登录） */
  lastLoginAt: string | null
}

export interface AuthSession {
  token: string
  user: AuthUser
}

export type AuthResponse = EntityResponse<AuthSession>

export type AuthCurrentUserResponse = EntityResponse<AuthUser>

// ── 密码重置 ──

/**
 * 忘记密码请求 — 发送重置邮件
 */
export interface ForgotPasswordRequest {
  email: string
}

/**
 * 重置密码请求
 */
export interface ResetPasswordRequest {
  token: string
  password: string
}

export interface ForgotPasswordResponse {
  success: true
}

export interface ResetPasswordResponse {
  success: true
}
