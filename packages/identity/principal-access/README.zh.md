---
description: "面向 principal 限定 Session 与 Workspace 读取范围的部署授权 Service Definition。"
kind: "package-reference"
---

# @deepseek-ai/dsh-principal-access

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-principal-access` 定义 Host 专用的 `ctx.principalAccess` Service Definition。它把传输层验证过的 `AuthenticatedPrincipal` 与候选 Session 或 Workspace id 转换为可读子集。认证部署根据权威账户数据提供实现，API 控制器消费该服务。本包不认证请求，也不附带提供方。

## 目录

- [使用本包](#use-this-package)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>

## 使用本包

针对一批候选项调用一次 `resolvePrincipalAccess(ctx, principal, { sessionIds, workspaceIds }, signal)`。列表与 feed Consumer 使用 `readableSessionIds` 和 `readableWorkspaceIds` 过滤。精确读取把带判别字段的 `{ kind, id }` 传给 `requirePrincipalAccess`；拒绝时抛出 code 为 `PRINCIPAL_ACCESS_DENIED` 的 `PrincipalAccessDeniedError`。展示名称与断言角色不是访问授权。

辅助函数采用以下默认行为：

| 访问提供方 | 请求认证提供方 | Principal | 结果 |
|---|---|---|---|
| 缺失 | 缺失 | 缺失 | 为本地匿名操作放行请求 id |
| 缺失 | 任意 | 存在 | 以 `provider-required` 拒绝 |
| 缺失 | 存在 | 缺失 | 以 `provider-required` 拒绝 |
| 存在 | 任意 | 缺失 | 以 `principal-required` 拒绝 |
| 存在 | 任意 | 存在 | 返回提供方判定的可读子集 |

提供方实现 `PrincipalAccessService.resolve`，根据部署自有成员关系数据验证 `(source, id)`，并省略被拒绝的 id。Consumer 在一元调用或 stream 打开时捕获请求 principal，并在该操作期间保留该值。精确读取先授权再加载内容；实时 feed 对 opening baseline 和之后每个按资源寻址的 frame 分别授权。

附件读取还会把 `attachmentIds` 传给 `resolve`，并要求对应的 `readableAttachmentIds` 授权。省略该结果字段就拒绝所有附件，包括只支持 Session/Workspace 的旧提供方。Session 可读或其历史中出现某个引用，都不是附件授权。提供方按验证过的 `(source, id)` 与附件 id 记录授权；显示信息不改变归属。

接收上传提示词前，Session Controller 与浏览器 subagent 提示词会调用 `recordPrincipalAttachments`，进而调用 `PrincipalAccessService.recordAttachments(principal, { sessionId, attachmentIds }, signal)`。这些 id 只来自已验证的内联字节，或针对接收 Session 精确解析的上传回执；浏览器 subagent 上传使用已授权的父 Session。提供方必须重新验证账户与 Session 归属，并持久、幂等地记录所有授权。不同账户独立上传相同内容时，可各自获得同一内容寻址对象的授权。失败会阻止 inbox 投递；已存储的不可变字节可能成为无引用对象。旧提供方的默认方法以 `attachment-provider-required` 拒绝。完全本地匿名的组合不需要提供方。

升级共享账户部署前，应依据可信归属证据回填现有附件授权。不能因为任意请求引用出现在可读 Session 中，就在读取时自动授权：旧客户端可能注入过引用。归属不明时持续拒绝，直到操作员解决。仅暂存、尚未被提示词接收的上传不会通过这个核心钩子获得授权；浏览器上传预览使用本地字节。回滚快照必须同时包含归属数据、Session 与附件存储。

<a id="further-exploration"></a>
## 进一步探索

- [Session Controller](../../api/session-controller/README.zh.md)——Session 列表、搜索、page、follow 与 control Consumer。
- [消息作用域认证 principal](../../../.agents/notes/implemented/architecture/2026-08-21-message-scoped-authenticated-principals.zh.md)——传输身份传播。
- [限定 principal 范围的读取授权](../../../.agents/notes/implemented/architecture/2026-08-29-principal-scoped-read-authorization.zh.md)——部署与默认行为决策。

<a id="model-experience"></a>
## 模型体验

### Principal 访问解析

#### 模型看到什么

什么都看不到。授权元数据不进入提示词、消息、工具或结果。

#### Token 影响

零。解析 `ctx.principalAccess` 不会创建模型请求或模型可见内容。

#### KV Cache 影响

无；授权元数据绝不进入模型可见前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

以下限制说明部署集成仍须负责的内容。它们是当前约束，而不是任务清单。

- Harness 不附带账户数据库或具体提供方。
- 本 Service Definition 解析读取权限并记录可信上传归属；其他变更授权仍由拥有该操作的能力负责。
- 该 seam 没有通用撤销事件。部署特定的即时 stream 终止需要未来的提供方观测 API。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布运行时不变式 companion，因为提供方拥有授权数据，且不公开独立观测流。
