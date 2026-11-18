---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-18-fork-timeline-account-integration

[English](2026-11-18-fork-timeline-account-integration.md) | 中文

## 概述

记录时间线优先级通知与排队消息、用户输入和标题请求中的账号身份如何共存。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-18-fork-timeline-account-integration
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-11-04-fork-retry-subagent-integration"
    integrates: ["2026-11-05-timeline-priority-notice"]
    after: "4189cf72d2a40231786bdd3de765b37eb6ead8ad84de2dee480ffd711b89399f"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-11-04-fork-retry-subagent-integration"
    integrates: ["2026-11-05-timeline-priority-notice"]
    after: "de5749bfc55fd3a3993d75b512d9d686b728434cb7b657ff08c7145ad85194b8"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-11-04-fork-retry-subagent-integration"
    integrates: ["2026-11-05-timeline-priority-notice"]
    after: "f44bc89170b749b222742569f0bd9c291fbc6421cd8b583235352be02c737052"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

两个前驱版本写入的消息都可以读取。时间线优先级通知包含普通文本和来源标识，不支持时间线的读取器可以保留来源并读取文本。缺少身份字段表示没有记录认证账号，不授予账号访问权限。支持身份字段的读取器独立保留账号与消息来源。会话写入格式仍为 V4。

<a id="verification"></a>
## 验证

使用 persistence-review 将生成的 V4 schema 分别与两个父版本比较。时间线反馈、账号访问、JSONL 代际选择、迁移拒绝和多步迁移发布共 240 项测试通过。另运行了覆盖账号归属和传输的 Agent 循环、工作区和会话控制器回归测试。

<a id="dev-note"></a>
## 开发备注

无。
