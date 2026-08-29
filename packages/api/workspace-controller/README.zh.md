---
description: "Host 与 Client 工作区控制：修改工作区导航并跟随其完整投影。"
kind: "package-reference"
---
# Workspace Controller

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-api-workspace-controller` 拥有 Host 的 `ctx.workspaceController` 服务和生成的 Client `ctx.remote.workspace` namespace。它的 Remote 方法负责创建、重命名、移除和重排 Workspace，在 Workspace 内重排 Session，从 Workspace 导航中归档 Session，以及跟随完整的 Workspace 投影。当 Client 必须修改或跟随 Workspace 导航时，请通过 API Gateway 使用它。本包同时拥有 `ctx.directoryPickerController` 与生成的 `ctx.remote.directoryPicker` namespace，因为它承载的选目录 seam 是抽象的，自身从不作为 Loader entry。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

Host 控制器会串行执行正确性取决于当前 registry 状态的变更，并为预期失败返回稳定的 `WorkspaceError` 值。它的 `follow()` 流会同步订阅持久 Workspace 变更，先发出一份调用方可读的完整 baseline，再按顺序发出 `upsert`、`remove`、`order` 和 `archived` 增量。重连会以替换 baseline 开始新一代，因此消费方不依赖收到断线期间的每个增量。

未配置 principal-access provider 的本地匿名部署会收到完整投影。认证部署需要挂载 `ctx.principalAccess`；此时 `follow()` 会在发布前过滤 opening Workspace 行、其中的 Session 成员、已归档 Session id 以及后续每条增量。对既有 Workspace 或 Session 的每次变更都会在写入前授权所有被寻址资源。变更结果会把 Workspace 成员、registry 顺序和归档集合过滤为可读 id，因此一元响应不能绕过流策略。被拒绝的精确 id 会使用现有的 `workspace-not-found` 或 `session-not-found` 失败，不暴露资源是否存在。存在 principal 却缺少 provider，或 provider 支持的请求缺少 principal 时会保留 principal-access 配置错误并关闭式拒绝。

`create()` 会在串行命令中解析路径。已注册路径属于精确 Workspace 访问，其行必须先通过授权才能返回；拒绝时使用 `workspace-invalid-path`，且不披露既有 Workspace id。真正的新路径还没有可授权的 Workspace id；控制器会验证 principal/provider 组合，创建成员为空的行并返回。部署需要在该命令之前负责目录选择和 Workspace 创建策略，并为后续访问检查登记新资源的归属关系。

Client 入口提供 `ClientWorkspaceModel` 和 `createWorkspaceStateStream()`。该模型拥有 Workspace 行、registry 顺序、已归档 Session id、一元变更回声，以及流与一元调用的竞态处理。较新的 Host 行按 `updatedAt` 获胜；已提交的流顺序优先于较旧的一元响应；已经移除的 Workspace id 不会被延迟数据复活。该包公开与框架无关的快照和订阅，把导航策略与 React hook 留给 UI owner。

-----

<a id="model-experience"></a>
## 模型体验

无，因为 Workspace 组织属于浏览器与 Host 控制状态，并且不注册提示词、工具或会话事件。

#### KV Cache 影响

无直接影响；Workspace 变更不会改变模型请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- `follow()` 在重连后替换完整投影，不提供持久 cursor 或增量追赶协议。
- 权限变化会在下一条相关 Workspace 或归档增量到来时生效；单独的权限撤销重连策略由 provider 拥有。
- `principalAccess` 证明既有资源成员关系，不证明调用方可以采用任意 Host 目录；认证部署必须在 `workspace.create` 到达本控制器前约束目录选择和创建。
- 进程本地删除标记只会在 Client 模型生命周期内阻止延迟数据复活已移除的 Workspace。


<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
