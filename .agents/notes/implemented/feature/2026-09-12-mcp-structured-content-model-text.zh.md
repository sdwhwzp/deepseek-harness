# Agent Note: MCP 结构化内容进入模型文本

Status: implemented

[English](2026-09-12-mcp-structured-content-model-text.md) | 中文

## Problem

`@deepseek-ai/dsh-mcp-client` 只从 `content` 块渲染工具结果的模型可见文本。MCP 规范允许声明了 `outputSchema` 的服务器把载荷放进 `structuredContent`，并要求它为旧客户端在文本块里回显同一份 JSON。生产环境里的服务器跳过了这个回显：飞常准航班数据服务器对 `getFlightList` 的回答是 `content: [{ text: "Flight list: 11 item(s)" }]`，十一条航班在 `structuredContent` 里。会话日志里存的规范值两半都有，但模型只读到那句摘要，回答不了它刚刚用工具查的问题。

## Decision

`render()` 与图片投影的回退文本统一经过一个函数 `modelText`：先是投影后的 `content` 文本，再接上 `structuredContent` 的紧凑 JSON，除非已有文本块解析后与结构化值深度相等。`content` 为空数组而结构化值存在时，只渲染 JSON，而不是"没有返回模型可见内容"的诊断。规范值不变；投影是它的纯函数，从会话日志重放得到同样的文本，不需要新的会话事件。

紧凑 JSON 把 token 开销限制在载荷本身。用深度相等而不是字符串比较来识别回显，是为了认出服务器美化打印过的合规回显。

## Alternatives considered

- **投影保持不变，要求服务器回显。** 否决：harness 修不了第三方服务器，而模型看不到工具数据，对用户来说就是一次失败的工具调用。
- **有 `structuredContent` 时只渲染它，丢掉摘要文本。** 否决：摘要行常常是服务器有意给人读的框架，文本块也可能带有结构化半边没有的信息。
- **美化打印 JSON。** 否决：缩进在大集合上成倍增加 token，对模型理解没有收益。

## Consequences

- 服务器返回结构化输出而不回显文本的工具，现在每次调用要付载荷本身的 token；改动前只付摘要的钱，但什么可用的东西都拿不到。
- `finalizeContent` 仍然比较执行时记录的回退文本，因此图片投影只在渲染文本一致时才应用。
- `packages/mcp/mcp-client/tests/mcp-client.spec.ts` 的 `structured content projection` 钉住三种情形：追加、已回显、仅结构化。
