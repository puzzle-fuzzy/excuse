import type { ForgotPasswordFormValues } from '../lib/form-schemas'
import { getErrorMessage } from '@excuse/shared'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router'
import { forgotPasswordRequest } from '../api/client'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
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
    <div className="brand-auth-shell flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold tracking-tight">忘记密码</CardTitle>
          <CardDescription>
            {submitted ? '重置链接已发送' : '输入你的注册邮箱，我们将发送密码重置链接'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {submitted
            ? (
                <div className="space-y-4">
                  <div className="rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary">
                    如果你的邮箱已注册，你将收到一封包含密码重置链接的邮件。请检查收件箱（包括垃圾邮件文件夹）。
                  </div>
                  <p className="text-center text-sm text-muted-foreground">
                    <Link to="/login" className="text-primary underline-offset-4 hover:underline">
                      返回登录
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

                  {errors.email && (
                    <div className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      {errors.email.message}
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

                  <Button type="submit" className="brand-cta w-full" disabled={isSubmitting}>
                    {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
                    发送重置链接
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
