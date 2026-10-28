---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-28-fork-account-liveshare-integration

[English](2026-10-28-fork-account-liveshare-integration.md) | 中文

## 概述

整合账号归属、LiveShare 用户来源 principal 与技能目录未完成标记。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-28-fork-account-liveshare-integration
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    integrates: ["2026-10-24-fork-account-source-integration"]
    after: "b4553372e6b73575587d5f2287247449bf9986c1b70f5cc49df4275979e6058d"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    integrates: ["2026-10-24-fork-account-source-integration"]
    after: "eea2a423cc8d4f402dcd24c8c4dc30678f177037ad3f28375523689a64fd02b9"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    integrates: ["2026-10-24-fork-account-source-integration"]
    after: "7243359ab15787a5c02be1b36423cf3810ebd299e36d961faef623370f0128f6"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

两条已接受历史及所有已提交格式代际均保持完整。当前读取方接受缺少可选消息 principal 或技能目录 incomplete 标记的旧记录；缺少账号 principal 时仍为匿名。LiveShare 分支的读取方可以忽略新增的可选账号 principal。账号 fork 的读取方在不处理某种来源 principal 时仍保留普通用户消息内容。账号授权使用传输验证后存入消息的 AuthenticatedPrincipal；source.principal 是独立的、带判别字段的归属值，不授予账号访问权。share-viewer 的可选 displayName 仅供显示，LiveShare 准入在每一步之前复检 Relay 身份和授权。未挂载 LiveShare 的组合将内容作为普通用户输入处理。既有用户来源 principal 与标题请求消息仍可通过判别字段解释。三个分叉根共八处差异，包括五处可选字段新增、两处来源 principal 值类型变化及一处标题消息联合类型变化；后三处均已评估两个读取方向。SESSION_FORMAT_VERSION 保持不变。

<a id="verification"></a>
## 验证

只读分支比较已将两条已接受前序分别与合并后源码比较，没有新根。持久化目录/principal、Session JSON/修复和 LiveShare Host/Viewer 准入回归：5 个文件、66 个测试通过。修复首次完整测试暴露的问题后，控制器授权、取消、监听器、LiveShare 与构建夹具回归：11 个文件、239 个测试通过。首次完整测试未全绿；完整运行时构建及聚合构建检查在最后的取消处理调整之前已通过。

<a id="dev-note"></a>
## 开发备注

无。
