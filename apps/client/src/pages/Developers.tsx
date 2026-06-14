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
