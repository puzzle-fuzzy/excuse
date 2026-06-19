---
title: 'API 总览'
description: 'Excuse 提供兼容 OpenAI 协议的 API 网关、API Key 管理、用量统计与 Webhook。'
section: 'api'
order: 1
updatedDate: 2026-06-19
---

Excuse 面向开发者提供程序化接入能力，适合接入自有系统、批量处理或构建衍生产品。

## 能力

- **API Key**：创建、禁用、权限、过期时间。
- **用量统计**：按天 / 模型 / 接口查看调用量与成本。
- **限流**：免费、付费、企业不同限流等级。
- **Webhook**：任务完成、失败、扣费回调。
- **兼容协议**：OpenAI 兼容网关，可用现有 SDK 直接调用。

## 开始之前

请先阅读 [API 鉴权](/docs/api/authentication)，了解如何创建 API Key 并发起第一次请求。

## 接口范围

- 文本、图片、视频生成。
- 任务查询、重试、取消。
- 用量与计费查询（部分）。

## 注意事项

- 是否支持商用、失败是否扣费、回调重试策略、并发与上传限制、内容安全策略、数据保存周期等，详见各接口文档与[商用说明](/docs/legal/commercial-use)。
