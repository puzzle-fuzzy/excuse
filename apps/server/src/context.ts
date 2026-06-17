/**
 * ServerContext — server 进程内共享的 provider / storage 单例
 *
 * 设计目标（见 docs/TODO.md §一、1-任务 2）：
 *   - `DashScopeClient` / `AssetStorage` / `ASRClient` 在工厂闭包内构造一次，
 *     注入到各 route，消除 generate.ts / openai-gateway.ts / subtitle.ts / canvas 各模块
 *     各自 `new` 的散点。
 *   - route / module 不再凭 `ServerConfig` 就地构造，而是通过参数接收共享实例。
 *   - `createServerContext(config, overrides)` 的 overrides 为「三、1 E2E 冒烟测试」
 *     挂载 fake provider 预留的注入口。
 */

import type { ASRClient, AssetStorage, DashScopeClient } from '@excuse/provider'
import type { ServerConfig } from './config'
import { ASRClient as ASRClientImpl, AssetStorage as AssetStorageImpl, DashScopeClient as DashScopeClientImpl } from '@excuse/provider'

export interface ServerContext {
  /** server 配置 */
  config: ServerConfig
  /** 共享 DashScope client（文本 / 图像 / 视频提交） */
  client: DashScopeClient
  /** 共享资产存储（OSS / 本地） */
  storage: AssetStorage
  /** 共享 ASR client（字幕转写） */
  asrClient: ASRClient
}

/**
 * 构造 server 进程级共享 context
 *
 * 生产环境只调用一次（`index.ts` 启动时）；测试 / E2E 可经 `overrides`
 * 注入 fake client / storage / asrClient，避免触碰真实 DashScope。
 */
export function createServerContext(
  config: ServerConfig,
  overrides?: Partial<Omit<ServerContext, 'config'>>,
): ServerContext {
  return {
    config,
    client: overrides?.client ?? new DashScopeClientImpl({
      apiKey: config.dashscopeApiKey,
      baseUrl: config.dashscopeBaseUrl,
    }),
    storage: overrides?.storage ?? new AssetStorageImpl({
      storageRoot: config.storageRoot,
      oss: config.oss,
    }),
    asrClient: overrides?.asrClient ?? new ASRClientImpl({
      apiKey: config.dashscopeApiKey,
      baseUrl: config.dashscopeBaseUrl,
    }),
  }
}
