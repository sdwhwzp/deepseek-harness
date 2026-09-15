# Agent Note: Object-rooted tool parameters at registration

Status: implemented

[English](2026-09-14-tool-parameters-object-root.md) | 中文

## Problem

一次模型请求把所有已注册工具放在同一个 `tools` 数组里，因此一份不可用的参数 schema 会让整轮失败，而不只是它自己那个工具。某个 MCP 服务器为 `dast_flight_happy` 声明的 schema 在 `type: "object"` 之外还带了根级 `oneOf`，用来表达「要么给航班号，要么给出发地和到达地」。桥接层原样转发了这个根节点，该部署的每一轮都以 `tools.58.custom.input_schema: input_schema does not support oneOf, allOf, or anyOf at the top level` 结束——没有工具调用，没有回答，报错里也没有指出 59 个工具中是哪一个出的问题。

## Decision

`ToolRuntime.register()` 通过 `assertToolParametersRoot` 断言参数根节点：schema 必须是一条记录、`type` 为 `"object"`，且不得声明 `oneOf`、`anyOf`、`allOf`、`not`。工具参数永远是一个 JSON 对象，该根节点上的联合或否定没有可作用的对象；断言在注册时点出违规的工具与关键字，而不是等提供方报错。

只检查根节点。属性 schema 保留作者或服务器使用的任何词汇——桥接而来的 `anyOf: [{type: 'string'}, {type: 'null'}]` 是常见的 MCP 输出，提供方在根节点以下接受它。

`dsh-mcp-client` 在注册前先归一化，因为出问题的 schema 来自第三方。它丢弃的正是注册表拒绝的那些关键字，通过共享的 `PARAMETERS_ROOT_COMPOSITION_KEYWORDS` 让两侧不会漂移，并记录服务器名与工具名。服务器仍会在 `tools/call` 时强制该约束；丢弃付出的代价是模型事先不再知道这条约束。

## Alternatives considered

**改在提供方适配器里归一化。** 这条限制看起来是 Claude 独有的，但在任何工具调用 API 下，工具参数 schema 的根节点都是一个参数对象，所以根级联合在哪里都没有意义，不被拒绝的地方也只是被静默忽略。把规则放进单个适配器，会让其余路由继续给出模型无法满足的 schema。

**在同步时拒绝出问题的 MCP 工具。** `syncTools` 以整代为单位失败，一份坏 schema 会连带拖垮同一台可用服务器的另外八个工具——这比让一个工具的 schema 变宽松严重得多，而且部署方自己无法修复。

**用 harness 强制子集校验桥接来的 schema。** `assertSupportedJsonSchema` 会拒绝 `format`、`$ref`、`default` 和嵌套 `anyOf`，而几乎每个真实 MCP 服务器都会输出这些。它适合校验本仓库自己编写的 schema，不适合校验本仓库转发的 schema。

**注册处不做检查，只修桥接层。** MCP 并非原始 `parameters` 记录的唯一来源——动态 `cordis_define` 包也会自行注册。注册表才是对所有来源都成立的地方。

## Consequences

参数根节点不是对象的工具现在会在注册时大声失败，错误里带上工具名与关键字。仓库内经 `defineTool` 构建的工具始终满足该约束。声明了根级组合关键字的 MCP 服务器会保住全部工具，只是模型看到的 schema 少了那一条约束，并且每次同步会为每个受影响的工具打一条 warn 日志。单元测试固定了注册表对每个关键字与非对象根的拒绝，也用真实的 `dast_flight_happy` 根节点固定了桥接行为——根节点被剥离，属性里的 `anyOf` 不受影响。
