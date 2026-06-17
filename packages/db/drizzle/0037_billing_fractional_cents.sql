-- 计费列由 integer 改为 numeric(20,4)，支持文本（按 token）与音频（按秒）的 sub-cent 定价
-- 既有的「integer 计费列 vs sub-cent 定价」设计冲突：calculateCost 对文本/音频产出小数分
-- （如 qwen-max 1000/500 token → 0.72 分），落库到 integer 列会抛 22P02 invalid input syntax。
-- 见 docs/TODO.md §四（已解决）/ CHANGELOG
--
-- integer → numeric 为无损上转：无需 USING 子句，既有数据（整数分）原样保留为 4 位小数。
-- 精度 4 对齐 currency.js（billing 用 precision 4 运算），值域 numeric(20,4) 远超业务上限。
-- 读取侧经 packages/db/src/db.ts 的 numeric(1700)→Number type parser，分值全程按 number 流转。

ALTER TABLE "generation_records" ALTER COLUMN "total_price_cents" TYPE numeric(20, 4);
ALTER TABLE "canvas_assets" ALTER COLUMN "total_price_cents" TYPE numeric(20, 4);
ALTER TABLE "credit_accounts" ALTER COLUMN "available_cents" TYPE numeric(20, 4);
ALTER TABLE "credit_accounts" ALTER COLUMN "frozen_cents" TYPE numeric(20, 4);
ALTER TABLE "credit_transactions" ALTER COLUMN "amount_cents" TYPE numeric(20, 4);
ALTER TABLE "credit_transactions" ALTER COLUMN "balance_after_cents" TYPE numeric(20, 4);
ALTER TABLE "credit_transactions" ALTER COLUMN "frozen_after_cents" TYPE numeric(20, 4);
ALTER TABLE "usage_events" ALTER COLUMN "reserved_cents" TYPE numeric(20, 4);
ALTER TABLE "usage_events" ALTER COLUMN "debited_cents" TYPE numeric(20, 4);
ALTER TABLE "api_keys" ALTER COLUMN "quota_max_cents" TYPE numeric(20, 4);
ALTER TABLE "api_keys" ALTER COLUMN "total_spend_cents" TYPE numeric(20, 4);
