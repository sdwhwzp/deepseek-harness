---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-24-fork-account-source-integration

[English](2026-10-24-fork-account-source-integration.md) | 中文

## 概述

合并已发布 fork 的账号归属字段与源仓库的 action-card 来源归属。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-24-fork-account-source-integration
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-21-fork-account-history-integration"
    integrates: ["2026-10-22-action-card-status"]
    after: "592802389adc4c2348e68c191d87fea52c36acee11215dc1da969403d0365e3d"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-21-fork-account-history-integration"
    integrates: ["2026-10-22-action-card-status"]
    after: "0b74a0f5f0797f71e5df9b3d3b4e9d659d3f3f09e5bce48c38dc388a0e2223fa"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-21-fork-account-history-integration"
    integrates: ["2026-10-22-action-card-status"]
    after: "00be6ea5299e69419b3240ff89dc719a6550d86aa27332a01e785457a05bbc81"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

两个已接受分支继续使用格式 4。现有 fork 记录保留消息、轮次、步骤的可选 principal 和 PTC 根调用序号字段；缺失 principal 的记录保持匿名，不继承后续请求的账号。源仓库中缺少这些可选字段的记录仍可读取。action-cards 来源种类仅标记已存储消息内容的归属；已声明的来源归属策略保留未知种类，不据此派发动作。已分别针对两个已提交分支的清单审核四项来源种类增加与七项可选字段差异。已接受记录及其根摘要保持不变，节点表存储格式转换不改变 schema 或指纹。

<a id="verification"></a>
## 验证

分别针对 HEAD 和 MERGE_HEAD 执行只读 persistence-review：四项来源种类增加、七项可选属性增加，无要求兼容性复核的差异。principal/controller/goal 定向测试 80 项通过。会话修复、格式准入与迁移、侧栏及 PTC 关联回归 1130 项通过。主程序完整构建及 Host、Client 聚合检查共 10 个门禁通过。

<a id="dev-note"></a>
## 开发备注

无。
