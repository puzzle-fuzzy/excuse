import type { LoginFormValues } from '../lib/form-schemas'
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
import { loginSchema } from '../lib/form-schemas'

export default function Login() {
  const navigate = useNavigate()
  const { login } = useAuth()

  const [serverError, setServerError] = useState('')
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  })

  async function onSubmit(values: LoginFormValues) {
    setServerError('')
    try {
      await login(values.email.trim(), values.password)
      navigate('/')
    }
    catch (err: unknown) {
      setServerError(getErrorMessage(err) || '登录失败，请重试')
    }
  }

  // 登录页只有一个统一 banner，不区分字段；schema 把必填错误集中到 email 字段
  // （见 form-schemas.ts 注释），因此 banner 取 errors.email?.message。
  const bannerError = errors.email?.message ?? serverError

  return (
    <AuthPageShell
      eyebrow="欢迎回来"
      title="登录你的账户"
      description="继续管理你的生成任务、资产库和创意生产流程。"
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        {bannerError && (
          <div className="rounded-[1rem] border border-[color:var(--status-danger-border)] bg-[color:var(--status-danger-bg)] px-4 py-3 text-sm font-medium text-destructive">
            {bannerError}
          </div>
        )}

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
          <div className="flex items-center justify-between">
            <label htmlFor="password" className="text-sm font-medium text-foreground">
              密码
            </label>
            <Link to="/forgot-password" className="text-xs font-medium text-primary underline-offset-4 hover:underline">
              忘记密码？
            </Link>
          </div>
          <PasswordInput
            id="password"
            placeholder="••••••"
            disabled={isSubmitting}
            autoComplete="current-password"
            className="h-12 border-input bg-card px-5 text-[15px] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/18"
            {...register('password')}
          />
        </div>

        <Button
          type="submit"
          className="h-12 w-full bg-primary text-[15px] font-semibold text-primary-foreground shadow-[var(--shadow-floating)] hover:bg-primary/90"
          disabled={isSubmitting}
        >
          {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
          登录
        </Button>

        <p className="text-center text-sm text-muted-foreground">
          还没有账户？
          {' '}
          <Link to="/register" className="font-medium text-primary underline-offset-4 hover:underline">
            注册
          </Link>
        </p>
      </form>
    </AuthPageShell>
  )
}
