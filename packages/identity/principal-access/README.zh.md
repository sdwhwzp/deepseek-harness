---
description: "面向 principal 限定 Session 与 Workspace 读取范围的部署授权 Service Definition。"
kind: "package-reference"
---

# @deepseek-ai/dsh-principal-access

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-principal-access` 定义 Host 专用授权服务 `ctx.principalAccess`，把传输层已验证的 `AuthenticatedPrincipal` 以及候选 Session 或 Workspace id 转换为可读子集。它还导出唯一的默认解析辅助函数 `resolvePrincipalAccess` 和精确资源检查 `requirePrincipalAccess`。本包是 Service Definition；认证部署提供由其权威账户数据支持的 Service Provider，API 控制器则是 Consumer。本包不认证请求，也不附带提供方。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

Consumer 针对一批候选项调用一次 `resolvePrincipalAccess(ctx, principal, { sessionIds, workspaceIds }, signal)`。它的 `PrincipalAccessResult` 包含 `readableSessionIds` 与 `readableWorkspaceIds`；列表与 feed Consumer 按这些集合过滤，精确资源 Consumer 则把一个带判别字段的 `{ kind, id }` 值传给 `requirePrincipalAccess`。精确资源被拒绝时会抛出 `PrincipalAccessDeniedError`，其中 code 为 `PRINCIPAL_ACCESS_DENIED`、reason 为 `subject-denied`，并带有被拒绝的 subject。展示用 `username` 与断言的 `role` 绝不构成访问授权。

辅助函数拥有完整的部署默认行为：

| 访问提供方 | 请求认证提供方 | Principal | 结果 |
|---|---|---|---|
| 缺失 | 缺失 | 缺失 | 为本地匿名旧有操作放行所有请求 id |
| 缺失 | 任意 | 存在 | 以 `provider-required` 关闭式失败 |
| 缺失 | 存在 | 缺失 | 以 `provider-required` 关闭式失败 |
| 存在 | 任意 | 缺失 | 以 `principal-required` 关闭式失败 |
| 存在 | 任意 | 存在 | 仅返回提供方判定可读的子集 |

提供方实现 `PrincipalAccessService.resolve`。它针对部署自有账户与成员关系记录验证 principal 的 `(source, id)` 对，评估每个请求 id，并省略被拒绝的 id。已验证 principal 是身份元数据，不是某个具名资源属于该身份的证明。提供方应响应传入的 abort signal，而且不得仅根据 `username` 或 `role` 推断所有权。

Consumer 在一元调用或 stream 打开时捕获一次消息作用域 principal，并在该操作的生命周期中使用该值。列表先解析全部候选 id，再返回行。实时 feed 既过滤 opening baseline，也解析此后每个按资源寻址的 frame，因此全局 producer 不会变成全局响应。精确读取在加载资源内容前解析访问权限；按 subagent 寻址的读取以其普通父 Session 作为授权 subject，同时仍执行独立的父子关系验证。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

服务特意返回集合，而不是单个 boolean：列表、搜索、baseline、后代导出与 workspace feed Consumer 可以针对一批候选项只执行一次部署查询，同时保留各自的顺序与分页。Session 与 Workspace id 在 Service Definition 中始终保持 branded。辅助函数在调用提供方前应用默认行为，并在异步判定前后检查取消。在这个有类型的同进程边界上会信任提供方结果；协议和数据库验证仍由提供方负责。

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | Service Definition、请求/结果词汇、严格默认解析器与精确资源拒绝 |
| [`src/invariant.ts`](src/invariant.ts) | 空 invariant companion；部署提供方拥有权威观测 |
| [`tests/service.spec.ts`](tests/service.spec.ts) | 默认矩阵、提供方委托、精确授权、取消与 Cordis 注册 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Session Controller](../../api/session-controller/README.zh.md)——覆盖 Session 列表、搜索、page、follow 与 control 读取的一个 Consumer。
- [消息作用域认证 principal](../../../.agents/notes/implemented/architecture/2026-08-21-message-scoped-authenticated-principals.zh.md)——已验证身份如何到达 Host 业务服务。
- [限定 principal 范围的读取授权](../../../.agents/notes/implemented/architecture/2026-08-29-principal-scoped-read-authorization.zh.md)——本 seam 背后的部署与默认行为决策。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

-----

<a id="model-experience"></a>
## 模型体验

### Host 读取过滤

#### 模型看到什么

无。`ctx.principalAccess` 过滤 Host API 读取，不增加提示词、工具、消息或结果文本。

#### Token 影响

无。授权判定与被拒绝的资源绝不进入模型请求。

#### KV Cache 影响

无。该服务不改变模型请求前缀。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- Harness 不附带账户数据库或具体 Service Provider；认证部署必须挂载一个。
- Service Definition 只授权读取。变更授权仍属于拥有各命令的业务能力。
- 实时 Consumer 会重新检查按资源寻址的 frame，但不会收到通用撤销事件；部署特定的即时 stream 终止需要未来的提供方观测 API。
