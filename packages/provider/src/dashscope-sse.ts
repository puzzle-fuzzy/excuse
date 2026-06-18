import type { DashScopeChatStreamEvent } from './dashscope-types'
import type { StreamTimeoutController } from './http-timeout'
import type { TextStreamChunk } from './types'

/**
 * 流式 SSE 公共迭代器 — 按 `\n\n` 分帧、逐行解析 data: 行。
 *
 * 与 DashScopeClient 解耦的纯异步生成器，可脱离 Client 实例独立单测。
 */

// ── 公共 SSE 帧迭代器 ──────────────────────────────────────

/**
 * 按 `\n\n` 分隔 SSE 帧，逐帧 yield 全部 `data:` 行组成的字符串数组。
 *
 * 结束标记 `data: [DONE]` 自动 yield 并退出。reader 在 finally 中确保释放锁。
 */
export async function* iterSSEEvents(
  body: ReadableStream<Uint8Array>,
  streamTimeout: StreamTimeoutController,
): AsyncGenerator<string[]> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done)
        break
      streamTimeout.schedule()
      buffer += decoder.decode(value, { stream: true })

      let sep = buffer.indexOf('\n\n')
      while (sep >= 0) {
        const rawEvent = buffer.slice(0, sep)
        buffer = buffer.slice(sep + 2)

        const lines = rawEvent.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim())
        if (lines.length > 0) {
          yield lines
          // 遇到 [DONE] 时提前退出
          if (lines.includes('[DONE]'))
            return
        }
        sep = buffer.indexOf('\n\n')
      }
    }
  }
  finally {
    reader.releaseLock()
  }
}

// ── OpenAI 兼容 SSE parser ─────────────────────────────────

/**
 * OpenAI 兼容协议 SSE 解析器 — 解析 `choices[0].delta.content` + `finish_reason`。
 *
 * 复用 `iterSSEEvents()` 帧迭代，仅负责将 data JSON 行映射为 TextStreamChunk。
 * 与 DashScopeClient 解耦，可独立单测。
 */
export async function* parseOpenAIChatSSE(
  body: ReadableStream<Uint8Array>,
  model: string,
  streamTimeout: StreamTimeoutController,
): AsyncGenerator<TextStreamChunk> {
  for await (const lines of iterSSEEvents(body, streamTimeout)) {
    for (const data of lines) {
      if (data === '[DONE]') {
        yield { type: 'text-stream', model, delta: '', done: true }
        return
      }
      try {
        const parsed = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string }, finish_reason?: string | null }>
          usage?: { prompt_tokens?: number, completion_tokens?: number }
        }
        const choice = parsed.choices?.[0]
        const delta = choice?.delta?.content ?? ''
        const finishReason = choice?.finish_reason ?? null
        const parsedUsage = parsed.usage
          ? {
              inputTokens: parsed.usage.prompt_tokens ?? 0,
              outputTokens: parsed.usage.completion_tokens ?? 0,
            }
          : undefined
        yield {
          type: 'text-stream',
          model,
          delta,
          usage: parsedUsage,
          done: finishReason !== null,
        }
      }
      catch {
        // 单行解析失败时跳过，不终止流
      }
    }
  }
}

// ── DashScope chat SSE parser ───────────────────────────────

/**
 * DashScope chat 协议 SSE 解析器 — 解析 `output.text` + `output.finish_reason`（字符串）。
 *
 * 与 OpenAI 兼容协议的差异：
 *   - delta 在 `output.text`，而不是 `choices[0].delta.content`。
 *   - `finish_reason` 是字符串 "null" / "stop" / "length"。
 *   - usage 字段名是 `input_tokens` / `output_tokens`（DashScope 命名）。
 *
 * 流结束：`finish_reason === 'stop' | 'length'`，或收到 `data: [DONE]`。
 */
export async function* parseDashScopeChatSSE(
  body: ReadableStream<Uint8Array>,
  model: string,
  streamTimeout: StreamTimeoutController,
): AsyncGenerator<TextStreamChunk> {
  for await (const lines of iterSSEEvents(body, streamTimeout)) {
    for (const data of lines) {
      if (data === '[DONE]') {
        yield { type: 'text-stream', model, delta: '', done: true }
        return
      }
      try {
        const parsed = JSON.parse(data) as DashScopeChatStreamEvent
        const delta = parsed.output?.text ?? ''
        const finishReason = parsed.output?.finish_reason
        const isDone = finishReason === 'stop' || finishReason === 'length'
        const parsedUsage = parsed.usage
          && (parsed.usage.input_tokens !== undefined || parsed.usage.output_tokens !== undefined)
          ? {
              inputTokens: parsed.usage.input_tokens ?? 0,
              outputTokens: parsed.usage.output_tokens ?? 0,
            }
          : undefined

        yield {
          type: 'text-stream',
          model,
          delta,
          usage: parsedUsage,
          done: isDone,
        }
      }
      catch {
        // 单行解析失败时跳过，不终止流
      }
    }
  }
}
