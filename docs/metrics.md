# Prometheus Metrics 接入

`GET /metrics` 暴露 Prometheus text exposition（v0.0.4）格式的进程指标。

## 默认访问策略

- 仅允许回环地址（`127.0.0.0/8` + `::1`）访问。
- 配置 `METRICS_ACCESS_TOKEN` 后，所有请求必须通过 `Authorization: Bearer <token>` 鉴权（IP 白名单通过的也需带 token）。
- IP CIDR 列表可通过 `METRICS_ALLOWED_CIDRS` 覆盖（逗号分隔，默认 `127.0.0.1/32,::1/128`）。

生产环境建议在反向代理层做 IP 白名单 + token 鉴权双重保护。

## Prometheus scrape config 示例

```yaml
scrape_configs:
  - job_name: excuse
    static_configs:
      - targets: ['localhost:5007']
    scheme: http
    bearer_token: <METRICS_ACCESS_TOKEN>   # 仅在配置 token 时需要
```

## 暴露的指标

所有指标统一加 `excuse_` 前缀：

- `excuse_http_requests_total{status}` — HTTP 请求总数（带裸 total 样本 + 按状态码分桶样本）
- `excuse_http_latency_seconds{quantile}` — HTTP 请求延迟（p50 / p95 / p99 / avg；ms→s）
- `excuse_sse_online_users` — SSE 在线用户数
- `excuse_generation_total{status}` — 生成任务计数（按状态分桶）
- `excuse_errors_total` — 错误总数（显式 `recordError()` + HTTP 5xx）
- `excuse_uptime_seconds` — 进程运行时长（秒）

JSON 格式指标仍保留在 `GET /api/health/metrics`（开发调试用，不暴露 Prometheus 字段）。

## 已知限制（v1）

- 仅暴露 server 进程内 `MetricsCollector` 的指标；worker 异步任务终态不聚合（架构边界，非缺陷）。
- CIDR 解析为简化实现，仅支持：
  - `127.0.0.0/8`（IPv4 回环段）
  - `::1` 或 `::1/128`（IPv6 回环精确匹配）
  - 完整 IPv4 / IPv6 字符串等值（含可选 `/32`、`/128` 后缀）
- 不支持的形态：任意非 `/8`/`/32` 的 IPv4 段（如 `10.0.0.0/24`）、任意非 `/128` 的 IPv6 段。需要复杂 CIDR 时建议反向代理层处理。
- 不含 provider 错误率、模型耗时、任务队列积压、Canvas 阶段耗时等业务级指标，留待后续在调用方补 `record*` 钩子。
