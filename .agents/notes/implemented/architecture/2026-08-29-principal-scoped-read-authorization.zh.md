# Agent Note: 限定 principal 范围的读取授权

Status: implemented

[English](2026-08-29-principal-scoped-read-authorization.md) | 中文

## 问题

[消息作用域 principal 决策](2026-08-21-message-scoped-authenticated-principals.zh.md)确定是谁发起了一条已认证 Host 请求，但身份传播不能确定该身份可以读取哪些持久 Session 或 Workspace。Session 列表、搜索、历史与实时 control producer 可以枚举整个进程或持久化范围的数据。如果只是把 `AuthenticatedPrincipal` 传过这些调用，而没有部署拥有的资源判定，仍会返回其他账户的数据。

Harness 不能根据 `role` 或 `username` 推导该判定。两者都是认证提供方为展示或宽泛策略给出的断言，都不能证明某一资源的成员关系。Harness 也不拥有部署的账户、组织或共享数据库。与此同时，未配置的本地部署历来不做认证，必须保留这种本地匿名行为。

## 决策

`@deepseek-ai/dsh-principal-access` 是 Host 读取授权的 Service Definition。`PrincipalAccessService.resolve` 接受传输层已验证的 principal 以及一批 branded Session 与 Workspace id，只返回 `readableSessionIds` 和 `readableWorkspaceIds`。认证部署挂载一个 Service Provider，针对自身权威账户与成员关系数据验证 principal 的 `(source, id)` 对。Host API 包是 Consumer；它们不导入提供方特定的账户类型。

`resolvePrincipalAccess` 拥有一套明确的默认矩阵。只有请求认证提供方、principal 与访问提供方都不存在的组合才把所有请求 id 视为可读，从而保留本地匿名操作。存在 principal 或请求认证提供方却缺少访问提供方时以 `provider-required` 关闭式失败；这也包括认证提供方没有为当前请求返回 principal 的情况。存在访问提供方但 principal 缺失时以 `principal-required` 关闭式失败。Principal 与访问提供方都存在时，只有提供方返回的 id 可读。`requirePrincipalAccess` 会把一个带判别字段的精确 Session 或 Workspace subject 被省略转换成 `PrincipalAccessDeniedError`，其稳定 code 为 `PRINCIPAL_ACCESS_DENIED`，reason 为 `subject-denied`。

结果是一对集合，而不是逐资源 boolean API。Consumer 可以对候选语料库执行一次授权查询，并保留自身的顺序与分页。Service Definition 在有类型的同进程边界上信任提供方；提供方拥有数据库与 principal source 校验，而且绝不能仅凭展示用 `username` 或断言的 `role` 授权。

### Session 读取

Session Controller 在一元调用或 stream 打开时捕获一次 API Gateway principal。每个指向既有 Session 的 Remote 操作都会先应用相同的可读性检查，再读取、恢复或变更它。`session.list` 在摘要投影与冷工件探测前授权候选 id。`session.search` 在内容查询与 ranked pagination 前收窄候选项，因此被拒绝的结果既不会泄露，也不会占用响应 limit。Page、附件与 skill 读取在观测日志前授权；direct subagent address 对其普通父 Session 授权，随后继续执行独立的持久父子关系校验。文件引用补全会先授权 wire Session id，再解析或恢复其 Agent。

`session.follow` 会在观测日志前以及每个 frame 发布前授权，因此撤权会阻止下一条 frame 发布。`session.control` 过滤 opening baseline 中的全部三张 map，并在 yield 此后每个按 Session 寻址的 frame 前解析权限。因此授权同时覆盖初始状态与实时事件；只过滤 baseline 会泄露此后的全局 queue、job 或 projection 更新。

### Workspace 读取

Workspace Controller 在 `workspace.follow` 打开时捕获 Gateway principal。其 baseline 按 Workspace 访问权限过滤 Workspace 行，按 Session 访问权限过滤每行的 Session 成员以及已归档 Session id。此后的 upsert 与 archived snapshot 会再次解析权限；若一个已可见的 Workspace 在 upsert 时不再获准，该 upsert 会变为 `remove`，而 order 与 removal frame 只会指向该 stream generation 已披露的 Workspace。

Workspace 变更会在写入前要求每个既有 Workspace、Session 与排序锚点可读。带读取内容的变更结果会把 Workspace 成员、全局顺序与归档集合过滤为调用方可读 id。解析已注册路径时会隐藏被拒绝的 Workspace；真正新建 Workspace 时尚无既有 subject，因此只校验 principal/provider 组合完整。目录准入与归属分配仍属于部署策略。

### Session 日志导出

精确的 `/api/session.export` Fetch 路由接收传输层 principal，并在追踪 lineage 前授权根 Session。请求包含后代时，它会在 flush 或读取任何原始产物或附件前授权完整的后代集合。资源被拒绝时返回与 Session 不存在相同的 not-found 响应；principal 存在但缺少 provider 时返回服务不可用，provider 支持的请求缺少 principal 时返回未授权。全有或全无检查可防止产生部分归档。

### 转发的 Remote 事件

API Remotes 根据 Session Controller 通知声明的 Session 参数附加只存在于进程内的 `readSubjects`。Gateway 针对每个已连接 Client 的 principal 独立解析这些 subject，并且仅在全部具名 Session 或 Workspace 可读时才将通知入队。能归因到请求的普通事件还要求 principal 完全匹配；只有既无身份归因也无 read subject 的通知才会全局广播。这两个进程内字段都不会进入 Remote 事件 wire frame。

## 考虑过的替代方案

**只传播 principal，不提供业务授权服务。** 这能识别调用方，却仍允许每个全局 producer 返回全部持久数据，也就是原始暴露。

**根据 `role` 或 `username` 授权。** 这些字段不能证明资源成员关系，username 可能变化或在不同认证 source 间冲突，宽泛 role 也不是所有权记录。

**把账户与所有权放进 Harness core。** 部署已经拥有不同的账户与共享模型。Core 数据库会复制其权威数据，并把 harness 耦合到一种 tenancy 方案。

**让每个 API 包定义自己的提供方 callback 与默认行为。** 各自的默认行为会漂移，尤其是提供方/principal 只配置一半的情况；部署 adapter 也需要为同一账户策略集成多个无关接口。

**拒绝所有匿名本地读取。** 这会通过破坏受支持的本地部署模式来保护认证部署。默认矩阵还会检查是否挂载了请求认证，从而区分有意的本地进程与不完整的认证部署。

## 后果

该能力包含全部三个角色：稳定的 Harness Service Definition、部署拥有的 Service Provider，以及 Host API Consumer。认证部署在身份或授权任一缺失时关闭式失败，未改变的本地匿名组合则继续工作。批量结果支持 baseline、filter 与后代式 Consumer，且无需把账户逻辑嵌入数据服务。

代价是每个一元候选 batch 与每个适用的实时 Session、Workspace 或 Remote-event frame 都要执行授权查询。服务没有通用撤销事件，因此已打开的 Consumer 会重新检查此后 frame，却不会在空闲时主动终止。Session 与 Workspace 变更把可读性作为必要的资源可见性前置条件，而不是执行该动作的权限；部署与命令能力仍拥有变更授权。

聚焦测试固定本地与不完整认证默认行为、提供方委托、精确 Session 与 Workspace 拒绝、取消、观测前 Session 过滤、follow 撤权、Session 命令门禁、Workspace feed 与变更过滤、全有或全无的导出授权，以及每 Client 的 Remote-event 投递。包类型检查固定 branded 跨包 API。
