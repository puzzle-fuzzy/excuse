# Billing and Credit Ledger

更新时间：2026-06-16

## 正式扣费路径

当前只有两类入口进入用户余额闭环：

- `workspace.generate`：Workspace 文本、图片、视频生成。
- `openai.gateway.chat`：OpenAI 兼容 Chat Completions，包括 stream 与 non-stream。

这两类入口必须遵循同一状态机：

1. 创建 `generation_records`，写入预估 `cost`。
2. 调用 provider 前 `reserveCredit` 冻结预估金额，并写入 `credit_transactions(type=reserve)` 与 `usage_events.reserveTxId`。
3. 成功后按 provider usage 计算实际金额，`markGenerationSucceeded` 写实际 `cost`，再 `debitCredit` 写 `credit_transactions(type=debit)` 与 `usage_events.debitTxId`。
4. provider 失败、取消或重试前失败时，`refundCredit` 写 `credit_transactions(type=refund)` 与 `usage_events.refundTxId`。

`packages/billing/src/policy.ts` 是计费策略入口。新增正式收费入口前，必须先把 surface 声明为 `credit-ledger`，再在业务入口调用 `assertCreditLedgerPolicy`。

## 暂不扣费路径

- `canvas.pipeline.beta`：Canvas 前置流水线仍按 beta/free quota 处理，不从用户余额扣款。
- `subtitle.asr.beta`：Subtitle ASR 当前只记录 provider 成本用于审计和展示，不生成用户资金流水。

如果未来这些路径改为正式收费，需要先补齐 reserve/debit/refund 策略、usage event 关联、用户文案和端到端测试，再切换 policy。

## 审计要求

- `generationRecordId` 是资金流水和生成结果的主关联键。
- `usage_events` 必须能从一条生成记录追踪到 reserve 与最终 debit/refund。
- 用户侧失败/取消文案必须说明是否扣费或退款。
- Admin 侧排查时，应从任务或生成记录定位到 `credit_transactions` 与 `usage_events`。
