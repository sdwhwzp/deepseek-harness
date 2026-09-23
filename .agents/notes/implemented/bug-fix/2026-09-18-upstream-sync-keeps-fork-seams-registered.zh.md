# Agent Note：上游同步要把合并基线不再提及的每个 fork seam 重新登记

状态：已实现

[English](2026-09-18-upstream-sync-keeps-fork-seams-registered.md) | 中文

## 问题

把 `deepseek-ai/deepseek-harness` 的 master（0.1.6-alpha.1 → 0.1.6-alpha.2，882 个提交）合并进本 fork 的 `dev` 产生了 38 个冲突文件，但 fork 丢失行为的地方并不在冲突里。有两个 fork 功能在上一次同步时就已经消失，而它们的测试还留着：`mcp-client` 不再把 `structuredContent` 渲染进模型文本（`tools.ts` 以上游文件重建时 `modelText` 被丢掉），dsh-passwords 注册进去的 `conversation.input.bootstrap` 插槽在上游替换 `ConversationRoot.tsx` 后只剩声明、从未渲染。两个测试文件仍在断言旧行为；没人跑过它们，因为全量测试被跳过了。

这次同步还撞上了上游新的生成器门禁：`gen-tool-catalog` 会启动每个工具插件，而 `browser-use-stagehand-native` 的 `tabs` 输入由 Zod 可辨识联合派生，`z.toJSONSchema` 把它输出为根 `anyOf`。fork 的 `assertToolParametersRoot` 拒绝了它，插件一个工具都没注册，目录生成失败——这正是 Anthropic 在请求时会拒绝的 schema，如今在注册时就被拦下。

## 决定

本 fork 拥有的每个 seam 都在上游新引入的注册面上重新登记，并且合并宣告完成之前先跑它们的测试：

- `createMcpToolDefinition` 自己归一化参数根（`bridgedParameters`），因此 MCP 桥接和从生成的 JSON Schema 构建定义的原生插件注册的都是模型提供方接受的根。桥接不再单独归一化。
- `conversation.input.bootstrap` 在 `SlotMap` 里声明、列入 `conversation.content` 工厂的子插槽，并在 Hero 控制行里渲染在 `conversation.hero.agentPreset` 之后；该行带 `data-hero-controls`，测试因此能证明活动对话里没有这一行，而不依赖插槽调用——该行的元素在阶段决定是否挂载之前就已发出这些调用。
- `modelText` 恢复：先是内容文本，然后是紧凑 JSON 形式的 `structuredContent`，除非某个文本块已经回显了它。
- 交付物的改动摘要、对比与改动文件打开路由在读取前先检查对当前查看会话的 principal 访问权，并携带该 principal 通过 typert gateway 打开，与既有的 presented 文件路由一致。
- Connection 的 `/api` 路由把绑定 principal 的桥接包进上游的 `connection/request` waterfall，准入监听器与已验证 principal 得以共存。
- `requestPrincipal` 为目录与图生成器分类；`ConnectionPrincipalRequest` 与 `ConnectionRequestAuthorization` 作为由 `packages/client/connection/src/rpc.ts` 拥有的类型链接豁免。

## 考虑过的替代方案

- **把 `bridgedParameters` 留在 MCP 调用点，在目录清单里对 stagehand 特判。** 否决：`createMcpToolDefinition` 的每个使用方都面临同样的提供方拒绝；只在构建定义的地方归一化一次才能守住保证。
- **放宽 `assertToolParametersRoot`，放行根 `anyOf`。** 否决：它防止的那个 400 会让整个模型请求失败而不只是一个工具，上一次事故记录在[参数根的 note](2026-09-14-tool-parameters-object-root.zh.md)里。
- **重新加回 fork 的 `data-conversation-view` 宽度手柄规则。** 否决：上游的宽度控件本来就只在活动对话里渲染手柄，而且从未有源码设置过该属性；这条规则和它的两处断言自上次同步起就是死的，已删除。

## 后果

- fork 同步只有在受影响包的测试通过后才算完成：`connection`、`ui-conversation`、`ui-deliverables`、`session-controller`、`ui-workflow-run`、`app-boot`、`tools`、`mcp-client`、`ui-commands`。实现丢了而测试还在，就是 seam 被丢弃的特征。
- `packages/mcp/mcp-client/tests/mcp-client.spec.ts` 固定原生定义的根归一化；`packages/client/ui-conversation/tests/skeleton.client.spec.tsx` 固定 Hero 行顺序及其在活动对话里的缺席；`packages/client/ui-deliverables/tests/changes-open.host.spec.ts` 经 gateway 桩打开。
