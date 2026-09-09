# Agent Note: 0.1.3 上游合并中的 principal 授权

Status: implemented

[English](2026-09-05-principal-authorization-across-013-upstream.md) | 中文

## Problem

上游 0.1.3-alpha.1 使用紧凑 Assistant stream、流式 Fetch 请求体、共享命令排序和工具图片卡片。本 fork 还要求持久的消息归属、按请求进行的读取授权，以及通用工具和历史结果中的图片展示。

授权等待会改变可选 Cordis 注入的完成时机，也可能在受保护的操作开始前被取消。仅保留类型而不检查这些执行路径的合并，可能改变投影可用性、错误码或可见输出。

## Decision

**认证仍以单次请求为单位。** 共享 Fetch handler 在选路前解析 principal，并将 `requestBodyMode` 委派给已注册路由。每个 RPC 请求都以该 principal 构造自己的 handler。工具执行接收已准入消息的 principal，并把生成的上下文插入不同 principal 的收件箱消息之前。[消息归属](2026-08-21-message-scoped-authenticated-principals.zh.md)和[读取授权](2026-08-29-principal-scoped-read-authorization.zh.md)决策继续生效。

**授权参与操作的取消映射。** subagent 目录读取与 prompt 投递均把父会话授权期间的取消映射为 `gateway/cancelled`，同时保留明确的 `RemoteError` 拒绝。会话日志导出在创建归档流之前使用请求 signal 授权 lineage。后代会话读取使用派生的 producer signal；一次请求取消会抵达 root、lineage 和后代会话读取，无需 signal 对象具有相同身份。

**夹具显式声明组合与事件身份。** 无附件服务的 Session 测试使用 `omitAttachments`，而不依赖可选注入尚未完成。工具结果夹具通过 `sourceEventSeqs` 引用对应调用，与 loop 的持久调用身份一致，避免一次调用产生重复 Context。

**工具图库同时保留专用卡片和通用结果。** 完整的 `read_image` 卡片保留自己的折叠式 `tool.call.images` 图库。调用树拥有独立的 `tool.call.result-images` 槽位，用于其他携带图片的结果，包括嵌套调用和缺少卡片元数据的历史图片读取。两个槽位均使用附件插件已有的图库和经过 Session 授权的加载器。专用卡片接受结果时，调用树抑制自身图库。

[工具卡片图片决策](../feature/2026-08-20-tool-card-image-results.zh.md)继续负责专用卡片的派生和折叠展示。本决策仅取代其通用图片限制：独立的调用树槽位保持每个槽位只有一个声明所有者，无需在 owner props 中传递 React 渲染回调。共享命令排序使用 `rankByName`。

**模型触发器在重新加载期间保留已确认的名称。** 连接重置会在重新加载前清空模型目录。在此期间，触发器的可见文字和无障碍标签均保留最后确认的模型与推理强度名称。首次加载且没有已确认选择时显示加载中文案。

**已发布格式的迁移校验会保留存储的 principal。** v0-to-v1 迁移边校验用户角色消息、收件箱条目、标题请求消息及 turn/step start 上可选的身份；共享 payload 校验器也用于 v1-to-v2 迁移边。它保留精确的提供方、主体 id、用户名和角色，移除旧 turn trigger 时也不例外。为了读取旧日志而丢弃身份会改变消息归属和记账，因此格式错误的身份仍会使迁移失败。已录制 v0 对话的回放快照和完整迁移链用例会验证这些字段保持不变，同时不改变模型输出或已提交的源日志代。

## Alternatives considered

**注册 RPC handler 时绑定 principal。** 注册的生命周期长于单次请求，因此无法捕获每次操作的已认证调用方。

**将专用图片卡片视为通用图库的完整替代。** 其校验要求 `read_image` 调用，以及卡片元数据或受支持的嵌套调用回退。通用工具和历史结果可以在没有这些字段的情况下包含有效图片引用。

**通过工具 owner props 传递 React 渲染回调。** Client UI 组合应使用已声明槽位。独立的调用树槽位保留这一规则，并复用附件渲染器。

**每次连接重置后显示加载中文案。** 这会在短暂重新加载期间丢弃已确认标签，使模型和推理强度看起来都发生了变化。

## Consequences

principal 归属和读取授权与紧凑 Assistant settlement 及流式上传保持兼容。通用结果图片仍然可见，完整图片卡片则保留折叠展示；代价是增加一个图片槽位声明及附件注册项。

聚焦用例覆盖授权取消与拒绝、导出读取过程中的请求取消、显式无附件组合、工具调用身份、根调用与嵌套结果图库、图片卡片去重，以及连接重置期间模型触发器的可见文字和无障碍标签。完整组装的图片展示场景通过已授权附件路由验证历史工具图片；既有图片快照仍为预期行为。
