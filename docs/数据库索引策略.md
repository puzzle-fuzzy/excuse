# DB 索引策略与查询性能基线

记录 `generation_records` / `canvas_shots` 的 JSONB 诊断/过滤查询索引策略，以及如何复核查询是否命中索引。

## 背景

`generation_records.input_params` 和 `canvas_shots.reference_assets_json` 是 JSONB 列，其 `->>` 文本提取与 `@>` 包含查询进入关键路径：

- 资产中心按 Canvas 项目过滤生成记录
- Gateway `/v1/usage` 按账户 + source 聚合
- 管理后台「失败任务深度诊断」按 workerTaskId / pipelineRunId 精确关联
- 资产删除引用守卫 / retention GC 的 `@>` 包含查询（每次软删/GC retain 扫全表）

migration `0033_jsonb_diagnostic_indexes.sql` 为这些路径补齐索引：

| 索引 | 表 / 列 | 类型 | 覆盖查询 |
|---|---|---|---|
| `idx_gen_records_account_source` | `generation_records (account_id, (input_params->>'source'))` | btree 表达式 | gateway /v1/usage + admin 账户聚合（account + source 联合过滤） |
| `idx_gen_records_input_project` | `generation_records ((input_params->>'projectId'))` | btree 表达式 | 资产中心 Canvas 项目维度 |
| `idx_gen_records_input_worker_task` | `generation_records ((input_params->>'workerTaskId'))` | btree 表达式 | 管理后台任务诊断精确关联 |
| `idx_gen_records_input_pipeline_run` | `generation_records ((input_params->>'pipelineRunId'))` | btree 表达式 | 管理后台任务诊断精确关联 |
| `idx_gen_records_input_gin` | `generation_records (input_params)` | GIN | referenceFileIds `@>` 包含（uploaded_files 用量 / GC retain） |
| `idx_canvas_shots_ref_assets_gin` | `canvas_shots (reference_assets_json jsonb_path_ops)` | GIN | 资产删除引用守卫 `@>` 包含（全表扫描热点） |

### 为什么是这些索引

- **`(account_id, input_params->>'source')` 复合表达式索引**：gateway usage 与 admin 聚合都同时按 `account_id` 和 `source` 过滤，复合索引严格优于单独 `source` 索引。
- **`jsonb_path_ops` GIN**：`reference_assets_json` 的所有查询都是 `@>` 包含，`jsonb_path_ops` 比默认 `jsonb_ops` 更小更快，不支持其他查询类型（本列也不需要）。
- **`requestedModel` 无需索引**：只读进 JS 映射（usage 列表展示），从不进入 SQL `WHERE`。
- **`shotId` 无单独索引**：仅作 SELECT 投影读取，非过滤条件；如未来出现 shot 维度查询再补。

## EXPLAIN 复核方法

> ⚠️ 测试库接近空表时，planner 会正确选择 Seq Scan（小表顺序扫比索引查找更便宜）。**空表看到 Seq Scan 不代表索引无效**——需用 `SET enable_seqscan = off` 强制 planner 走索引来确认索引可用。

### 验证索引可被使用（空表场景）

```sql
SET enable_seqscan = off;

EXPLAIN SELECT 1 FROM generation_records
  WHERE account_id = $1 AND input_params->>'source' = 'gateway' LIMIT 1;
-- → Index Scan using idx_gen_records_account_source

EXPLAIN SELECT 1 FROM generation_records
  WHERE input_params @> '{"referenceFileIds":["<id>"]}'::jsonb LIMIT 1;
-- → Bitmap Index Scan on idx_gen_records_input_gin

EXPLAIN SELECT 1 FROM canvas_shots
  WHERE reference_assets_json @> '[{"assetId":"<id>"}]'::jsonb LIMIT 1;
-- → Bitmap Index Scan on idx_canvas_shots_ref_assets_gin
```

### 真实数据量复核（生产前）

种子化目标数据量（10 万 generation_records / 1 万 assets / 1 万 tasks）后，对核心列表跑 `EXPLAIN ANALYZE`，记录 p95：

```sql
EXPLAIN ANALYZE
SELECT id, model, status, created_at FROM generation_records
WHERE account_id = $1 AND input_params->>'source' = 'gateway'
ORDER BY created_at DESC LIMIT 50;
```

期望：`Index Scan using idx_gen_records_account_source` + `idx_gen_records_account_created`（已有），p95 < 50ms。

## 新增 JSONB 查询的要求

新增对 JSONB 列的 `WHERE` / `ORDER BY` 查询时，必须：

1. 评估是否高频 / 是否进入列表或诊断路径。
2. 高频查询补对应表达式索引（`->>` 等值 → btree 表达式；`@>` 包含 → GIN），并在 migration + schema `index()` 双处声明（drizzle-kit generate 保持同步）。
3. 在本文件或对应 PR 说明索引策略。
