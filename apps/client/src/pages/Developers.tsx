import { MODEL_ALIASES } from '@excuse/shared'
import { useQuery } from '@tanstack/react-query'
import { Copy, RefreshCw } from 'lucide-react'
import { Link } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { fetchGatewayUsage } from '@/api/client'
import { formatCents } from '@/lib/generation-utils'
import { copyToClipboard } from '@/lib/utils'

const BASE_URL = window.location.origin

const MODEL_ALIAS_LIST = Object.entries(MODEL_ALIASES).map(([alias, internal]) => ({ alias, internal }))

/** 文本模型定价（分/百万 Token），与 packages/provider/src/model-configs.ts 保持同步 */
const TEXT_MODEL_PRICING: Array<{ model: string, name: string, inputCents: number, outputCents: number }> = [
  { model: 'qwen-max', name: '千问 Max', inputCents: 240, outputCents: 960 },
  { model: 'qwen-plus', name: '千问 Plus', inputCents: 80, outputCents: 200 },
  { model: 'qwen-turbo', name: '千问 Turbo', inputCents: 30, outputCents: 60 },
  { model: 'qwen-long', name: '千问 Long', inputCents: 50, outputCents: 200 },
]

const ERROR_CODES: Array<{ code: string, status: number, meaning: string, action: string }> = [
  {
    code: 'model_not_found',
    status: 404,
    meaning: '请求的模型不存在或别名无法解析',
    action: '检查 model 参数，优先使用「支持模型」表中的别名或内部模型名。',
  },
  {
    code: 'invalid_model',
    status: 400,
    meaning: '模型存在但不是文本模型',
    action: '文本生成接口仅支持文本模型，请使用 qwen-max / qwen-plus / qwen-turbo。',
  },
  {
    code: 'invalid_parameters',
    status: 400,
    meaning: '模型参数不符合配置范围',
    action: '按 message 提示调整 temperature / max_tokens / top_p 等参数。',
  },
  {
    code: 'insufficient_balance',
    status: 402,
    meaning: '账户余额不足，无法预留本次生成费用',
    action: '充值后重试，或更换为有余额的 API Key。',
  },
  {
    code: 'generation_failed',
    status: 500,
    meaning: '上游 provider 调用失败',
    action: '失败已自动退款，可重试一次；连续失败请检查 provider 状态或联系管理员。',
  },
  {
    code: 'stream_not_supported',
    status: 400,
    meaning: '当前模型不支持 streaming',
    action: '部分旧模型不支持 stream；文本模型（qwen-max / qwen-plus / qwen-turbo / qwen-long）均支持。',
  },
  {
    code: 'missing_user_message',
    status: 400,
    meaning: 'messages 中没有 role=user 的消息',
    action: '在 messages 数组中至少添加一条 user 消息。',
  },
]

const ERROR_RESPONSE_EXAMPLE = `{
  "error": {
    "message": "Model 'xxx' not found",
    "type": "invalid_request_error",
    "code": "model_not_found"
  }
}`

const CURL_EXAMPLE = `curl ${BASE_URL}/v1/chat/completions \\
  -H "Authorization: Bearer exc_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      { "role": "user", "content": "Hello!" }
    ]
  }'`

const JS_EXAMPLE = `const res = await fetch("${BASE_URL}/v1/chat/completions", {
  method: "POST",
  headers: {
    "Authorization": "Bearer exc_YOUR_KEY",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: "Hello!" }],
  }),
});

const data = await res.json();
console.log(data.choices[0].message.content);`

const PYTHON_EXAMPLE = `import openai

client = openai.OpenAI(
    base_url="${BASE_URL}/v1",
    api_key="exc_YOUR_KEY",
)

response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Hello!"}],
)

print(response.choices[0].message.content)`

const CURL_STREAM_EXAMPLE = `curl ${BASE_URL}/v1/chat/completions \\
  -H "Authorization: Bearer exc_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-4o-mini",
    "stream": true,
    "messages": [
      { "role": "user", "content": "Hello!" }
    ]
  }'`

function UsageSection() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['gateway', 'usage'],
    queryFn: async () => {
      return fetchGatewayUsage()
    },
    refetchInterval: 60_000,
  })

  const usage = data

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">用量概览</CardTitle>
          <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`size-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-muted-foreground">加载中...</p>}
        {!isLoading && !usage && <p className="text-sm text-muted-foreground">暂无调用记录</p>}
        {!isLoading && usage && (
          <div className="grid grid-cols-4 gap-3 text-sm">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">总调用</p>
              <p className="mt-1 font-mono text-lg">{usage.totalCalls}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">成功</p>
              <p className="mt-1 font-mono text-lg">{usage.succeededCalls}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">失败</p>
              <p className="mt-1 font-mono text-lg text-destructive">{usage.failedCalls}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">总消耗</p>
              <p className="mt-1 font-mono text-lg">{formatCents(usage.totalPriceCents)}</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default function Developers() {
  return (
    <div className="mx-auto max-w-3xl p-4 space-y-6">
      {/* 标题区 */}
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">开发者接入</h1>
        <Badge variant="secondary">内测</Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        使用 API Key 调用 OpenAI 兼容文本生成接口
      </p>

      <Separator />

      {/* 用量概览 */}
      <UsageSection />

      {/* 快速开始 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">快速开始</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <span className="font-medium">1.</span>
            {' '}
            创建 API Key —
            {' '}
            <Link to="/api-keys" className="text-primary underline underline-offset-2">
              前往 API Keys 页面
            </Link>
          </div>
          <div>
            <span className="font-medium">2.</span>
            {' '}
            设置 Base URL：
            {' '}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{BASE_URL}</code>
          </div>
          <div>
            <span className="font-medium">3.</span>
            {' '}
            调用
            {' '}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">POST /v1/chat/completions</code>
          </div>
        </CardContent>
      </Card>

      {/* Endpoint 卡片 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Endpoint</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <span className="font-medium text-muted-foreground">路径</span>
            <code className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">POST /v1/chat/completions</code>
          </div>
          <div>
            <span className="font-medium text-muted-foreground">Base URL</span>
            <code className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">{BASE_URL}</code>
          </div>
          <div>
            <span className="font-medium text-muted-foreground">鉴权</span>
            <code className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">Authorization: Bearer &lt;YOUR_EXC_KEY&gt;</code>
          </div>
        </CardContent>
      </Card>

      {/* 示例代码 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">示例代码</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground">curl</span>
              <Button variant="outline" size="sm" onClick={() => copyToClipboard(CURL_EXAMPLE)}>
                <Copy className="size-3" />
                复制
              </Button>
            </div>
            <pre className="rounded-lg bg-muted p-4 text-xs overflow-auto">
              <code>{CURL_EXAMPLE}</code>
            </pre>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground">JavaScript</span>
              <Button variant="outline" size="sm" onClick={() => copyToClipboard(JS_EXAMPLE)}>
                <Copy className="size-3" />
                复制
              </Button>
            </div>
            <pre className="rounded-lg bg-muted p-4 text-xs overflow-auto">
              <code>{JS_EXAMPLE}</code>
            </pre>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground">Python (openai SDK)</span>
              <Button variant="outline" size="sm" onClick={() => copyToClipboard(PYTHON_EXAMPLE)}>
                <Copy className="size-3" />
                复制
              </Button>
            </div>
            <pre className="rounded-lg bg-muted p-4 text-xs overflow-auto">
              <code>{PYTHON_EXAMPLE}</code>
            </pre>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground">curl — streaming</span>
              <Button variant="outline" size="sm" onClick={() => copyToClipboard(CURL_STREAM_EXAMPLE)}>
                <Copy className="size-3" />
                复制
              </Button>
            </div>
            <pre className="rounded-lg bg-muted p-4 text-xs overflow-auto">
              <code>{CURL_STREAM_EXAMPLE}</code>
            </pre>
          </div>
        </CardContent>
      </Card>

      {/* 支持模型 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">支持模型</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 text-left font-medium text-muted-foreground">OpenAI 别名</th>
                <th className="py-2 text-left font-medium text-muted-foreground">内部模型</th>
              </tr>
            </thead>
            <tbody>
              {MODEL_ALIAS_LIST.map(({ alias, internal }) => (
                <tr key={alias} className="border-b last:border-b-0">
                  <td className="py-2"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">{alias}</code></td>
                  <td className="py-2"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">{internal}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted-foreground">
            也可直接使用内部模型名（如 qwen-max）作为 model 参数。
          </p>
        </CardContent>
      </Card>

      {/* 定价说明 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">文本模型定价</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-muted-foreground">
            按 Token 计费，单位为人民币分（¢）/ 百万 Token。价格与阿里云百炼平台同步。
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 text-left font-medium text-muted-foreground">模型</th>
                <th className="py-2 text-left font-medium text-muted-foreground">名称</th>
                <th className="py-2 text-right font-medium text-muted-foreground">输入价格</th>
                <th className="py-2 text-right font-medium text-muted-foreground">输出价格</th>
              </tr>
            </thead>
            <tbody>
              {TEXT_MODEL_PRICING.map(({ model, name, inputCents, outputCents }) => (
                <tr key={model} className="border-b last:border-b-0">
                  <td className="py-2"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">{model}</code></td>
                  <td className="py-2 text-xs">{name}</td>
                  <td className="py-2 text-right font-mono text-xs">
                    {inputCents}
                    ¢ / M
                  </td>
                  <td className="py-2 text-right font-mono text-xs">
                    {outputCents}
                    ¢ / M
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted-foreground">
            费用 = 输入 Token × 输入单价 + 输出 Token × 输出单价。当前为 beta 阶段，不扣除实际费用。
          </p>
        </CardContent>
      </Card>

      {/* 错误响应 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">错误响应</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-sm">所有错误响应遵循 OpenAI 错误格式：</p>
            <pre className="mt-2 rounded-lg bg-muted p-4 text-xs overflow-auto">
              <code>{ERROR_RESPONSE_EXAMPLE}</code>
            </pre>
            <p className="mt-2 text-xs text-muted-foreground">
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">message</code>
              {' '}
              是人类可读的描述（文案可变），
              <code className="ml-1 rounded bg-muted px-1.5 py-0.5 text-xs">code</code>
              {' '}
              是稳定错误码，适合程序分支判断。
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-2 text-left font-medium text-muted-foreground">错误码</th>
                  <th className="py-2 text-left font-medium text-muted-foreground">HTTP</th>
                  <th className="py-2 text-left font-medium text-muted-foreground">含义</th>
                  <th className="py-2 text-left font-medium text-muted-foreground">处理建议</th>
                </tr>
              </thead>
              <tbody>
                {ERROR_CODES.map(row => (
                  <tr key={row.code} className="border-b last:border-b-0 align-top">
                    <td className="py-2 pr-3 whitespace-nowrap"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">{row.code}</code></td>
                    <td className="py-2 pr-3 text-muted-foreground">{row.status}</td>
                    <td className="py-2 pr-3">{row.meaning}</td>
                    <td className="py-2 text-muted-foreground">{row.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* 当前限制 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">能力与限制</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <ul className="list-disc list-inside space-y-1">
            <li>
              ✅ 支持文本模型
              {' '}
              <Badge variant="outline" className="text-xs">Chat Completions</Badge>
            </li>
            <li>
              ✅ 支持 streaming
              {' '}
              <Badge variant="outline" className="text-xs">stream: true</Badge>
            </li>
            <li>图像和视频生成仍通过产品工作台使用。</li>
            <li>用量查询、额度限制、速率限制说明后续补齐。</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
