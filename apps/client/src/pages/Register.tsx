import type { RegisterFormValues } from '../lib/form-schemas'
import { getErrorMessage } from '@excuse/shared'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router'
import { useAuth } from '../auth/AuthContext'
import { AuthPageShell } from '../components/auth/AuthPageShell'
import { PasswordInput } from '../components/PasswordInput'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { registerSchema } from '../lib/form-schemas'

export default function Register() {
  const navigate = useNavigate()
  const { register: registerAccount } = useAuth()

  const [serverError, setServerError] = useState('')
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      username: '',
      email: '',
      password: '',
      confirmPassword: '',
    },
  })

  async function onSubmit(values: RegisterFormValues) {
    setServerError('')
    try {
      await registerAccount(values.username.trim(), values.email.trim(), values.password)
      navigate('/')
    }
    catch (err: unknown) {
      setServerError(getErrorMessage(err) || '注册失败，请重试')
    }
  }

  // 必填错误统一报在 username 字段（见 form-schemas.ts 注释），banner 显示该字段错误；
  // 密码长度 / 不一致则是字段级 error，显示在对应输入框下方。
  const bannerError = errors.username?.message ?? serverError

  return (
    <AuthPageShell
      eyebrow="创建账户"
      title="创建新账户"
      description="建立你的创意生产空间，保存资产、任务记录和后续可复用的生成参数。"
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        {bannerError && (
          <div className="rounded-[1rem] border border-[color:var(--status-danger-border)] bg-[color:var(--status-danger-bg)] px-4 py-3 text-sm font-medium text-destructive">
            {bannerError}
          </div>
        )}

        <div className="space-y-2">
          <label htmlFor="username" className="text-sm font-medium text-foreground">
            用户名
          </label>
          <Input
            id="username"
            type="text"
            placeholder="请输入用户名"
            disabled={isSubmitting}
            autoComplete="username"
            className="h-12 border-input bg-card px-5 text-[15px] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/18"
            {...register('username')}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium text-foreground">
            邮箱
          </label>
          <Input
            id="email"
            type="email"
            placeholder="请输入邮箱"
            disabled={isSubmitting}
            autoComplete="email"
            className="h-12 border-input bg-card px-5 text-[15px] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/18"
            {...register('email')}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="password" className="text-sm font-medium text-foreground">
            密码
          </label>
          <PasswordInput
            id="password"
            placeholder="至少 6 个字符"
            disabled={isSubmitting}
            autoComplete="new-password"
            className="h-12 border-input bg-card px-5 text-[15px] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/18"
            {...register('password')}
          />
          {errors.password && (
            <p className="text-xs font-medium text-destructive">{errors.password.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <label htmlFor="confirmPassword" className="text-sm font-medium text-foreground">
            确认密码
          </label>
          <PasswordInput
            id="confirmPassword"
            placeholder="再次输入密码"
            disabled={isSubmitting}
            autoComplete="new-password"
            className="h-12 border-input bg-card px-5 text-[15px] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/18"
            {...register('confirmPassword')}
          />
          {errors.confirmPassword && (
            <p className="text-xs font-medium text-destructive">{errors.confirmPassword.message}</p>
          )}
        </div>

        <Button
          type="submit"
          className="h-12 w-full bg-primary text-[15px] font-semibold text-primary-foreground shadow-[var(--shadow-floating)] hover:bg-primary/90"
          disabled={isSubmitting}
        >
          {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
          注册
        </Button>

        <p className="text-center text-sm text-muted-foreground">
          已有账户？
          {' '}
          <Link to="/login" className="font-medium text-primary underline-offset-4 hover:underline">
            登录
          </Link>
        </p>
      </form>
    </AuthPageShell>
  )
}
