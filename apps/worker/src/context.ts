/**
 * WorkerContext — worker 进程内共享的 provider / storage 单例
 *
 * 设计目标（见 docs/TODO.md §一、1）：
 *   - `DashScopeClient` / `AssetStorage` / `ASRClient` 在工厂闭包内构造一次，
 *     注入到各 handler，消除 task-processor / canvas-execution / canvas-*-refs /
 *     media-handlers 各自 `new` 的散点。
 *   - handler 不再凭 `WorkerConfig` 就地构造，而是通过参数接收共享实例。
 *   - `createWorkerContext(config, overrides)` 的 overrides 为三、1 E2E 冒烟测试
 *     挂载 fake provider 预留的注入口。
 */

import type { WorkerConfig } from './config'
import { ASRClient, DashScopeClient } from '@excuse/provider'
import { AssetStorage } from '@excuse/storage'

export interface WorkerContext {
  /** worker 配置（轮询参数、存储根目录、metrics 等） */
  config: WorkerConfig
  /** 共享 DashScope client（文本 / 图像 / 视频提交） */
  client: DashScopeClient
  /** 共享资产存储（OSS / 本地） */
  storage: AssetStorage
  /** 共享 ASR client（字幕转写） */
  asrClient: ASRClient
}

/**
 * 构造 worker 进程级共享 context
 *
 * 生产环境只调用一次（`index.ts` 启动时）；测试 / E2E 可经 `overrides`
 * 注入 fake client / storage / asrClient，避免触碰真实 DashScope。
 */
export function createWorkerContext(
  config: WorkerConfig,
  overrides?: Partial<Omit<WorkerContext, 'config'>>,
): WorkerContext {
  return {
    config,
    client: overrides?.client ?? new DashScopeClient({
      apiKey: config.dashscopeApiKey,
      baseUrl: config.dashscopeBaseUrl,
      httpTimeoutMs: config.providerHttpTimeoutMs,
      streamIdleTimeoutMs: config.providerStreamIdleTimeoutMs,
    }),
    storage: overrides?.storage ?? new AssetStorage({
      storageRoot: config.storageRoot,
      oss: config.oss,
    }),
    asrClient: overrides?.asrClient ?? new ASRClient({
      apiKey: config.dashscopeApiKey,
      baseUrl: config.dashscopeBaseUrl,
      httpTimeoutMs: config.providerHttpTimeoutMs,
    }),
  }
}
