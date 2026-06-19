---
title: 'Canvas 故事成片'
description: 'Canvas 12 阶段流水线：阶段顺序、一致性机制、暂停确认门槛与失败恢复。'
section: 'canvas'
order: 1
updatedDate: 2026-06-19
---

Canvas 把「一段故事文本变成一支成片」拆成 12 个阶段，每个阶段是一条独立任务，按顺序自动推进。

## 阶段顺序

```text
analyze → characters → locations → characterRefs → locationRefs → storyboard → continuity → rebuild → dialogue → videos → bgm → assemble
```

## 一致性机制

故事成片最难的是「同一角色跨镜头一致」。Canvas 用专门阶段解决：

- **characters / locations**：抽取角色与场景。
- **characterRefs / locationRefs**：生成稳定的参考图，后续镜头复用。
- **continuity**：分镜后做一致性校验。

## 暂停确认门槛

出于成本与控制，以下三个阶段**需要用户确认**才会继续：

1. **storyboard**：确认叙事结构。
2. **videos**：最贵的阶段，确认分镜后再花钱。
3. **assemble**：最终合成前确认。

> 你也可以设置 `autoProgress=false` 完全手动推进。

## 任务可恢复

每个阶段任务都带：

- **心跳锁**（`lockedBy` / `lockedUntil`）：防止重复执行。
- **孤儿回收**：锁过期超 5 分钟的任务自动恢复。
- **重试 / 取消**：失败任务可重试，可随时取消。

失败的生命周期决策（重试 vs 失败、退避）由统一的 task-engine 处理。即使 Worker 重启，流水线也不丢进度。

## API

Canvas 操作多数同步返回；流水线端点采用 fire-and-forget，立即返回 `{ accepted: true, runId }`，后续进度通过 SSE 推送。
