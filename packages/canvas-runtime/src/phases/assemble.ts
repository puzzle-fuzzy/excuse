/**
 * 合成阶段 — Phase 11
 *
 * 输入：项目已完成镜头视频（含 HappyHorse 原生对话音频）+ 可选 BGM
 * 输出：拼接后的最终视频 URL（写入 canvas_projects.final_video_url）
 *
 * 流程：物化镜头视频到本地 → FFmpeg concat 拼接（保留对话音频）→ 可选 BGM 叠加 → 上传最终视频。
 * HappyHorse 视频原生含对话/音效音频，故「对话音频合成」= 拼接时保留各镜头音轨，无需独立 TTS。
 */

import type { CanvasRuntimeFfmpegAdapter, CanvasRuntimeStorageAdapter } from '../adapter-types'
import type { CanvasProjectDetail } from '../normalize'

export interface AssemblePhaseInput {
  projectId: string
  detail: CanvasProjectDetail
  storage: CanvasRuntimeStorageAdapter
  ffmpeg: CanvasRuntimeFfmpegAdapter
  /** 存储根目录，用于建立临时工作目录（绝对路径） */
  storageRoot: string
  /** 中途所有权检查点 — 由 worker 注入，长任务在子操作间调用；null 则跳过 */
  onCheckpoint?: () => void
}

export interface AssemblePhaseResult {
  /** 最终视频 URL（OSS / 本地，长期有效） */
  finalVideoUrl: string
  /** 参与拼接的镜头数 */
  shotsConcatenated: number
  /** 是否叠加了 BGM */
  bgmOverlaid: boolean
}

export async function runAssemblePhase(input: AssemblePhaseInput): Promise<AssemblePhaseResult> {
  // 1. 收集已完成镜头视频，按 shotIndex 排序
  const shotsWithVideo = input.detail.shots
    .filter(shot => Boolean(shot.videoUrl))
    .sort((a, b) => a.shotIndex - b.shotIndex)

  if (shotsWithVideo.length === 0) {
    throw new Error('合成失败：项目没有任何已完成的镜头视频')
  }

  const tempDir = `${input.storageRoot}/.tmp/assemble_${input.projectId}`

  try {
    // 2. 物化每个镜头视频到本地（优先用 storageRoot 本地副本，缺失则下载到临时目录）
    const localPaths: string[] = []
    for (let i = 0; i < shotsWithVideo.length; i++) {
      const shot = shotsWithVideo[i]!
      const url = shot.videoUrl!
      const local = input.storage.localCopyPath(url)
      const path = local !== null && await pathExists(local)
        ? local
        : await input.storage.downloadToFile(url, `${tempDir}/shot_${i}.mp4`)
      localPaths.push(path)
    }

    // 3. 拼接（重编码兜底，保留各镜头对话音频）
    input.onCheckpoint?.() // ← checkpoint: 物化完成，准备 FFmpeg concat
    const concat = await input.ffmpeg.concatVideos(localPaths, tempDir)
    let finalPath = concat.outputPath
    let bgmOverlaid = false

    // 4. 可选 BGM 叠加（在对话原声之下混入降音量 BGM）
    input.onCheckpoint?.() // ← checkpoint: concat 完成，准备 FFmpeg BGM overlay
    const bgmUrl = input.detail.project.bgmUrl
    if (bgmUrl) {
      const bgmLocal = input.storage.localCopyPath(bgmUrl)
      const bgmPath = bgmLocal !== null && await pathExists(bgmLocal)
        ? bgmLocal
        : await input.storage.downloadToFile(bgmUrl, `${tempDir}/bgm.${extFromUrl(bgmUrl) || 'mp3'}`)
      const mixed = await input.ffmpeg.mixBgmTrack(concat.outputPath, bgmPath, tempDir)
      finalPath = mixed.outputPath
      bgmOverlaid = true
    }

    // 5. 上传最终视频到存储
    const buffer = Buffer.from(await Bun.file(finalPath).arrayBuffer())
    const finalVideoUrl = await input.storage.uploadGenerated(
      buffer,
      `assemble/${input.projectId}/final.mp4`,
      'video/mp4',
    )

    return {
      finalVideoUrl,
      shotsConcatenated: shotsWithVideo.length,
      bgmOverlaid,
    }
  }
  finally {
    // 6. 清理临时工作目录（不影响 storageRoot 下的原始资产）
    await cleanupDir(tempDir)
  }
}

/** 判断本地文件是否存在（Bun.file.exists 对文件返回 true，不存在返回 false，不抛错） */
async function pathExists(p: string): Promise<boolean> {
  try {
    return await Bun.file(p).exists()
  }
  catch {
    return false
  }
}

/** 从 URL 取扩展名（无点号） */
function extFromUrl(url: string): string | null {
  const m = url.split('?')[0]!.match(/\.([a-z0-9]+)$/i)
  return m ? m[1]!.toLowerCase() : null
}

/** 递归清理临时目录（best-effort，失败不阻塞） */
async function cleanupDir(dir: string): Promise<void> {
  try {
    const { rm } = await import('node:fs/promises')
    await rm(dir, { recursive: true, force: true })
  }
  catch {
    // 临时目录清理失败不影响主流程
  }
}
