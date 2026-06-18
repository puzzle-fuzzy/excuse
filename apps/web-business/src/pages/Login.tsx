import type { LoginFormValues } from '../lib/form-schemas'
import { getErrorMessage } from '@excuse/shared'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router'
import { useAuth } from '../auth/AuthContext'
import { PasswordInput } from '../components/PasswordInput'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
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
    <div className="brand-auth-shell flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold tracking-tight">Excuse</CardTitle>
          <CardDescription>登录你的账户</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {bannerError && (
              <div className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {bannerError}
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium">
                邮箱
              </label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                disabled={isSubmitting}
                autoComplete="email"
                {...register('email')}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="text-sm font-medium">
                  密码
                </label>
                <Link to="/forgot-password" className="text-xs text-primary underline-offset-4 hover:underline">
                  忘记密码？
                </Link>
              </div>
              <PasswordInput
                id="password"
                placeholder="••••••"
                disabled={isSubmitting}
                autoComplete="current-password"
                {...register('password')}
              />
            </div>

            <Button type="submit" className="brand-cta w-full" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
              登录
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              还没有账户？
              {' '}
              <Link to="/register" className="text-primary underline-offset-4 hover:underline">
                注册
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
