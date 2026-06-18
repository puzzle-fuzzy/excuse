import type { AuthCurrentUserResponse, AuthResponse, ForgotPasswordResponse, MutationOkResponse, ResetPasswordResponse } from '@excuse/shared'
import { api, unwrapEden } from './client'

// ===== 认证 API =====

export async function registerRequest(username: string, email: string, password: string): Promise<AuthResponse> {
  return unwrapEden<AuthResponse>(
    await api.api.auth.register.post({ username, email, password }),
  )
}

export async function loginRequest(email: string, password: string): Promise<AuthResponse> {
  return unwrapEden<AuthResponse>(
    await api.api.auth.login.post({ email, password }),
  )
}

export async function fetchCurrentUser(): Promise<AuthCurrentUserResponse> {
  return unwrapEden<AuthCurrentUserResponse>(
    await api.api.auth.me.get(),
  )
}

export async function logoutRequest(): Promise<MutationOkResponse> {
  return unwrapEden<MutationOkResponse>(
    await api.api.auth.logout.post(),
  )
}

export async function forgotPasswordRequest(email: string): Promise<ForgotPasswordResponse> {
  return unwrapEden<ForgotPasswordResponse>(
    await api.api.auth['forgot-password'].post({ email }),
  )
}

export async function resetPasswordRequest(token: string, password: string): Promise<ResetPasswordResponse> {
  return unwrapEden<ResetPasswordResponse>(
    await api.api.auth['reset-password'].post({ token, password }),
  )
}
