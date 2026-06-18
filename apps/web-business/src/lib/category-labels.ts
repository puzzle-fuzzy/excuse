/**
 * 统一分类标签 — 消除各组件间的命名/值不一致
 *
 * 见 docs/TODO.md §四 CATEGORY_LABELS 命名/值不一致
 */

/** Billing 页面用：展示费用分类（含 audio） */
export const BILLING_CATEGORY_LABELS: Record<string, string> = {
  text: '文本生成',
  image: '图像生成',
  video: '视频生成',
  audio: '音频生成',
  subtitle: '字幕',
}

/** Provider / Admin 页面用：展示模型分类 */
export const TASK_CATEGORY_LABELS: Record<string, string> = {
  text: '文本',
  image: '图片',
  video: '视频',
  audio: '音频',
  subtitle: '字幕',
}
