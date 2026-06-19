import type { ResetPasswordFormValues } from '../lib/form-schemas'
import { getErrorMessage } from '@excuse/shared'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useSearchParams } from 'react-router'
import { resetPasswordRequest } from '../api/client'
import { AuthPageShell } from '../components/auth/AuthPageShell'
import { PasswordInput } from '../components/PasswordInput'
import { Button } from '../components/ui/button'
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
      <AuthPageShell
        eyebrow="链接已失效"
        title="无效的链接"
        description="密码重置链接无效或已过期，请重新申请。"
      >
        <div className="space-y-5">
          <div className="rounded-[1rem] border border-[color:var(--status-danger-border)] bg-[color:var(--status-danger-bg)] px-4 py-3 text-sm font-medium text-destructive">
            请重新申请密码重置
          </div>
          <p className="text-center text-sm text-muted-foreground">
            <Link to="/forgot-password" className="font-medium text-primary underline-offset-4 hover:underline">
              重新申请
            </Link>
          </p>
        </div>
      </AuthPageShell>
    )
  }

  return (
    <AuthPageShell
      eyebrow="安全重置"
      title="重置密码"
      description={success ? '密码已成功重置。' : '设置一个新密码，继续回到你的创意生产空间。'}
    >
      {success
        ? (
            <div className="space-y-5">
              <div className="rounded-[1.25rem] border border-ring/16 bg-primary-container/70 p-4 text-sm leading-6 text-on-primary-container">
                你的密码已成功重置，请使用新密码登录
              </div>
              <p className="text-center text-sm text-muted-foreground">
                <Link to="/login" className="font-medium text-primary underline-offset-4 hover:underline">
                  前往登录
                </Link>
              </p>
            </div>
          )
        : (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              {serverError && (
                <div className="rounded-[1rem] border border-[color:var(--status-danger-border)] bg-[color:var(--status-danger-bg)] px-4 py-3 text-sm font-medium text-destructive">
                  {serverError}
                </div>
              )}

              <div className="space-y-2">
                <label htmlFor="password" className="text-sm font-medium text-foreground">
                  新密码
                </label>
                <PasswordInput
                  id="password"
                  placeholder="••••••"
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
                  确认新密码
                </label>
                <PasswordInput
                  id="confirmPassword"
                  placeholder="••••••"
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
                重置密码
              </Button>

              <p className="text-center text-sm text-muted-foreground">
                <Link to="/login" className="font-medium text-primary underline-offset-4 hover:underline">
                  返回登录
                </Link>
              </p>
            </form>
          )}
    </AuthPageShell>
  )
}
