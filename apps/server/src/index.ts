/**
 * =====================================================
 * Excuse API — 应用入口
 * =====================================================
 *
 * 启动流程：loadConfig() → createServerContext() → createElysiaApp() → bootstrap.start()
 *
 * 所有副作用（provider observer/guard、HTTP listen、SSE、信号处理）
 * 收敛到 `bootstrap.ts`。
 *
 * 如果需要无副作用的 app 实例（测试 / E2E），直接 import `createElysiaApp` from `./app`。
 *
 * 导出的 `App` 类型供客户端 @elysia/eden treaty 做端到端类型推导。
 */

import { createElysiaApp } from './app'
import { bootstrapServer } from './bootstrap'
import { loadConfig } from './config'
import { createServerContext } from './context'

const config = loadConfig()
const ctx = createServerContext(config)
const app = createElysiaApp(config, ctx)

bootstrapServer(config, app).start()

export type App = typeof app
export default app
