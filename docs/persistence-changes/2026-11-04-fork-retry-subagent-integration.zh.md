---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-04-fork-retry-subagent-integration

[English](2026-11-04-fork-retry-subagent-integration.md) | 中文

## 概述

将经过认证的账号归属与重试控制输入、子代理结算元数据合并。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-04-fork-retry-subagent-integration
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-27-retry-control-input"
    integrates: ["2026-10-28-fork-account-liveshare-integration"]
    after: "3242322d6182d872ace6b36a7c5d2f260fc1ccfb2bb91d39501bf61eac70e6ce"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-27-retry-control-input"
    integrates: ["2026-10-28-fork-account-liveshare-integration"]
    after: "0798a5a9e79a0a27758ecfe8107d8be4a1529a851bd647645505eba24ca36a09"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-27-retry-control-input"
    integrates: ["2026-10-28-fork-account-liveshare-integration"]
    after: "9004d1acddcb37600c1091cf9c3d59f527b834444cc3f3ad7daacf32ad9eb8d1"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

两条已接受的历史及所有已提交的 Session 代际文件均保留。当前读取方接受两条前序分支的记录：账号主体与结算停止原因均为可选字段，重试输入沿用已有 UserMessage 表示。较早的账号分支读取方保留可扩展的来源元数据，将空重试输入作为普通用户消息处理；较早的上游读取方可忽略可选账号主体而不改变消息内容。经过认证的账号权限与 source.principal 归属信息保持独立，由 Host 检查。新的具名子代理目录保留负载版本 3 判别字段，旧读取方会拒绝而非误读；其已有确认记录仍为权威。Team 模式与任务所有者名称记录保留上游确认。此次合并不添加必填字段，也不改变 SESSION_FORMAT_VERSION。

<a id="verification"></a>
## 验证

使用 persistence-review 分别比较账号分支、上游机器目录与合并后的源码。持久化、目录迁移、重试、账号访问、附件所有权和 Team 的九个测试文件共通过 293 项测试；压缩帧用例在未压缩变体下跳过。子代理连续运行与认证主体保留已通过聚焦的连续运行测试。历史格式验证覆盖 v0 至 v4，未修改已提交的代际文件。

<a id="dev-note"></a>
## 开发备注

无。
