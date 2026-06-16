import { createLogger } from '@excuse/shared'

const logger = createLogger('email')

/**
 * 发送密码重置邮件
 *
 * 当前实现：开发环境打印到控制台（含可点击链接）。
 * 生产环境需接入 SMTP 或事务邮件 API（如 SendGrid、阿里云邮件）：
 * 1. 在 ServerConfig 中添加 smtp 配置段
 * 2. 引入 nodemailer 或对应 SDK
 * 3. 替换本函数体
 *
 * @param to 收件人邮箱
 * @param resetLink 重置链接（含 token）
 */
export async function sendPasswordResetEmail(to: string, resetLink: string): Promise<void> {
  const subject = '【Excuse】密码重置'
  const body = `请点击以下链接重置密码（链接 30 分钟内有效）：\n\n${resetLink}\n\n如果未请求重置，请忽略此邮件。`

  if (process.env.NODE_ENV === 'production') {
    // 生产环境占位：接入 SMTP / 事务邮件后替换此处
    logger.warn({ to, resetLink }, 'Password reset email not sent (SMTP not configured)')
    logger.info(`[EMAIL TO: ${to}] ${subject}\n\n${body}`)
  }
  else {
    // 开发环境直接打印到控制台
    logger.info(`[EMAIL TO: ${to}] ${subject}\n\n${body}`)
    logger.info(`[DEV] Reset link: ${resetLink}`)
  }
}
