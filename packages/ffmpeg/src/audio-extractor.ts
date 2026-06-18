/**
 * FFmpeg 音频提取 — 从视频文件中提取音频轨道
 *
 * 用 spawnFfmpeg 统一超时保护调用 ffmpeg 命令行工具，
 * 提取音频为 WAV 格式（Paraformer 要求的输入格式）。
 *
 * 注意：所有本地路径必须为绝对路径，避免 FFmpeg 解析相对路径出错。
 */

import { resolve } from 'node:path'
import { spawnFfmpeg } from './ffmpeg-spawn'

export interface AudioExtractionResult {
  /** 提取的音频文件路径 */
  audioPath: string
  /** 音频时长（毫秒） */
  durationMs: number
}

/**
 * 异步检查 FFmpeg 运行环境
 *
 * 验证 ffmpeg/ffprobe 可执行 + libass 滤镜已编译。
 * 建议在 Worker 和 Server 启动时调用，缺少依赖时打印醒目警告。
 *
 * @returns warnings 数组（空数组表示一切正常）
 */
export async function checkFFmpegAsync(): Promise<string[]> {
  const warnings: string[] = []

  // 1. 检查 ffmpeg
  try {
    const proc = Bun.spawn(['ffmpeg', '-version'], { stdout: 'pipe', stderr: 'pipe' })
    const exitCode = await proc.exited
    if (exitCode !== 0) {
      warnings.push('⚠️  ffmpeg 可执行文件异常 (exit={exitCode})')
    }
  }
  catch {
    warnings.push('⚠️  ffmpeg 未安装或不在 $PATH 中。macOS → brew install ffmpeg-full；Linux → apt-get install ffmpeg')
    return warnings // 没有 ffmpeg 就不需要检查滤镜了
  }

  // 2. 检查 ffprobe
  try {
    const proc = Bun.spawn(['ffprobe', '-version'], { stdout: 'pipe', stderr: 'pipe' })
    const exitCode = await proc.exited
    if (exitCode !== 0) {
      warnings.push('⚠️  ffprobe 可执行文件异常')
    }
  }
  catch {
    warnings.push('⚠️  ffprobe 未安装或不在 $PATH 中')
  }

  // 3. 检查 libass (ass 滤镜)
  const proc = Bun.spawn(['ffmpeg', '-filters'], { stdout: 'pipe', stderr: 'pipe' })
  const exitCode = await proc.exited
  if (exitCode === 0) {
    const stdout = await new Response(proc.stdout).text()
    const hasAss = stdout.includes('ass') && stdout.includes('libass')
    const hasSubtitles = /subtitles/.test(stdout)
    if (!hasAss && !hasSubtitles) {
      warnings.push(
        '⚠️  FFmpeg 缺少 libass 支持（ass/subtitles 滤镜不可用），字幕烧录功能无法使用！\n'
        + '   macOS: brew unlink ffmpeg && brew install ffmpeg-full && brew link ffmpeg-full --force\n'
        + '   Linux: apt-get install ffmpeg (默认含 libass)\n'
        + '   Docker: 确保 Dockerfile 安装 ffmpeg',
      )
    }
  }

  return warnings
}

/**
 * 从视频文件中提取音频轨道
 *
 * 默认提取为 WAV 格式（16kHz 单声道，Paraformer 推荐输入格式）。
 * FFmpeg 命令：ffmpeg -i <video> -vn -acodec pcm_s16le -ar 16000 -ac 1 <output>
 *
 * @param videoPath - 输入视频文件路径（本地路径或 URL）
 * @param outputDir - 音频输出目录（必须为绝对路径或可 resolve 为绝对路径）
 * @returns 音频文件路径和时长信息
 */
export async function extractAudioFromVideo(
  videoPath: string,
  outputDir?: string,
): Promise<AudioExtractionResult> {
  const dir = outputDir
    ? resolve(outputDir)
    : resolve(videoPath.substring(0, videoPath.lastIndexOf('/')))
  const audioPath = resolve(`${dir}/audio_${Date.now()}.wav`)

  // 提取音频：-vn（去除视频）, -acodec pcm_s16le（WAV格式）, -ar 16000（16kHz）, -ac 1（单声道）
  const result = await spawnFfmpeg('ffmpeg', [
    '-i',
    videoPath,
    '-vn',
    '-acodec',
    'pcm_s16le',
    '-ar',
    '16000',
    '-ac',
    '1',
    '-y', // 覆盖已存在的输出文件
    audioPath,
  ], { outputDir: dir })

  if (result.exitCode !== 0) {
    throw new Error(`FFmpeg 音频提取失败 (exit=${result.exitCode}): ${result.stderr.slice(0, 500)}`)
  }

  // 获取音频时长 — ffprobe
  const durationMs = await getMediaDurationMs(audioPath)

  return { audioPath, durationMs }
}

/**
 * 用 ffprobe 获取媒体文件时长（毫秒）
 */
export async function getMediaDurationMs(filePath: string): Promise<number> {
  const result = await spawnFfmpeg('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    filePath,
  ])

  if (result.exitCode !== 0) {
    // ffprobe 失败时返回 0（时长未知），不阻止后续流程
    return 0
  }

  const seconds = Number.parseFloat(result.stdout.trim())
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0
}

/**
 * 用 ffprobe 获取视频分辨率
 */
export async function getVideoResolution(filePath: string): Promise<{ width: number, height: number } | null> {
  const result = await spawnFfmpeg('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height',
    '-of',
    'csv=s=x:p=0',
    filePath,
  ])

  if (result.exitCode !== 0)
    return null

  const parts = result.stdout.trim().split('x')
  if (parts.length !== 2)
    return null

  const width = Number.parseInt(parts[0]!, 10)
  const height = Number.parseInt(parts[1]!, 10)
  return Number.isFinite(width) && Number.isFinite(height) ? { width, height } : null
}
