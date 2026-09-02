---
description: "面向 principal 限定 Session 与 Workspace 读取范围的部署授权 Service Definition。"
kind: "package-reference"
---

# @deepseek-ai/dsh-principal-access

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-principal-access` 定义 Host 专用的 `ctx.principalAccess` Service Definition。它把传输层验证过的 `AuthenticatedPrincipal` 与候选 Session 或 Workspace id 转换为可读子集。认证部署根据权威账户数据提供实现，API 控制器消费该服务。本包不认证请求，也不附带提供方。

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

## 进一步探索

- [Session Controller](../../api/session-controller/README.zh.md)——Session 列表、搜索、page、follow 与 control Consumer。
- [消息作用域认证 principal](../../../.agents/notes/implemented/architecture/2026-08-21-message-scoped-authenticated-principals.zh.md)——传输身份传播。
- [限定 principal 范围的读取授权](../../../.agents/notes/implemented/architecture/2026-08-29-principal-scoped-read-authorization.zh.md)——部署与默认行为决策。

## 模型体验

### Principal 访问解析

#### 模型看到什么

什么都看不到。授权元数据不进入提示词、消息、工具或结果。

#### Token 影响

零。解析 `ctx.principalAccess` 不会创建模型请求或模型可见内容。

#### KV Cache 影响

无；授权元数据绝不进入模型可见前缀。

## 已知限制与延期工作

以下限制说明部署集成仍须负责的内容。它们是当前约束，而不是任务清单。

- Harness 不附带账户数据库或具体提供方。
- 本 Service Definition 只授权读取；变更授权仍由拥有该操作的能力负责。
- 该 seam 没有通用撤销事件。部署特定的即时 stream 终止需要未来的提供方观测 API。
