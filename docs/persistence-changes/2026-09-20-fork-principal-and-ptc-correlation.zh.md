---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-20-fork-principal-and-ptc-correlation

[English](2026-09-20-fork-principal-and-ptc-correlation.md) | 中文

## 概述

记录排队输入和轮次事件中的可选已认证账号字段，以及 PTC 调度事件中的根工具调用序号。

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
    previous: "2026-09-14-image-offload"
    after: "04099928dfb41064f13b163f2a3a5aa2bd59369e4dcd679f13f3317bab4d53fd"
    decision: same-version
  - root: "event:step/start"
    previous: "2026-09-11-initial"
    after: "e45e981c9edcdd8ac4a5ffa272c28ae489ddfe1c8e5b470aebd38d4c2fb5c30e"
    decision: same-version
  - root: "event:tool/ptc-dispatch"
    previous: "2026-09-14-image-offload"
    after: "0441c8b328c191656598ddbf831c529979076453f24595557610839b2a004223"
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
    previous: "2026-09-14-image-offload"
    after: "6cfa6375a1763421c2f18ba7a608aa79fbad51c258a68e6f1b9ee06e83e1fac6"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有事件可以不含这些字段。账号读取方保留缺少身份字段时的既有行为；已认证执行独立提供账号身份。PTC 读取方在存在 rootCallSeq 时用它区分重复的提供方调用 ID，缺失时保留既有的关联方式。这些字段不改变消息内容，也不要求增加 Session 格式版本。

<a id="verification"></a>
## 验证

API、账号授权、工具、Agent 循环、子代理和导出相关测试共 2527 项通过；唯一超时的冷加载投递测试在独立复验中通过。Host 和 Client 类型检查及完整构建通过。

<a id="dev-note"></a>
## 开发备注

无。
