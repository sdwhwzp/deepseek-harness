---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-21-user-question-reply

[English](2026-09-21-user-question-reply.md) | 中文

## 概述

新增受限定的 user-question-reply 消息来源，将已继续的 ask_user_question 调用的迟到回答送入 agent inbox。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-09-21-user-question-reply
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-09-20-fork-principal-and-ptc-correlation"
    after: "c93f215e64233066cb6b3ec088731a07e3246f7fa20a911ec1a3166ac547c1fe"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-09-16-session-format-v4"
    after: "186159f5f6f67a0b8cd095b8fe55bef42d4f25ca1a1c248f859867af2ece0467"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-09-20-fork-principal-and-ptc-correlation"
    after: "0f76994559637b6eba82f3643f45edd8587d77abc722c327110321b0acd75bb8"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-09-20-fork-principal-and-ptc-correlation"
    after: "e5cae690aae490e37d7f94ef6a5c7e38b4d1b094b2a4b9f81a34457d11c53c70"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有日志不含该来源，仍然有效。新来源是普通用户消息上的受限定归属；没有 dsh-user-questions 的读取方保留消息，并从内容推导历史。只有 userQuestions projection 读取该来源，关闭指定的问题并记录答案。answer RPC 是唯一生产方，只写入 outcome answered；关闭 Client 面板不会持久化回复。不新增事件类型，也不改变 Session header。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/interaction/user-questions/tests packages/interaction/tool-ask-user/tests：81 个测试通过。projection、reply、view 和 process-group 的定向测试共 70 个通过。pnpm run typecheck 通过。pnpm run doc-sync 的 42 项检查全部通过，包括持久化历史和翻译配对。

<a id="dev-note"></a>
## 开发备注

无。
