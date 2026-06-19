import type { ForgotPasswordFormValues } from '../lib/form-schemas'
import { getErrorMessage } from '@excuse/shared'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router'
import { forgotPasswordRequest } from '../api/client'
import { AuthPageShell } from '../components/auth/AuthPageShell'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { forgotPasswordSchema } from '../lib/form-schemas'

export default function ForgotPassword() {
  const [submitted, setSubmitted] = useState(false)
  const [serverError, setServerError] = useState('')
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  })

  async function onSubmit(values: ForgotPasswordFormValues) {
    setServerError('')
    try {
      await forgotPasswordRequest(values.email.trim())
      setSubmitted(true)
    }
    catch (err: unknown) {
      setServerError(getErrorMessage(err) || '请求失败，请稍后重试')
    }
  }

  return (
    <AuthPageShell
      eyebrow="Account recovery"
      title="忘记密码"
      description={submitted ? '重置链接已发送' : '输入你的注册邮箱，我们将发送密码重置链接。'}
    >
      {submitted
        ? (
            <div className="space-y-5">
              <div className="rounded-[1.25rem] border border-ring/16 bg-primary-container/70 p-4 text-sm leading-6 text-on-primary-container">
                如果你的邮箱已注册，你将收到一封包含密码重置链接的邮件。请检查收件箱（包括垃圾邮件文件夹）。
              </div>
              <p className="text-center text-sm text-muted-foreground">
                <Link to="/login" className="font-medium text-primary underline-offset-4 hover:underline">
                  返回登录
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

              {errors.email && (
                <div className="rounded-[1rem] border border-[color:var(--status-danger-border)] bg-[color:var(--status-danger-bg)] px-4 py-3 text-sm font-medium text-destructive">
                  {errors.email.message}
                </div>
              )}

              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium text-foreground">
                  邮箱
                </label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  disabled={isSubmitting}
                  autoComplete="email"
                  className="h-12 border-input bg-card px-5 text-[15px] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/18"
                  {...register('email')}
                />
              </div>

              <Button
                type="submit"
                className="h-12 w-full bg-primary text-[15px] font-semibold text-primary-foreground shadow-[var(--shadow-floating)] hover:bg-primary/90"
                disabled={isSubmitting}
              >
                {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
                发送重置链接
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
