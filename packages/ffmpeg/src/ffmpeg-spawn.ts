/**
 * FFmpeg 子进程管理 —— 带超时兜底 + 强制 kill
 *
 * 封装 Bun.spawn 调用，为所有 FFmpeg 操作提供统一超时保护。
 * 坏文件、超大文件、编码死循环等场景下防止 worker 永久卡死。
 *
 * 超时通过 env FFMPEG_TIMEOUT_MS 配置（默认 600_000 = 10 分钟）。
 * 超时时：先 SIGTERM → 等待 5s grace period → SIGKILL 强制终止。
 */

import { resolve } from 'node:path'

/** FFmpeg 操作超时错误 —— retriable，触发 task-engine 重试 */
export class FfmpegTimeoutError extends Error {
  readonly command: string
  readonly timeoutMs: number

  constructor(message: string, command: string, timeoutMs: number) {
    super(message)
    this.name = 'FfmpegTimeoutError'
    this.command = command
    this.timeoutMs = timeoutMs
  }
}

export interface FfmpegSpawnOptions {
  /** 输出目录（用于 stderr 日志文件落盘） */
  outputDir?: string
  /** 超时毫秒数，默认取 FFMPEG_TIMEOUT_MS 环境变量或 600_000（10 分钟） */
  timeoutMs?: number
}

export interface FfmpegSpawnResult {
  exitCode: number
  stdout: string
  stderr: string
  /** stderr 日志文件路径（仅在提供 outputDir 时写入） */
  stderrLogPath?: string
}

/** 默认超时（10 分钟） */
const DEFAULT_TIMEOUT_MS = 600_000

function getDefaultTimeout(): number {
  const env = process.env.FFMPEG_TIMEOUT_MS
  if (env) {
    const parsed = Number.parseInt(env, 10)
    if (Number.isFinite(parsed) && parsed > 0)
      return parsed
  }
  return DEFAULT_TIMEOUT_MS
}

/**
 * 以超时保护执行 FFmpeg 命令。
 *
 * 超时策略：
 *   1. 超时触发 → AbortController.abort()（Bun 发送 SIGTERM）
 *   2. 等待 grace period（5s），若进程仍未退出 → proc.kill('SIGKILL')
 *   3. 超时时抛 FfmpegTimeoutError（retriable）
 *
 * stderr 在提供 outputDir 时会写入磁盘日志文件，方便事后排查。
 *
 * @param cmd 可执行文件路径（如 'ffmpeg' 或 'ffprobe'）
 * @param args 命令行参数数组
 * @param opts 可选配置
 */
export async function spawnFfmpeg(
  cmd: string,
  args: string[],
  opts: FfmpegSpawnOptions = {},
): Promise<FfmpegSpawnResult> {
  const timeoutMs = opts.timeoutMs ?? getDefaultTimeout()
  const controller = new AbortController()

  const proc = Bun.spawn([cmd, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    signal: controller.signal,
  })

  let stdout = ''
  let stderr = ''
  const stdoutCollector = (async () => {
    stdout = await new Response(proc.stdout).text()
  })()
  const stderrCollector = (async () => {
    stderr = await new Response(proc.stderr).text()
  })()

  // 超时定时器
  const timeoutTimer = setTimeout(() => {
    controller.abort()
  }, timeoutMs)

  // Grace period: 超时后等 5s 再 SIGKILL
  const GRACE_MS = 5_000
  let killed = false

  try {
    const exitCode = await proc.exited
    clearTimeout(timeoutTimer)

    // 检查是否被 abort 杀死
    if (killed) {
      await Promise.all([stdoutCollector, stderrCollector])
      throw new FfmpegTimeoutError(
        `FFmpeg ${cmd} 操作超时 (${timeoutMs}ms)，已被强制终止`,
        cmd,
        timeoutMs,
      )
    }

    await Promise.all([stdoutCollector, stderrCollector])

    // 写入 stderr 日志（若提供 outputDir）
    let stderrLogPath: string | undefined
    if (opts.outputDir) {
      stderrLogPath = resolve(resolve(opts.outputDir), `ffmpeg_stderr_${Date.now()}.log`)
      await Bun.write(stderrLogPath, stderr)
    }

    return { exitCode, stdout, stderr, stderrLogPath }
  }
  catch (err) {
    clearTimeout(timeoutTimer)

    // AbortError: 超时触发
    if (err instanceof Error && err.name === 'AbortError') {
      killed = true

      // Grace period: 给进程 5s 时间响应 SIGTERM
      const graceTimer = setTimeout(() => {
        proc.kill('SIGKILL')
      }, GRACE_MS)

      try {
        await proc.exited
      }
      catch {
        // 进程可能已被 kill
      }
      finally {
        clearTimeout(graceTimer)
      }

      await Promise.all([stdoutCollector, stderrCollector])

      // 写入 stderr 日志以便排查
      let stderrLogPath: string | undefined
      if (opts.outputDir) {
        stderrLogPath = resolve(resolve(opts.outputDir), `ffmpeg_timeout_${Date.now()}.log`)
        await Bun.write(stderrLogPath, stderr)
      }

      throw new FfmpegTimeoutError(
        `FFmpeg ${cmd} 操作超时 (${timeoutMs}ms)，已被强制终止`,
        cmd,
        timeoutMs,
      )
    }

    throw err
  }
}
