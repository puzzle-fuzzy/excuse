import type { ResetPasswordFormValues } from '../lib/form-schemas'
import { getErrorMessage } from '@excuse/shared'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useSearchParams } from 'react-router'
import { resetPasswordRequest } from '../api/client'
import { PasswordInput } from '../components/PasswordInput'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { resetPasswordSchema } from '../lib/form-schemas'

export default function ResetPassword() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') || ''

  const [success, setSuccess] = useState(false)
  const [serverError, setServerError] = useState('')
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: '', confirmPassword: '' },
  })

  async function onSubmit(values: ResetPasswordFormValues) {
    setServerError('')
    try {
      await resetPasswordRequest(token, values.password)
      setSuccess(true)
    }
    catch (err: unknown) {
      setServerError(getErrorMessage(err) || '重置失败，请重新申请')
    }
  }

  if (!token) {
    return (
      <div className="brand-auth-shell flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl font-bold tracking-tight">无效的链接</CardTitle>
            <CardDescription>密码重置链接无效或已过期</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                请重新申请密码重置
              </div>
              <p className="text-center text-sm text-muted-foreground">
                <Link to="/forgot-password" className="text-primary underline-offset-4 hover:underline">
                  重新申请
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="brand-auth-shell flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold tracking-tight">重置密码</CardTitle>
          <CardDescription>
            {success ? '密码已成功重置' : '输入你的新密码'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {success
            ? (
                <div className="space-y-4">
                  <div className="rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary">
                    你的密码已成功重置，请使用新密码登录
                  </div>
                  <p className="text-center text-sm text-muted-foreground">
                    <Link to="/login" className="text-primary underline-offset-4 hover:underline">
                      前往登录
                    </Link>
                  </p>
                </div>
              )
            : (
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                  {serverError && (
                    <div className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      {serverError}
                    </div>
                  )}

                  <div className="space-y-2">
                    <label htmlFor="password" className="text-sm font-medium">
                      新密码
                    </label>
                    <PasswordInput
                      id="password"
                      placeholder="••••••"
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
                      确认新密码
                    </label>
                    <PasswordInput
                      id="confirmPassword"
                      placeholder="••••••"
                      disabled={isSubmitting}
                      autoComplete="new-password"
                      {...register('confirmPassword')}
                    />
                    {errors.confirmPassword && (
                      <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>
                    )}
                  </div>

                  <Button type="submit" className="brand-cta w-full" disabled={isSubmitting}>
                    {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
                    重置密码
                  </Button>

                  <p className="text-center text-sm text-muted-foreground">
                    <Link to="/login" className="text-primary underline-offset-4 hover:underline">
                      返回登录
                    </Link>
                  </p>
                </form>
              )}
        </CardContent>
      </Card>
    </div>
  )
}
