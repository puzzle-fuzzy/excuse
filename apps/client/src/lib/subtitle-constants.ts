import { statusTextClass } from './status-tokens'

/** 字幕项目状态中文标签 */
export const SUBTITLE_STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  extracting_audio: '提取音频中',
  asr_processing: 'ASR 识别中',
  subtitle_editing: '字幕编辑',
  exporting: '导出中',
  completed: '已完成',
  failed: '失败',
}

/** 字幕项目状态颜色 */
export const SUBTITLE_STATUS_COLORS: Record<string, string> = {
  draft: 'text-muted-foreground',
  extracting_audio: statusTextClass('info'),
  asr_processing: statusTextClass('info'),
  subtitle_editing: statusTextClass('success'),
  exporting: statusTextClass('warning'),
  completed: statusTextClass('success'),
  failed: 'text-destructive',
}
