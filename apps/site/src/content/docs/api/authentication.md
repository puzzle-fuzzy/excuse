---
title: 'API 鉴权'
description: '如何创建 API Key、在请求中携带凭证、以及鉴权失败错误码。'
section: 'api'
order: 2
updatedDate: 2026-06-19
---

本文教你创建 API Key 并完成第一次 API 调用。

## 1. 创建 API Key

在「设置 → API Key」页面创建密钥。Excuse 的 API Key 以 `exc_` 前缀开头，创建时只显示一次完整明文，请妥善保存。

> 服务端只保存密钥的 SHA-256 哈希，无法反查明文。

## 2. 发起请求

在请求头携带 `Authorization`：

```bash
curl https://api.excuse.com/v1/chat/completions \
  -H "Authorization: Bearer exc_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen-plus",
    "messages": [{ "role": "user", "content": "你好" }]
  }'
```

API 网关兼容 OpenAI 协议，因此你可以直接用 OpenAI 官方 SDK，只需替换 `baseURL` 与 `apiKey`。

## 3. 鉴权方式

Excuse 识别两类凭证：

- `exc_` 前缀：识别为 API Key，按哈希查找。
- 其他 Bearer：作为 JWT 校验。

## 4. 错误码

| HTTP | 含义 | 处理 |
| --- | --- | --- |
| 401 | 未授权 / Key 无效 | 检查 Key 是否正确、是否已禁用 |
| 403 | 无权限 | 确认 Key 权限范围 |
| 429 | 限流 | 降低频率或升级套餐 |

## 安全建议

- 不要把 Key 写进前端代码或公开仓库。
- 为不同环境使用不同 Key，便于隔离与禁用。
- 定期轮换，及时禁用泄露的 Key。
