/**
 * FFmpeg 字幕烧录 — 将 ASS 格式字幕嵌入视频
 *
 * 用 spawnFfmpeg 统一超时保护调用 ffmpeg 命令行工具，
 * 将 ASS 字幕文件烧录（hardsub）到视频中。
 *
 * 前置条件：ffmpeg 必须编译时包含 libass（提供 ass 滤镜）。
 * macOS 开发环境需安装 ffmpeg-full（brew install ffmpeg-full）。
 * Docker 环境需 apt-get install ffmpeg（Debian/Ubuntu 的 ffmpeg 包含 libass）。
 *
 * 所有本地路径转为绝对路径，避免 FFmpeg 解析相对路径出错。
 */

import { resolve } from 'node:path'
import { spawnFfmpeg } from './ffmpeg-spawn'

export interface BurnResult {
  /** 输出视频文件路径 */
  outputPath: string
  /** 输出文件大小（字节） */
  fileSize: number
}

/**
 * 将 ASS 字幕烧录到视频中
 *
 * @param videoPath - 输入视频文件路径（本地绝对路径或 URL）
 * @param assContent - ASS 格式字幕内容字符串
 * @param outputDir - 输出目录（必须为绝对路径或可 resolve 为绝对路径）
 */
export async function burnSubtitlesToVideo(
  videoPath: string,
  assContent: string,
  outputDir?: string,
): Promise<BurnResult> {
  const dir = outputDir
    ? resolve(outputDir)
    : resolve(videoPath.substring(0, videoPath.lastIndexOf('/')))

  // 1. 写入临时 ASS 文件
  const assPath = resolve(`${dir}/subtitle_${Date.now()}.ass`)
  await Bun.write(assPath, assContent)

  // 2. FFmpeg 烧录字幕
  const outputPath = resolve(`${dir}/output_${Date.now()}.mp4`)

  const result = await spawnFfmpeg('ffmpeg', [
    '-i',
    videoPath,
    '-vf',
    `ass=${assPath}`,
    '-c:a',
    'copy',
    '-y',
    outputPath,
  ], { outputDir: dir })

  if (result.exitCode !== 0) {
    try {
      await Bun.file(assPath).delete()
    }
    catch {}
    throw new Error(`FFmpeg 字幕烧录失败 (exit=${result.exitCode}): ${result.stderr.slice(-2000)}`)
  }

  // 3. 获取输出文件大小
  const file = Bun.file(outputPath)
  const fileSize = file.size

  // 4. 清理临时 ASS 文件
  try {
    await Bun.file(assPath).delete()
  }
  catch {}

  return { outputPath, fileSize }
}
