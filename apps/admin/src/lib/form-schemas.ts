import { z } from 'zod'

/**
 * 登录表单 schema（管理端仅需要登录）。
 *
 * 必填校验报在 `email` 字段上（path: ['email']）—— RHF 的 zodResolver 不会
 * 把 superRefine 的 path: ['root'] 或 path: [] 映射到 formState.errors.root，
 * 所以 form-level 校验信息走 banner + errors.email?.message（与原 UI 行为等价）。
 * 密码字段保留原值（不 trim），与旧实现一致。
 */
export const loginSchema = z
  .object({
    email: z.string(),
    password: z.string(),
  })
  .superRefine((data, ctx) => {
    const email = data.email.trim()
    if (email === '' || data.password.trim() === '') {
      ctx.addIssue({
        code: 'custom',
        message: '请填写邮箱和密码',
        path: ['email'],
      })
      return
    }
    if (!email.includes('@') || !email.includes('.')) {
      ctx.addIssue({
        code: 'custom',
        message: '请输入有效的邮箱地址',
        path: ['email'],
      })
    }
  })

export type LoginFormValues = z.infer<typeof loginSchema>
