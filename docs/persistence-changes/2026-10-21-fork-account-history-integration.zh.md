---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-21-fork-account-history-integration

[English](2026-10-21-fork-account-history-integration.md) | 中文

## 概述

将已接受的账号 principal 与 PTC 调用位置字段，汇合到源仓库的 PTC 操作元数据历史。用户消息、轮次／步骤开始、拼入收件箱的消息和标题模型消息快照保留可选认证 principal。PTC dispatch 与 dispatch-start 在源字段之外保留可选 rootCallSeq。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-21-fork-account-history-integration
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-13-user-rpc-principal"
    after: "8b04696820fb5727b8c5ca712b7bcae2d9ae1cf48c137aa137f80fed0e142a8a"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-13-user-rpc-principal"
    after: "09fbaa24d601c69a74ddf4d00ba68213219cf1438ecf6c5b616a62b488bd53f5"
    decision: same-version
  - root: "event:tool/ptc-dispatch"
    previous: "2026-09-20-fork-principal-and-ptc-correlation"
    integrates: ["2026-10-05-ptc-operation-metadata"]
    after: "659206c0b922b56ce3393db46f0b37ea519f1bc8678a4da00724483fc58aac4b"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-13-user-rpc-principal"
    after: "20d66b7e6b62db7f3403b772eb9fe0eb91ef0ee15db55745085463806d271b3a"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

Session 头和事件信封保持不变。新增账号或根调用字段均可选；当前读取方接受缺少这些字段的源记录，并保留带字段的既有 fork 记录。PTC 操作元数据与 rootCallSeq 分别占用独立的可选属性，因此汇合会验证两份前驱 schema，不改写任何一份确认记录。历史 V4 JSONL 样本、已提交的格式代际和最终确认检查点保持完整。principal 的存在本身不授予访问权限：当前请求授权仍约束会话和工作区操作。较旧的源读取方不实现 fork 的账号授权，不作为受支持的账号隔离部署目标。

<a id="verification"></a>
## 验证

已核对相对于合并源 schema 的七项根差异，以及 tool/ptc-dispatch 的两个独立历史末端。账号、网关、工作区、子会话及交付物定向检查通过（330 项）；workflow 样本回归通过（44 项）。持久化历史测试通过（85 项），覆盖显式汇合、缺失／循环／重复／祖先父记录、前驱文件保留及最终确认的汇合父记录防篡改。尚未进行生产迁移或部署。

<a id="dev-note"></a>
## 开发备注

无。
