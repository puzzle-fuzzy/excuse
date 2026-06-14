import type { ModelParameter } from '@/api/client'
import { z } from 'zod'

/**
 * 登录表单 schema。
 *
 * 必填校验报在 `email` 字段上（path: ['email']）—— RHF 7.79 的 zodResolver 不会
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

export const registerSchema = z
  .object({
    username: z.string(),
    email: z.string(),
    password: z.string(),
    confirmPassword: z.string(),
  })
  .superRefine((data, ctx) => {
    const username = data.username.trim()
    const email = data.email.trim()
    const password = data.password
    if (username === '' || email === '' || password === '') {
      ctx.addIssue({
        code: 'custom',
        message: '请填写所有字段',
        path: ['username'],
      })
      return
    }
    if (password.length < 6) {
      ctx.addIssue({
        code: 'custom',
        message: '密码至少 6 个字符',
        path: ['password'],
      })
    }
    if (password !== data.confirmPassword) {
      ctx.addIssue({
        code: 'custom',
        message: '两次输入的密码不一致',
        path: ['confirmPassword'],
      })
    }
  })

export type RegisterFormValues = z.infer<typeof registerSchema>

export const apiKeyCreateSchema = z.object({
  name: z.string().max(100, '名称最长 100 个字符'),
})

export type ApiKeyCreateFormValues = z.infer<typeof apiKeyCreateSchema>

export type ModelLabFormValues = Record<string, string | number | boolean>

function buildParameterFieldSchema(param: ModelParameter): z.ZodTypeAny {
  switch (param.type) {
    case 'number':
      return param.required ? z.number() : z.number().optional()
    case 'boolean':
      return param.required ? z.boolean() : z.boolean().optional()
    case 'select':
    case 'text':
    default: {
      const base = z.union([z.string(), z.number(), z.boolean()])
      return param.required
        ? base.refine(value => String(value).trim() !== '', {
            message: `请填写${param.description || param.name}`,
          })
        : base.optional()
    }
  }
}

export function buildModelLabSchema(parameters: ModelParameter[]): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const param of parameters)
    shape[param.name] = buildParameterFieldSchema(param)
  return z.object(shape)
}
