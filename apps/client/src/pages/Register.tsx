import type { RegisterFormValues } from '../lib/form-schemas'
import { getErrorMessage } from '@excuse/shared'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router'
import { useAuth } from '../auth/AuthContext'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
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
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold tracking-tight">Excuse</CardTitle>
          <CardDescription>创建新账户</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {bannerError && (
              <div className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {bannerError}
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor="username" className="text-sm font-medium">
                用户名
              </label>
              <Input
                id="username"
                type="text"
                placeholder="your_name"
                disabled={isSubmitting}
                autoComplete="username"
                {...register('username')}
              />
            </div>

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
              <label htmlFor="password" className="text-sm font-medium">
                密码
              </label>
              <Input
                id="password"
                type="password"
                placeholder="至少 6 个字符"
                disabled={isSubmitting}
                autoComplete="new-password"
                {...register('password')}
              />
              {errors.password && (
                <p className="text-xs text-destructive">{errors.password.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="confirmPassword" className="text-sm font-medium">
                确认密码
              </label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="再次输入密码"
                disabled={isSubmitting}
                autoComplete="new-password"
                {...register('confirmPassword')}
              />
              {errors.confirmPassword && (
                <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>
              )}
            </div>

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
              注册
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              已有账户？
              {' '}
              <Link to="/login" className="text-primary underline-offset-4 hover:underline">
                登录
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
