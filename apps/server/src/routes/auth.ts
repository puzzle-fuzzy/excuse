import type { AccountRow } from '@excuse/db'
import type { AuthCurrentUserResponse, AuthResponse, AuthUser, ForgotPasswordResponse, MutationOkResponse, ResetPasswordResponse } from '@excuse/shared'
import type { ServerConfig } from '../config'
import { consumePasswordResetToken, createAccount, createPasswordResetToken, creditBalance, getAccountByEmail, getAccountById, getAccountByUsername, getOrCreateCreditAccount } from '@excuse/db'
import { Elysia, t } from 'elysia'
import { AUTH_COOKIE_NAME, createAuthPlugin } from '../plugins/auth'
import { audit } from '../services/audit'
import { sendPasswordResetEmail } from '../services/email'
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '../utils/app-errors'

/**
 * 从账户行中剥离密码哈希并序列化 Date→string，返回 AuthUser DTO
 */
function sanitizeUser(account: AccountRow): AuthUser {
  const { password: _, createdAt, updatedAt, ...rest } = account
  return {
    ...rest,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  }
}

/** httpOnly cookie 配置 */
const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/api',
  maxAge: 7 * 24 * 3600,
}

/** 密码重置 token 有效期（30 分钟） */
const RESET_TOKEN_EXPIRY_MS = 30 * 60 * 1000

/** 密码重置前端页面 URL */
const RESET_PASSWORD_URL = '/reset-password'

/**
 * 生成密码重置 token（一个 crypto.randomUUID + 随机 hex 后缀）
 * 返回 { rawToken, tokenHash }
 */
function generateResetToken(): { rawToken: string, tokenHash: string } {
  const rawToken = `${crypto.randomUUID()}-${Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')}`
  const tokenHash = new Bun.CryptoHasher('sha256').update(rawToken).digest('hex')
  return { rawToken, tokenHash }
}

/**
 * 认证路由 — 注册 / 登录 / 登出 / 获取当前用户 / 密码重置
 */
export function createAuthRoutes(config: ServerConfig) {
  return new Elysia({ prefix: '/api/auth' })
    .use(createAuthPlugin(config))
    // 注册
    .post('/register', async ({ body, jwt, cookie: cookies }) => {
      const { username, email, password } = body

      const existingEmail = await getAccountByEmail(email)
      if (existingEmail) {
        throw new ConflictError('该邮箱已被注册')
      }

      const existingUsername = await getAccountByUsername(username)
      if (existingUsername) {
        throw new ConflictError('该用户名已被使用')
      }

      const hashedPassword = await Bun.password.hash(password, 'bcrypt')

      const account = await createAccount({
        username,
        email,
        password: hashedPassword,
        isActive: true,
      })

      const token = await jwt.sign({ sub: account.id })

      // 赠送初始额度（幂等：首次注册赠送 1000 cents）
      try {
        await getOrCreateCreditAccount(account.id)
        await creditBalance({ accountId: account.id, amountCents: 1000, description: '注册赠送' })
      }
      catch {
        // 初始额度赠送失败不阻塞注册流程
      }

      audit('register', { accountId: account.id })

      cookies[AUTH_COOKIE_NAME]?.set({ value: token, ...COOKIE_OPTS })

      return {
        success: true,
        data: {
          token,
          user: sanitizeUser(account),
        },
      } satisfies AuthResponse
    }, {
      body: t.Object({
        username: t.String({ minLength: 3, maxLength: 50 }),
        email: t.String({ format: 'email' }),
        password: t.String({ minLength: 6, maxLength: 100 }),
      }),
      detail: {
        summary: '用户注册',
        description: '创建新账户，返回 JWT token 和用户信息。邮箱和用户名不可重复。',
        tags: ['认证'],
      },
    })

    // 登录
    .post('/login', async ({ body, jwt, request, cookie: cookies }) => {
      const { email, password } = body

      const account = await getAccountByEmail(email)
      if (!account) {
        throw new UnauthorizedError('邮箱或密码错误')
      }

      const valid = await Bun.password.verify(password, account.password, 'bcrypt')
      if (!valid) {
        throw new UnauthorizedError('邮箱或密码错误')
      }

      if (!account.isActive) {
        throw new ForbiddenError('账户已被禁用')
      }

      const token = await jwt.sign({ sub: account.id })

      audit('login', { accountId: account.id, ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() })

      cookies[AUTH_COOKIE_NAME]?.set({ value: token, ...COOKIE_OPTS })

      return {
        success: true,
        data: {
          token,
          user: sanitizeUser(account),
        },
      } satisfies AuthResponse
    }, {
      body: t.Object({
        email: t.String(),
        password: t.String(),
      }),
      detail: {
        summary: '用户登录',
        description: '验证邮箱和密码，返回 JWT token 和用户信息。账户被禁用时返回 403。',
        tags: ['认证'],
      },
    })

    // 登出 — 清除 cookie
    .post('/logout', async ({ cookie: cookies }) => {
      cookies[AUTH_COOKIE_NAME]?.remove()
      return { success: true } satisfies MutationOkResponse
    }, {
      detail: {
        summary: '登出',
        description: '清除 httpOnly 认证 cookie',
        tags: ['认证'],
      },
    })

    // 获取当前用户信息
    .get('/me', async ({ userId }) => {
      if (!userId) {
        throw new UnauthorizedError('未登录')
      }

      const account = await getAccountById(userId)
      if (!account) {
        throw new NotFoundError('用户不存在')
      }

      return {
        success: true,
        data: sanitizeUser(account),
      } satisfies AuthCurrentUserResponse
    }, {
      detail: {
        summary: '获取当前用户信息',
        description: '根据 JWT token 返回当前登录用户的完整资料（不含密码哈希）',
        tags: ['认证'],
        security: [{ bearerAuth: [] }],
      },
    })

    // ── 忘记密码 ────────────────────────────────────────────────────────────
    .post('/forgot-password', async ({ body }) => {
      const { email } = body

      // 不暴露「该邮箱是否存在」：无论是否存在都返回成功
      const account = await getAccountByEmail(email)
      if (!account) {
        return { success: true } satisfies ForgotPasswordResponse
      }

      if (!account.isActive) {
        return { success: true } satisfies ForgotPasswordResponse
      }

      // 生成一次性 token
      const { rawToken, tokenHash } = generateResetToken()
      const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_MS)

      try {
        await createPasswordResetToken({
          accountId: account.id,
          tokenHash,
          expiresAt,
        })
      }
      catch {
        // 写入失败不阻塞
        return { success: true } satisfies ForgotPasswordResponse
      }

      // 发送重置邮件（有 SMTP 配置时通过邮件发送，否则打印到控制台）
      const frontendUrl = config.frontendUrl || 'http://localhost:8007'
      const resetLink = `${frontendUrl}${RESET_PASSWORD_URL}?token=${rawToken}`
      sendPasswordResetEmail(email, resetLink, config.smtp).catch(() => {})

      return { success: true } satisfies ForgotPasswordResponse
    }, {
      body: t.Object({
        email: t.String({ format: 'email' }),
      }),
      detail: {
        summary: '忘记密码',
        description: '发送密码重置邮件到指定邮箱。无论邮箱是否存在都返回成功，不泄露用户信息。',
        tags: ['认证'],
      },
    })

    // ── 重置密码 ────────────────────────────────────────────────────────────
    .post('/reset-password', async ({ body }) => {
      const { token, password } = body

      if (password.length < 6) {
        throw new ValidationError('密码长度不能少于 6 位')
      }

      // 哈希 token 并查找
      const tokenHash = new Bun.CryptoHasher('sha256').update(token).digest('hex')
      const consumed = await consumePasswordResetToken(tokenHash)
      if (!consumed) {
        throw new ValidationError('重置链接无效或已过期，请重新申请')
      }

      // 更新密码
      const hashedPassword = await Bun.password.hash(password, 'bcrypt')
      const { updateAccountPassword } = await import('@excuse/db')
      await updateAccountPassword(consumed.accountId, hashedPassword)

      audit('admin_action', { accountId: consumed.accountId, targetId: consumed.tokenId, detail: { action: 'reset_password' } })

      return { success: true } satisfies ResetPasswordResponse
    }, {
      body: t.Object({
        token: t.String({ minLength: 1 }),
        password: t.String({ minLength: 6, maxLength: 100 }),
      }),
      detail: {
        summary: '重置密码',
        description: '使用重置 token 设置新密码。token 一次性使用，过期或已使用将被拒绝。',
        tags: ['认证'],
      },
    })
}
