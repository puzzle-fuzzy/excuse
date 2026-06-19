---
title: '从一段故事文本到成片：Canvas 流水线完整指南'
description: '拆解 Excuse Canvas 的 12 阶段流水线——从故事分析、角色/场景抽取到分镜、视频与合成，以及失败如何恢复。'
pubDate: 2026-06-10
category: 'guides'
heroImage: '../../../assets/blog-placeholder-3.jpg'
tags: ['Canvas', '故事成片', '流水线', '视频']
---

把一段故事文本变成一支成片，中间需要经历大量协调：角色要一致、场景要连贯、镜头要分好、对白要配、视频要生成、最后还要合成与配乐。**Canvas 流水线**就是为了把这件事自动化而设计的。

## 12 个阶段

Canvas 的完整顺序是：

```text
analyze → characters → locations → characterRefs → locationRefs → storyboard → continuity → rebuild → dialogue → videos → bgm → assemble
```

每个阶段都是一条独立任务，按顺序推进。关键设计如下：

## 一致性是核心

故事成片最大的难点是「上一镜和下一镜里，同一个角色长得不一样」。Canvas 用几个阶段专门解决：

- **characters / locations**：从故事里抽取角色与场景。
- **characterRefs / locationRefs**：生成稳定的参考图，后续镜头复用。
- **continuity**：在分镜之后做一致性校验，发现并修正不连贯之处。

## 三个「暂停确认」门槛

并非所有阶段都全自动。出于成本与控制考虑，以下三个阶段**需要用户确认**后才会继续：

1. **storyboard**（分镜）——确认叙事结构。
2. **videos**（视频生成）——这是最贵的阶段，确认分镜无误后再花钱。
3. **assemble**（合成）——最终成片前确认。

## 任务可恢复

每个阶段都是统一任务队列里的一条任务，带有：

- **心跳锁**：防止重复执行。
- **孤儿回收**：锁过期超 5 分钟的任务自动恢复。
- **重试与取消**：失败的任务可以重试，也能随时取消。

这意味着即使某个阶段失败、甚至 Worker 重启，流水线都不会丢失进度。详见 [Canvas 文档](/docs/canvas)。

## 怎么开始

1. 在工作台新建一个 Canvas 项目，粘贴你的故事文本。
2. 启动流水线，等待 analyze 与 characters 完成。
3. 在 storyboard 门槛确认分镜。
4. 确认后进入视频生成，最后合成成片。

整个过程你可以随时介入、调整、重新生成单个阶段。这就是「让想象力拥有生产力」的字面含义。
