# Prometheus Metrics 接入

`GET /metrics` 暴露 Prometheus text exposition（v0.0.4）格式的进程指标。

## 默认访问策略

- 仅允许回环地址（`127.0.0.0/8` + `::1`）访问。
- 配置 `METRICS_ACCESS_TOKEN` 后，所有请求必须通过 `Authorization: Bearer <token>` 鉴权（IP 白名单通过的也需带 token）。
- IP CIDR 列表可通过 `METRICS_ALLOWED_CIDRS` 覆盖（逗号分隔，默认 `127.0.0.1/32,::1/128`）。

生产环境建议在反向代理层做 IP 白名单 + token 鉴权双重保护。

## Prometheus scrape config 示例

server（5007）和 worker（5100）是独立进程，各自暴露 `/metrics`。Prometheus 抓取两个 target，通过自动附加的 `instance` label 区分；同名 counter（如 `excuse_provider_calls_total`）用 `sum by (model)(...)` 即可跨进程聚合。

```yaml
scrape_configs:
  - job_name: excuse
    scheme: http
    bearer_token: <METRICS_ACCESS_TOKEN>   # 仅在配置 token 时需要
    static_configs:
      - targets: ['localhost:5007']        # server 进程
        labels: { process: 'server' }
      - targets: ['localhost:5100']        # worker 进程（WORKER_HEALTH_PORT）
        labels: { process: 'worker' }
```

> worker 的 `/metrics` 挂在 health server 上（`WORKER_HEALTH_PORT`，默认 5100），访问策略与 server 一致（默认仅回环，配置 `METRICS_ACCESS_TOKEN` 后需 Bearer）。

## 暴露的指标

所有指标统一加 `excuse_` 前缀：

- `excuse_http_requests_total{status}` — HTTP 请求总数（带裸 total 样本 + 按状态码分桶样本）
- `excuse_http_latency_seconds{quantile}` — HTTP 请求延迟（`0.5` / `0.95` / `0.99` / `avg`；ms→s）
- `excuse_sse_online_users` — SSE 在线用户数
- `excuse_generation_total{status}` — 生成任务计数（按状态分桶）
- `excuse_errors_total` — 错误总数（显式 `recordError()` + HTTP 5xx）
- `excuse_uptime_seconds` — 进程运行时长（秒）

JSON 格式指标仍保留在 `GET /api/health/metrics`（开发调试用，不暴露 Prometheus 字段）。

## Worker 进程指标（`GET /metrics` @ :5100）

worker 进程在自己的 health server（`WORKER_HEALTH_PORT`，默认 5100）上暴露 `/metrics`，与 server 同协议、同访问策略。输出两类 family：

- **provider 调用**（与 server 同名，Prometheus 自动按 `instance` 聚合）：
  - `excuse_provider_calls_total{model,status}` — worker 侧 DashScope 调用计数
  - `excuse_provider_latency_seconds{model,quantile}` — worker 侧调用延迟（`0.5` / `0.95` / `avg`）
- **worker 运行时**（仅 worker target 输出）：
  - `excuse_worker_uptime_seconds` — worker 进程运行时长（秒）
  - `excuse_worker_polling` — 是否在轮询主循环（1/0）
  - `excuse_worker_busy` — 是否正在执行任务（1/0）
  - `excuse_worker_tasks_claimed_total` — 累计 claim 任务数（counter）
  - `excuse_worker_tasks_processed_total` — 累计处理完成数（counter）
  - `excuse_worker_orphan_sweeps_total` — 累计 orphan sweep 次数（counter）
  - `excuse_worker_last_poll_ok` — 最近一次轮询是否成功（1/0，首次轮询前为 0）
  - `excuse_worker_last_poll_timestamp_seconds` — 最近一次轮询时间戳（秒；从未轮询为 NaN）。告警：`time() - excuse_worker_last_poll_timestamp_seconds > 300`

worker 侧的 DashScope 调用通过 `registerProviderCallObserver`（启动时注册，覆盖全部 DashScopeClient 实例）接入 worker 本地 `MetricsCollector`，随后经本端点暴露。ASR 字幕调用（`ASRClient.submitTranscription`，model=`paraformer-v2`）同样接入 observer；与 `submitVideoTask` 一致，仅记录提交调用、不计入 `queryTask` 轮询，避免廉价轮询稀释真实 latency。

## Worker provider 快照（`GET /provider-calls` @ :5100）

worker health server 额外暴露 `GET /provider-calls` —— JSON 格式的 provider 调用原始快照（`{ workerId, providerCalls }`，每个 model 含 `success`/`failed` 计数 + `durations` 原始毫秒样本）。访问策略与 `/metrics` 共用（`evaluateMetricsAccess`）。

**用途**：admin 后台「Provider」tab 跨进程 latency 聚合。server 进程 fetch worker `/provider-calls` 后，用 `@excuse/metrics` 的 `mergeProviderCalls` 把两进程的 durations 原始样本拼接（计数相加），再算 avg/p50/p95 —— **必须用原始 durations**，因为已聚合的分位数无法跨进程正确合并。canvas 全链路的 provider 调用发生在 worker，此前 admin tab 只读 server 进程内 latency 对它们恒为 null；聚合后覆盖 server+worker。

配置：server 侧 `WORKER_METRICS_URL`（如 `http://localhost:5100`，默认关闭）；鉴权 token 复用 `METRICS_ACCESS_TOKEN`（server/worker 同一 env）。worker 不可达时 `fetchWorkerProviderCalls` best-effort 返回空 map，admin 降级为仅 server（不报错）。

## 已知限制（v1）

- server 与 worker 是独立进程，各自维护内存态 `MetricsCollector`；跨进程聚合依赖 Prometheus 多 target 抓取（见上方 scrape config），由 `instance` label 区分；admin 后台的即时 latency 聚合则走 worker `/provider-calls` JSON 快照（见上节）。
- CIDR 解析为简化实现，仅支持：
  - `127.0.0.0/8`（IPv4 回环段）
  - `::1` 或 `::1/128`（IPv6 回环精确匹配）
  - 完整 IPv4 / IPv6 字符串等值（含可选 `/32`、`/128` 后缀）
- 不支持的形态：任意非 `/8`/`/32` 的 IPv4 段（如 `10.0.0.0/24`）、任意非 `/128` 的 IPv6 段。需要复杂 CIDR 时建议反向代理层处理。
- DB derived 指标（`excuse_canvas_phase_total` / `excuse_task_queue_depth`）的时效性取决于指标 scrape 间隔；默认统计窗口由 server route 聚合逻辑控制。

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

最直接的方式是抓 worker 自身的 `/metrics`（端口 5100）：

```bash
# worker 进程存活 + 是否在轮询
curl -s http://localhost:5100/metrics | grep -E '^excuse_worker_(uptime_seconds|polling|busy)'
# excuse_worker_uptime_seconds 3600
# excuse_worker_polling 1
# excuse_worker_busy 1

# 最近轮询是否正常（last_poll_ok=1 且时间戳新鲜）
curl -s http://localhost:5100/metrics | grep -E '^excuse_worker_last_poll'
# excuse_worker_last_poll_ok 1
# excuse_worker_last_poll_timestamp_seconds 1781481600
```

`excuse_worker_uptime_seconds` 不增长 → worker 未启动 / 崩溃；`excuse_worker_last_poll_timestamp_seconds` 停滞 → worker 卡死（`time() - timestamp > 300` 可告警）。

补充间接信号（从 server `/metrics` 看队列终态产出）：

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
# excuse_provider_latency_seconds{model="qwen-max",quantile="0.5"} 2.1
# excuse_provider_latency_seconds{model="qwen-max",quantile="0.95"} 8.5
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
# excuse_canvas_phase_duration_seconds{phase="analysis",quantile="0.5"} 5.2
# excuse_canvas_phase_duration_seconds{phase="analysis",quantile="0.95"} 15.1
# excuse_canvas_phase_duration_seconds{phase="characters",quantile="0.5"} 3.8
```

### 7. HTTP 请求概览

```bash
# 请求总数和延迟
curl -s http://localhost:5007/metrics | grep -E '^(excuse_http_requests_total|excuse_http_latency_seconds)'
# excuse_http_requests_total{status="200"} 1024
# excuse_http_requests_total{status="500"} 3
# excuse_http_latency_seconds{quantile="0.5"} 0.05
# excuse_http_latency_seconds{quantile="0.99"} 0.42
```

### 快速一键检查

```bash
# 一键检查五项核心指标
curl -s http://localhost:5007/metrics | grep -E '^(excuse_uptime_seconds|excuse_task_queue_depth|excuse_provider_calls_total|excuse_generation_total|excuse_errors_total)' | sort
```

### 已知局限

- **跨进程聚合**：server 与 worker 各自暴露 `/metrics`（5007 / 5100），Prometheus 抓取两个 target 后由 `instance` label 区分；`sum by (model)(excuse_provider_calls_total)` 等查询自动聚合两进程。worker 的视频/图片/文本生成 provider 调用现已纳入。
- **ASR 统计口径**：`ASRClient.submitTranscription` 已接入 provider observer，model 为 `paraformer-v2`；`queryTask` 轮询不计入 provider latency，避免廉价轮询稀释真实提交耗时。
- **admin 后台 Provider tab**：配置 `WORKER_METRICS_URL` 后会 best-effort 拉取 worker `/provider-calls` 并与 server 进程内样本合并；worker 不可达或未配置时降级为仅 server 进程数据。
- DB derived 指标（`excuse_canvas_phase_total` / `excuse_task_queue_depth`）的时效性取决于指标 scrape 间隔；默认 24 小时窗口。
