import { Copy } from 'lucide-react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'

const BASE_URL = window.location.origin

const MODEL_ALIASES: Array<{ alias: string, internal: string }> = [
  { alias: 'gpt-4', internal: 'qwen-max' },
  { alias: 'gpt-4o', internal: 'qwen-max' },
  { alias: 'gpt-3.5-turbo', internal: 'qwen-turbo' },
  { alias: 'gpt-4o-mini', internal: 'qwen-plus' },
]

const ERROR_CODES: Array<{ code: string, status: number, meaning: string, action: string }> = [
  {
    code: 'model_not_found',
    status: 404,
    meaning: '请求的模型不存在或别名无法解析',
    action: '检查 model 参数,优先使用「支持模型」表中的别名或内部模型名。',
  },
  {
    code: 'invalid_model',
    status: 400,
    meaning: '模型存在但不是文本模型',
    action: '文本生成接口仅支持文本模型,请使用 qwen-max / qwen-plus / qwen-turbo。',
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
    meaning: '账户余额不足,无法预留本次生成费用',
    action: '充值后重试,或更换为有余额的 API Key。',
  },
  {
    code: 'generation_failed',
    status: 500,
    meaning: '上游 provider 调用失败',
    action: '失败已自动退款,可重试一次;连续失败请检查 provider 状态或联系管理员。',
  },
  {
    code: 'stream_not_supported',
    status: 400,
    meaning: '当前接口不支持 streaming',
    action: '关闭 stream 参数,使用非流式响应(所有请求均返回完整结果)。',
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

async function copyCode(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success('已复制')
  }
  catch {
    toast.error('复制失败')
  }
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
              <Button variant="outline" size="sm" onClick={() => copyCode(CURL_EXAMPLE)}>
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
              <Button variant="outline" size="sm" onClick={() => copyCode(JS_EXAMPLE)}>
                <Copy className="size-3" />
                复制
              </Button>
            </div>
            <pre className="rounded-lg bg-muted p-4 text-xs overflow-auto">
              <code>{JS_EXAMPLE}</code>
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
              {MODEL_ALIASES.map(({ alias, internal }) => (
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
          <CardTitle className="text-sm">当前限制</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <ul className="list-disc list-inside space-y-1">
            <li>仅支持文本模型（Chat Completions）。</li>
            <li>暂不支持 streaming（stream 字段无效，所有请求均返回完整响应）。</li>
            <li>图像和视频生成仍通过产品工作台使用。</li>
            <li>用量查询、额度限制、速率限制说明后续补齐。</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
