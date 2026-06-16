import type { SmtpConfig } from '../config'
import { createLogger } from '@excuse/shared'
import nodemailer from 'nodemailer'

const logger = createLogger('email')

/**
 * 发送密码重置邮件
 *
 * 当 smtp 配置存在时通过 SMTP 发送；否则打印到控制台（开发/内测模式）。
 *
 * @param to 收件人邮箱
 * @param resetLink 重置链接（含 token）
 * @param smtp SMTP 配置（可选，缺省时仅打印到控制台）
 */
export async function sendPasswordResetEmail(to: string, resetLink: string, smtp?: SmtpConfig): Promise<void> {
  const subject = '【Excuse】密码重置'
  const text = `请点击以下链接重置密码（链接 30 分钟内有效）：\n\n${resetLink}\n\n如果未请求重置，请忽略此邮件。`

  if (smtp) {
    try {
      const transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        auth: { user: smtp.user, pass: smtp.pass },
      })

      await transporter.sendMail({
        from: smtp.from,
        to,
        subject,
        text,
      })

      logger.info({ to }, 'Password reset email sent via SMTP')
    }
    catch (err) {
      // 邮件发送失败不抛出 — 不阻塞重置流程语义
      logger.error({ err, to }, 'Failed to send password reset email via SMTP, falling back to console')
      logger.info(`[EMAIL TO: ${to}] ${subject}\n\n${text}`)
    }
  }
  else {
    logger.info(`[EMAIL TO: ${to}] ${subject}\n\n${text}`)
    logger.info(`[DEV] Reset link: ${resetLink}`)
  }
}
