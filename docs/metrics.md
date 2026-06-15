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

## 线上排障检查

以下检查项使用 `GET /metrics` 的 Prometheus 指标回答部署验收问题。

### 1. 服务是否存活

```bash
curl -s http://localhost:5007/metrics | grep -E '^excuse_uptime_seconds'
# excuse_uptime_seconds 3600  → 进程已运行 3600 秒
```

也可用简化 JSON 接口（开发调试用，无需 Prometheus parser）：

```bash
curl -s http://localhost:5007/api/health/metrics | jq '.uptimeSeconds'
```

### 2. DB 是否可用

如果 DB 连接正常，server 启动日志不报 `DB_CONNECT_FAIL`。

快速验证——通过生成记录指标间接判断（DB 查不到数据时 `excuse_generation_total` 不会增长）：

```bash
# 检查 generation 指标有数据
curl -s http://localhost:5007/metrics | grep '^excuse_generation_total{'
# excuse_generation_total{status="succeeded"} 42
```

更可靠的方式是检查 server `/api/health` 端点（需包含 DB ping 逻辑——如当前未实现，可后续补 `HEAD /api/health/db`）：

```bash
curl -s http://localhost:5007/api/health
```

### 3. Worker 是否工作

Worker 健康检查当前依赖以下间接信号：

```bash
# 检查任务队列中有终态（failed/succeeded）产出——说明 worker 在处理
curl -s http://localhost:5007/metrics | grep '^excuse_task_queue_depth'
# excuse_task_queue_depth{domain="video",status="queued"} 3
# excuse_task_queue_depth{domain="video",status="running"} 1
```

Worker 自身日志：

```bash
# 检查 worker 最近的心跳/轮询日志
grep 'worker-audit\|task-processor' /var/log/excuse/worker.log | tail -20
```

如果 Worker 不工作：队列中的 `queued` / `running` 状态任务会持续堆积，且 `succeeded` / `failed` 不增长。

### 4. 任务是否积压

```bash
# 查看各 domain × status 的任务计数
curl -s http://localhost:5007/metrics | grep '^excuse_task_queue_depth'
# excuse_task_queue_depth{domain="video",status="queued"} 15    ← 积压信号
# excuse_task_queue_depth{domain="video",status="running"} 2
# excuse_task_queue_depth{domain="text",status="queued"} 0
```

- `queued` 持续 > 0 且不下降 → 消费者不足。
- `running` 长期不变化 → worker 可能卡死或崩溃。
- 管理后台（`/admin`）的「任务诊断」区提供可视化队列视图，支持筛选/搜索/重排/取消。

### 5. Provider 是否异常

```bash
# 按模型×状态查看 provider 调用计数
curl -s http://localhost:5007/metrics | grep '^excuse_provider_calls_total'
# excuse_provider_calls_total{model="qwen-max",status="success"} 120
# excuse_provider_calls_total{model="qwen-max",status="failed"} 3
# excuse_provider_calls_total{model="qwen-turbo",status="success"} 80
# excuse_provider_calls_total{model="qwen-turbo",status="failed"} 15   ← 异常

# 查看模型耗时（ms，分位数）
curl -s http://localhost:5007/metrics | grep '^excuse_provider_latency_seconds'
# excuse_provider_latency_seconds{model="qwen-max",quantile="p50"} 2.1
# excuse_provider_latency_seconds{model="qwen-max",quantile="p95"} 8.5
```

异常判断：
- **失败率突增**：单个 model 的 `failed / (success + failed) > 20%` 需关注。
- **p95 延迟翻倍**：对比历史基线，p95 > 3× p50 说明存在长尾。
- **provider 连续失败告警**：系统已内置 3-strike 连续失败检测（`provider-consecutive-failure` 通知类型）。

管理后台（`/admin`）的「Provider」tab 提供表格视图，含失败率百分比 + avg/p50/p95 延迟，支持 time window 切换。

### 6. Canvas 阶段耗时

```bash
# 按 phase × status 查看统计
curl -s http://localhost:5007/metrics | grep '^excuse_canvas_phase_total'
# excuse_canvas_phase_total{phase="analysis",status="succeeded"} 30
# excuse_canvas_phase_total{phase="storyboard",status="failed"} 2

# 各 phase 耗时分位数
curl -s http://localhost:5007/metrics | grep '^excuse_canvas_phase_duration_seconds'
# excuse_canvas_phase_duration_seconds{phase="analysis",quantile="p50"} 5.2
# excuse_canvas_phase_duration_seconds{phase="analysis",quantile="p95"} 15.1
# excuse_canvas_phase_duration_seconds{phase="characters",quantile="p50"} 3.8
```

### 7. HTTP 请求概览

```bash
# 请求总数和延迟
curl -s http://localhost:5007/metrics | grep -E '^(excuse_http_requests_total|excuse_http_latency_seconds)'
# excuse_http_requests_total{status="200"} 1024
# excuse_http_requests_total{status="500"} 3
# excuse_http_latency_seconds{quantile="p50"} 0.05
# excuse_http_latency_seconds{quantile="p99"} 0.42
```

### 快速一键检查

```bash
# 一键检查五项核心指标
curl -s http://localhost:5007/metrics | grep -E '^(excuse_uptime_seconds|excuse_task_queue_depth|excuse_provider_calls_total|excuse_generation_total|excuse_errors_total)' | sort
```

### 已知局限

- Provider 指标目前仅聚合 server 进程内的调用数据；worker 发起的 provider 调用（视频生成等异步路径）不进入 `excuse_provider_calls_total`。跨进程聚合待 Prometheus federation 或 metrics push 机制引入后补齐。
- DB derived 指标（`excuse_canvas_phase_total` / `excuse_task_queue_depth`）的时效性取决于指标 scrape 间隔；默认 24 小时窗口。
