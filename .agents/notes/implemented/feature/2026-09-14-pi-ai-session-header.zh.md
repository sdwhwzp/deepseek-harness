# Agent Note：pi-ai 路由可把会话 id 送给按会话路由的提供方

状态：已实现

[English](2026-09-14-pi-ai-session-header.md) | 中文

## 问题

OpenCode Go 从 2026-09-05 起拒绝缺少 `x-opencode-session` 的请求，返回 `400 {"type":"MissingSessionID"}`，并给出路由理由：它的路由器与提示缓存以每会话稳定的 id 为键。通过 `@deepseek-ai/dsh-llm-pi-ai` 提供 `opencode-go` 的部署无法靠配置满足这一点。路由的 `headers` 字典是静态的，每个会话都会呈现同一个 id——端点接受，但被钉在一个路由桶里，与这个 header 存在的目的正好相反。

适配器本来就有这个值。`PiAiAdapter.stream` 把 `options.sessionId` 作为流选项转发给 `Models.streamSimple`；只有 header 映射在构建时没有用到它，只由 `profile.headers` 加 Harness 归因组成。Harness 自己的 DeepSeek 适配器从上线起就用同一个字段发送 `x-deepseek-harness-session-id`，所以这条 seam 已经携带了按会话路由的提供方所需的东西，只是有一个适配器家族没有用上。

## 决定

路由可以命名 `sessionHeader`。命名之后，若请求携带会话 id，补全请求就加上 `{ [sessionHeader]: sessionId }`；两者缺一时，发送的内容与以前相同。

`requestHeaders` 接收名称与 id，而不是从 profile 里读取，这样合并顺序在一个表达式里就看得见：先是部署 header，然后是会话 header，最后是归因——归因仍然赢得它拥有的每一次冲突。

解析会拒绝两类名称，而不是把它们接纳进一条无法工作的路由。Fetch 无法发送的名称会在每次请求时、在提供方那一侧抛错，距离造成它的那次写入已经很远。归因 header 拥有的名称（今天是 `user-agent`）会在合并时被覆盖，于是路由看起来已配置，提供方却在用于路由的 header 下收到产品身份。

没有会话 id 的请求不带该 header 发送，而不是带一个生成的 id。配置探测与一次性工具调用不是会话；给每个这样的请求一个新 id，在提供方看来与一段永不继续的会话没有区别，而这个值的全部意义就在于两个请求只在属于同一会话时才共享它。

## 考虑过的替代方案

- **在 `headers` 里放一个静态的 `x-opencode-session`。** 作为长期答案被否决，但记录为部署在等待期间的做法：它能通过检查，代价是整个部署失去按会话路由与缓存局部性。
- **把 OpenCode 的 header 名称硬编码进适配器。** 否决：这是提供方策略，不是 pi-ai 的策略；第二个要求自有 header 名称的网关会再次需要同样的改动。名称属于与该提供方对话的那条路由。
- **在一个 Harness 名称下无条件向每条路由发送会话 id。** 否决：这会把 Harness 内部标识放到部署发出的每个第三方请求上，包括既没有索要也没有说明其用途的提供方。
- **用会话 id 的哈希派生 header 值。** 在没有明确需求的情况下否决：没有提供方要求不透明形式，而多一层变换会让关于路由的支持对话更难进行。

## 后果

- 命名了 `sessionHeader` 的路由每次补全请求多发送一个 header；其值是会话日志中已经存在的会话 id，因此没有新的东西变成模型可见或持久化。
- 这些路由的提供方侧提示缓存现在可以按会话为键。原本使用静态 header 的部署在设置 `sessionHeader` 时应删除该静态值，否则静态值继续覆盖不了任何东西——两个名称不同——同时宣告着第二个毫无意义的 id。
- `packages/llm/llm-pi-ai/tests/adapter.spec.ts` 固定了三条请求路径用例（带会话的已配置路由、不带会话的已配置路由、未配置路由），`tests/config.spec.ts` 固定了两条拒绝与一个被接受的名称。
