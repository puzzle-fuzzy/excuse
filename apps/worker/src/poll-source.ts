/**
 * Worker 轮询源类型 — 每个源负责一个轮询维度
 *
 * 主循环只遍历 `PollSource[]`，不再硬编码三段式轮询。
 */
export interface PollSource {
  /** 源名称（用于日志标识） */
  name: string
  /** 执行一次轮询，返回处理的任务数（0 表示无任务） */
  poll: () => Promise<number>
}
