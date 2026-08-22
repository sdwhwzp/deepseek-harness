# Agent Note: 消息作用域的认证 principal

Status: implemented

[English](2026-08-21-message-scoped-authenticated-principals.md) | 中文

## 问题

远程部署可以在 HTTP 请求进入 Harness 前完成认证，但运行时过去没有能够活过这条请求的身份值。Session 级“当前用户”无法解决问题：多个已认证用户可以共享一个 Session，排队提示词可能稍后才运行，中途引导可能在另一用户的轮次中抵达，而崩溃恢复会在原 HTTP 连接已经消失后回放持久事件。

任何可变的 Session 身份都会让最后一位访问者决定更早排队工作的归属。即使网关正确认证了每条请求，模型消费、工具凭据和文件系统权限仍会串到其他用户。浏览器提交的身份字段也不能使用，因为调用方可以伪造。

## 决策

`AuthenticatedPrincipal` 是通用身份值：认证来源、稳定主体 id、用户名，以及 `admin` 或 `user` 角色。可信 Host `requestPrincipal` 提供方在共享 `/api` 路由选择前认证传输层持有的数据。浏览器载荷无权创建或替换该值。

Connection 将已验证且冻结的 principal 绑定到一条进程内 Request。API Proxy 把它复制到仅 Host 可写的 `RpcRequest.principal`；Typert Gateway 用 `AsyncLocalStorage` 将它限定在一条 Remote 调用内。提供方拒绝会在 API Proxy 方法或被拦截 Remote 方法运行前返回 401。未配置提供方时，既有本地与遗留匿名行为继续可用。

### 持久消息归属

`session.prompt` 将请求 principal 快照到新 `UserMessage`。Inbox 按 `(source, id)` 对已认证消息分组认领，因此一个轮次不会批处理两个用户。选中的消息 principal 随后写入 `turn/start` 和每个 `step/start`，并传给 `agent/pre-step`、`agent/request` 与 `ToolExecution.principal`。

身份属于消息及其持久事件，而不属于 Session、Agent 或连接状态。排队、中途引导、回放与重启因此都恢复同一归属者。Code-mode 嵌套工具，以及 subagent 的启动、跟进、报告和结算路径都会传播同一 principal；它们不会查询可变的父 Session 用户。

没有 principal 的遗留事件仍可读取。需要个人权限的消费方（包括凭据工具与个人消费报告）自行拒绝 undefined principal。

### 信任边界

身份绑定使用进程内 symbol，绝不序列化到响应。Host 校验器只接受有界非空字符串和封闭角色集合，冻结副本，并忽略 JSON 中看似身份的字段。部署认证插件可以验证签名网关头、Cookie 或其他传输机制，但只有它返回的 principal 会进入运行时。

Principal 是身份元数据，不是凭据；它不携带密码、token、签名或加密密钥。授权消费方仍须对照自己的账号数据库验证来源与主体，之后才能授予访问。

## 考虑过的替代方案

**把当前用户放到 Session 或 Agent。** 另一用户向共享 Session 提交后，消息归属立即丢失；重启后也无法重建排队或回放工作的身份。

**信任浏览器 JSON 中的 principal 字段。** Schema 校验无法证明自报身份的作者，这会让每个按用户工具和消费检查都变成冒充端点。

**身份只留在 HTTP 请求上。** 排队轮次、后续模型步骤、subagent 和崩溃回放执行前，请求早已结束；下游授权只能匿名或退回可变状态。

**拒绝所有匿名历史 Session。** 这会无谓破坏现有本地日志。核心事件层保留兼容，需要权限的消费方则快速失败。

## 后果

共享 Session 可以安全交错多个已认证用户：事件归属、模型步骤准入、工具凭据和计费都跟随原始消息。代价是在消息、事件、Agent、工具、subagent 和传输约定中加入 principal 字段，并要求部署提供认证方。

聚焦测试固定了浏览器字段剥离、请求局部 Remote 身份、混合 principal 的 Inbox 认领、持久 turn/step 事件和 subagent 传播。类型检查与生成的 Cordis catalog 固定跨包约定。真实反向网关签名与下游账号策略仍属于部署集成职责，而不是核心认证逻辑。
