/**
 * FFmpeg 视频合成 — Phase 11 assemble
 *
 * 拼接多个镜头视频 + BGM 叠加。用 spawnFfmpeg 统一超时保护（避免坏文件卡死 worker）。
 * 所有路径转为绝对路径，临时文件由调用方清理。
 */

import { resolve } from 'node:path'
import { spawnFfmpeg } from './ffmpeg-spawn'

export interface ConcatResult {
  outputPath: string
  fileSize: number
}

export interface MixBgmResult {
  outputPath: string
  fileSize: number
}

/**
 * 用 ffprobe 判断媒体文件是否含音频流。
 *
 * assemble 的 BGM 叠加据此分支：有声轨则 amix（保留对话原声），
 * 无声轨则把 BGM 作为唯一音轨 mux 进视频。
 */
export async function hasAudioStream(filePath: string): Promise<boolean> {
  const result = await spawnFfmpeg('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'a',
    '-show_entries',
    'stream=index',
    '-of',
    'csv=p=0',
    filePath,
  ])

  if (result.exitCode !== 0)
    return false
  return result.stdout.trim().length > 0
}

/**
 * 按顺序拼接多个视频为一个（concat demuxer + 重编码）。
 *
 * 用 -f concat -safe 0 demuxer + list 文件。HappyHorse 同项目镜头一般同 ratio/编码，
 * 但重编码（libx264 + aac）兜底防止 -c copy 在参数不一致时静默丢帧或失败。
 *
 * @param videoPaths 本地绝对路径数组（≥1）
 * @param outputDir 输出目录（绝对路径）
 */
export async function concatVideos(videoPaths: string[], outputDir: string): Promise<ConcatResult> {
  if (videoPaths.length === 0)
    throw new Error('concatVideos: 至少需要一个视频')
  if (videoPaths.length === 1) {
    // 单视频：无需拼接，直接返回原路径（ffmpeg 仍会复制一份以统一容器）
    return concatSingle(videoPaths[0]!, outputDir)
  }

  const dir = resolve(outputDir)
  const listPath = resolve(`${dir}/concat_list_${Date.now()}.txt`)
  // concat demuxer list：file '<path>'，单引号内的单引号转义为 '\''
  const listContent = videoPaths.map(p => `file '${p.replace(/'/g, '\'\\\'\'')}'`).join('\n')
  await Bun.write(listPath, listContent)

  const outputPath = resolve(`${dir}/concat_${Date.now()}.mp4`)
  const result = await spawnFfmpeg('ffmpeg', [
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listPath,
    '-c:v',
    'libx264',
    '-c:a',
    'aac',
    '-y',
    outputPath,
  ], { outputDir: dir })

  if (result.exitCode !== 0) {
    try {
      await Bun.file(listPath).delete()
    }
    catch {}
    throw new Error(`FFmpeg 视频拼接失败 (exit=${result.exitCode}): ${result.stderr.slice(-2000)}`)
  }

  try {
    await Bun.file(listPath).delete()
  }
  catch {}

  return { outputPath, fileSize: Bun.file(outputPath).size }
}

/** 单视频「拼接」：重封装为标准 mp4 容器（统一后续 BGM 叠加的输入） */
async function concatSingle(videoPath: string, outputDir: string): Promise<ConcatResult> {
  const outputPath = resolve(resolve(outputDir), `concat_${Date.now()}.mp4`)
  const result = await spawnFfmpeg('ffmpeg', [
    '-i',
    videoPath,
    '-c:v',
    'libx264',
    '-c:a',
    'aac',
    '-y',
    outputPath,
  ], { outputDir })
  if (result.exitCode !== 0) {
    throw new Error(`FFmpeg 视频重封装失败 (exit=${result.exitCode}): ${result.stderr.slice(-2000)}`)
  }
  return { outputPath, fileSize: Bun.file(outputPath).size }
}

/**
 * 把 BGM 叠加到视频音轨之下。
 *
 * - 视频含音频（HappyHorse 原生对话音频）：BGM loop 后以 bgmVolume 与原声 amix，保留对话。
 * - 视频无音频：BGM loop 后作为唯一音轨 mux 进视频。
 * - BGM 短于视频时用 -stream_loop -1 循环铺满；输出时长跟随视频（-shortest）。
 *
 * @param videoPath 拼接后的视频（本地绝对路径）
 * @param bgmPath BGM 音频（本地绝对路径）
 * @param outputDir 输出目录（绝对路径）
 * @param bgmVolume BGM 音量 0~1（默认 0.25，低于对话原声）
 */
export async function mixBgmTrack(videoPath: string, bgmPath: string, outputDir: string, bgmVolume = 0.25): Promise<MixBgmResult> {
  const outputPath = resolve(resolve(outputDir), `final_${Date.now()}.mp4`)
  const videoHasAudio = await hasAudioStream(videoPath)

  let args: string[]
  if (videoHasAudio) {
    // -i video -stream_loop -1 -i bgm → amix（原声 + 降音量 BGM）
    args = [
      'ffmpeg',
      '-i',
      videoPath,
      '-stream_loop',
      '-1',
      '-i',
      bgmPath,
      '-filter_complex',
      `[1:a]volume=${bgmVolume}[bg];[0:a][bg]amix=inputs=2:duration=first:dropout_transition=0[a]`,
      '-map',
      '0:v',
      '-map',
      '[a]',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-shortest',
      '-y',
      outputPath,
    ]
  }
  else {
    // 视频无声轨：BGM 作为唯一音轨（loop 铺满视频时长）
    args = [
      'ffmpeg',
      '-stream_loop',
      '-1',
      '-i',
      bgmPath,
      '-i',
      videoPath,
      '-map',
      '1:v',
      '-map',
      '0:a',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-shortest',
      '-y',
      outputPath,
    ]
  }

  const result = await spawnFfmpeg('ffmpeg', args.slice(1), { outputDir })
  if (result.exitCode !== 0) {
    throw new Error(`FFmpeg BGM 叠加失败 (exit=${result.exitCode}): ${result.stderr.slice(-2000)}`)
  }
  return { outputPath, fileSize: Bun.file(outputPath).size }
}
