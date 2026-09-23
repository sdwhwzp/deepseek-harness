---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-20-fork-principal-and-ptc-correlation

[English](2026-09-20-fork-principal-and-ptc-correlation.md) | 中文

## 概述

基于 V4 Session 类型清单，记录排队输入和轮次事实中的可选认证身份，以及 PTC 调度事件的根工具调用序号。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-09-20-fork-principal-and-ptc-correlation
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-09-16-session-format-v4"
    after: "fb911dfe70f07d7ec51cab5b937d89366ef8085cfd7b2f3dbd819bbc76185c8a"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-09-16-session-format-v4"
    after: "4f1959776af618db1e6a764cc1814b8621d91c9e7abf826947a811a11f624e81"
    decision: same-version
  - root: "event:step/start"
    previous: "2026-09-11-initial"
    after: "e45e981c9edcdd8ac4a5ffa272c28ae489ddfe1c8e5b470aebd38d4c2fb5c30e"
    decision: same-version
  - root: "event:tool/ptc-dispatch"
    previous: "2026-09-16-session-format-v4"
    after: "4465bc52bed5d33d47c737509c16a1b41ebc17673c03e4ecb3c3a11f02481e89"
    decision: same-version
  - root: "event:tool/ptc-dispatch-start"
    previous: "2026-09-11-initial"
    after: "54f30a440e3764d81ad52bb0ea26c662195d96a1135e72c94a7506592e218774"
    decision: same-version
  - root: "event:turn/start"
    previous: "2026-09-11-initial"
    after: "171a37e51ed002a77b9976094748fb961f573bfa5a65e5a17c0c645964a96a6d"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-09-16-session-format-v4"
    after: "8590c9e7c0f4787f8b02742a82b6d5165c95ec84834634162ceb9cb7fcdd3938"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有 V4 事件可省略这些字段。认证执行独立提供经验证的账号身份，缺失字段不授予权限。PTC 读取方在 rootCallSeq 存在时用它区分重复的提供方调用标识，缺失时保留原有的关联行为。已发布的 V3 数据通过携带历史子代理事实的显式 V3 到 V4 迁移升级，不修改任何已提交的 Session 格式代际。

<a id="verification"></a>
## 验证

完整单元测试已执行，随后账号授权、Session 迁移、工作区推送、Connection、Gateway、工作流及界面回归的定向测试通过。pnpm run build 在 Node 22.21.1 上通过。

<a id="dev-note"></a>
## 开发备注

无。
