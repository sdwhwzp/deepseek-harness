# Agent Note: Web 工作区文件引用与会话召回

Status: implemented

[English](2026-07-27-web-file-and-session-references.md) | 中文

## 问题

Web 输入框已有可复用的斜杠命令／引用触发流水线，但它的 `@` source 只是不会产生实际作用的 subagent 标签文本。Web 需要由宿主提供工作区路径发现，同时避免在浏览器中扫描宿主文件系统。宿主还需要一项独立的结构化跨会话快照能力，且不能把会话身份绑定到显示标签。

## 决策

Web 通过 `@deepseek-ai/dsh-client-ui-reference` 暴露仅包含工作区文件的 `@` 菜单。每次查询都使用当前 session id 调用生成的 `fileReferences/list` Remote 方法；宿主把该 id 解析为 agent，并以其 `cwd` 限制发现范围。由 locale 字典提供的文件和文件夹标签显示在一个不可选择的分组标题下，不进入键盘选择索引；该 source 在加载和已结算状态下都隐藏原始组标题。菜单不会调用 `sessionReferenceResolver/candidates`，也不会提供 Session 行。文件查询失败时不显示候选项。

文件功能遵循由三个包构成的 seam：`@deepseek-ai/dsh-file-reference` 拥有 `ctx.fileReferences`、共享 `@path` token 语法、候选形状和稳定的模型指引；`@deepseek-ai/dsh-file-reference-local` 拥有每个 agent（智能体）有界的宿主文件系统索引、失效处理和作用域内的提示词安装；`dsh-client-ui-reference` 消费生成的 Remote 命名空间与共享语法。选择文件会创建带文件图标与文件名的原子输入框引用，其序列化形式仍只是路径提示词文本。目录保持为带文件夹图标的可编辑路径文本，并在尾部斜杠后重新触发补全。

跨会话召回仍是一项独立的宿主能力。受支持的纯文本客户端可以发送由宿主生成的规范 `@[label](dsh-session:…)` mention，但 Web `@` 菜单不会发现或创建它。session-reference 服务会在 `agent/pre-step` 解析已接受的直接用户消息，捕获每个源，在保留直接消息 id 的同时把规范 mention 替换为可读文本，并把冻结快照插入到该消息紧后。Web 使用聊天图标渲染召回上下文行，其他上下文保留文档图标。API Proxy 不包含引用专用路由、依赖或错误码。

输入状态机在默认 sink 报告宿主已接受前，会保留普通草稿文本和原子文件引用。它写入会话 store 的镜像会持久化每个 occurrence 的规范剪贴板投影，因此在 occurrence 表缺失的情况下重新挂载时，仍会保留可解析的路径，而不是仅供显示的标签。序列化或提示词传输失败后，同一草稿会回到可编辑状态。已记录的提示词仍是回放权威。聊天界面继续按照持久的直接消息后接召回行顺序渲染已接受的跨会话 mention，只从紧随其后的带来源召回中关联准确的会话标签，并把快照 JSON 保留在默认收起的召回行中。文件引用保留图标加文字的装饰形式，包括无扩展名 basename；句末标点仍留在引用范围之外。

## 引用事务

```text
type @ → file-reference Remote call → pick folder text or atomic file reference
       → serialize draft → ordinary session.prompt enqueue

canonical session mention from a supported text client
       → agent/pre-step parses mention → capture source → readable prompt + context
```

文件查询仅供参考且可取消；选择操作本身不会读取文件。会话准备针对一个已接受的模型步骤保持全有或全无。queued 消息被领取时会捕获每个源，因此队列编辑和从 queue 移动到 steer 使用同一路径，无需网关协调。

## 备选方案

**在 Web 客户端内部实现文件发现与语法。** 不予采纳，因为浏览器侧代码无法安全访问宿主工作区，而且重复的语法、排序、边界和失效处理会与宿主提供方产生偏差。

**通过普通文件系统工具 RPC 扫描文件。** 不予采纳，因为递归模糊发现属于编辑器低延迟工作，而不是面向模型的精确文件系统操作；该方案还会把菜单与工具策略及提供方往返绑定。

**选择文件时立即附加其内容。** 不予采纳，因为该方案会在尚未确定相关性时消耗上下文，并绕过可从日志重建、可审计的 `read` 调用／结果序列。

**用普通 `@label` 文本表示会话。** 不予采纳，因为标签既不稳定也不唯一，无法标识源快照。宿主生成的规范提及标记既能保留不透明会话身份，也能保持显示内容易读。

**提示词准入结算前清空输入框。** 不予采纳，因为传输或准入失败会丢失请求唯一可编辑的副本，并在视觉上错误表示一个从未成功的接受操作。

## 验证

包（package）测试固定共享文件语法和排序、缓存失效及生命周期清理、限定在工作区内的 Web 查询、带引号的路径、候选失败、取消、在 pending 与 ready 状态下隐藏 source 标题、文件／目录继续补全、结构化文件引用、完整行内标签、文件图标、禁用状态下的层级归属、跨重新挂载的规范草稿持久化、相邻引用及相邻文本条件下的引用投影、无扩展名文件与句末标点渲染、codec 无损往返、生成的 Remote 类型推断、pre-step 中直接消息先于召回的准备、下游拒绝，以及多词与连续会话标签的后继召回关联。无密钥的装配 Web 快照只渲染工作区文件分组，不显示原始 source 标题，通过真实客户端组合选择文件，排除 Session 候选项，并按直接消息先于召回的顺序回放已有的多词会话召回。

## 后果

Web 使用共享的 `@file` 发现 seam，宿主仍是文件系统访问的权威来源。文件发现是所属服务上的一元 Remote 契约，因此生成的客户端类型会替代手写 RPC 接口，浏览器 bundle 中也不包含 Node API。候选查询失败仍会让菜单静默降级。文件引用只产生路径文本和稳定的条件式指引成本。跨会话引用仍保留 `dsh-session-reference` 所拥有的有界快照开销与信任限定文本，但 Web 用户不会在 `@` 补全中看到它们。
