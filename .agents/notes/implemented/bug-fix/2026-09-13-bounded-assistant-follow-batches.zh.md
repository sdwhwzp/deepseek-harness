# Agent Note: 有界 Assistant 跟随批次保留实时鉴权

Status: implemented

[English](2026-09-13-bounded-assistant-follow-batches.md) | 中文

## 问题

如果每个细小的 Assistant 帧都要等待鉴权查询，Agent 完成生成之后，Session 跟随方仍可能落后。部署还可能对每个传输帧执行额外账号检查。排队的文字、持久结算记录和匹配的结束标记因此经过同一条延迟交付路径。加快 React 发布无法消除 Client 收到帧之前的工作。

跟随连接保持打开时仍需要鉴权：账号状态或 Session 可读性变化必须阻止下一次发布。按时间缓存鉴权结果会增加撤销延迟。丢弃中间帧则会损失 Client 结算检查所需的精确流索引和顺序。

## 决策

[Session Controller](../../../../packages/api/session-controller/README.zh.md) 接受同时设置 `assistantStreamBatch: true` 与 `assistantStream: true`，其 Web 适配器请求这两个选项。Host 只把该跟随方队列中已经相邻的瞬态 Assistant 帧合并为 `assistant-stream-batch` 响应。它不等待凑满批次，且绝不让持久事件跨越 Assistant 帧。开场基线、到达截点、持久游标以及提交先于结束的顺序保持原有含义。

每批最多包含 128 帧，包含外层字段和分隔符的完整 JSON 序列化结果最多占用 64 KiB UTF-8 字节。单帧使用标量响应，包括自身大于该字节上限的帧。这些限制约束一次聚合发布，不对单个 Assistant 帧施加新的大小限制，也不约束整个跟随队列的大小。

Host 在发布每个响应之前重新检查 principal-access，批次也不例外。一个批次是一次发布单位，其中各帧不再单独发起查询。账号网关在转发该单位时仍检查当前凭据。任何鉴权结果都不会跨发布缓存。[principal-access 决策](../architecture/2026-08-29-principal-scoped-read-authorization.zh.md)继续定义资源可见性与不完整鉴权组合的处理方式。

Client 按顺序展开每个批次成员，沿用已有 revision、密集 index 和 settlement 校验。优化改变传输外层消息及鉴权决策的数量，不改变底层流成员。未请求批次选项的调用方收到标量帧；未启用 Assistant 流时请求批次选项无效。[内嵌流决策](../architecture/2026-09-01-v2-embedded-assistant-streams.zh.md)仍负责持久 attempt 证据，[按帧合并发布](../testing/2026-08-03-opt-in-reasoning-chunk-browser-stress.zh.md)则独立约束接收后的渲染工作。

发布批次选项时，必须包含由同一份请求声明构建的 Session Controller 与 [API Remotes 装配](../../../../packages/api/remotes/README.zh.md#build-boundary)。API Remotes 内嵌生成的 Client codec：不包含批次字段的装配会在发送请求前移除该字段，即使已安装的 Session Controller 的 Client 与 Host 都支持它。刷新浏览器会加载已安装的装配，无法修复过期的装配产物。

## 测量

组件测量在 macOS、Node.js 22.21.1 的 Vitest 中通过源码运行生产 Session Controller 与历史跟随实现。它提供发布工作的证据，不代表构建产物、网络或浏览器的延迟。并行构建可能影响样本，因此不据此设定时间阈值。

| 字段 | 测量方式 |
|---|---|
| 操作 | 通过 follow 迭代器交付完整的合成 Assistant attempt，保留每帧与持久事件屏障。 |
| 工作负载 | 30 个固定分片、开始与结束帧，以及一条穿插的持久事件；显式 principal 提供方屏障让突发数据排队。 |
| 入口路径 | 生产 `SessionController.follow` 与历史实现；只把 principal 提供方替换为每次检查同步等待 90 ms 的受控实现。 |
| 时钟 | 排除开场快照及其两次鉴权，计时截至结束帧交付，包含操作系统等待取整。 |
| 内存 | 未测量保留内存或峰值内存。 |
| 比较 | 三组交替运行的标量与批次测量使用相同工作负载，并保留完整输出顺序。 |
| 行为 | 计时内鉴权次数从 33 次降至 4 次；包含开场的总次数从 35 次降至 6 次。每次发布仍单独检查。 |

标量样本为 3102.60、3118.87 与 3100.85 ms；批次样本为 409.55、380.44 与 381.19 ms。中位数分别为 3102.60 与 381.19 ms，在该刻意构造的排队负载下，组件性能提高 8.14 倍。这一结果没有测量稀疏流量、模型响应时间、传输交付、Client 归并或绘制。

## 验证

[鉴权回归测试](../../../../packages/api/session-controller/tests/assistant-stream-authorization.host.spec.ts)比较包含 1,610 个分片、开始帧、持久事件屏障与结束帧的完整有序输出。包含开场的检查次数从 1,615 次降至 18 次。原标量实现无法通过检查次数上限断言，批次实现通过。这个基于计数的负向控制不依赖主机计时。

[构建产物 Client 回归测试](../../../../packages/api/remotes/tests/built-lib.e2e.ts)组合运行发布的 Session 适配器、Gateway 与 API Remotes bundle，仅替换 Connection 载体。它检查序列化后的批次选项、每个批次成员的有序接收与取消清理。不包含批次字段的线上装配无法通过传出请求断言。针对完整重建工作区运行测试只验证该产物集合；部署验证还必须覆盖选定的发布产物。

## 考虑过的替代方案

**短时间缓存成功的鉴权结果。** 这能去掉重复查询，但会让已撤销的账号或资源授权在缓存到期前继续有效。批处理对每次发布单位保留当前决策。

**持久消息存在后丢弃排队的增量。** Client 需要匹配的结束标记以及精确 revision 和 index 序列来结算活跃 attempt。跳过这些成员可能隐藏缺口或改变失败 attempt 的展示。

**只合并 React 更新。** 渲染合并发生在接收之后，无法减少 Host 或网关的鉴权调用。它处理的是另一种开销。

**等待计时器凑满批次。** 人为收集时间会降低原本已跟上进度的跟随方的响应速度。只取出已经排队的帧可以分摊积压开销，不给稀疏流量增加等待。

## 影响

存在可合并积压时，慢速鉴权提供方对每次有界发布执行一次查询，而不是对其中每帧分别执行。两次发布之间撤销权限会拒绝下一个完整批次，但无法撤回鉴权已经成功的批次中的成员。稀疏流量可能继续逐帧传输，因此不会从批处理受益。

持久 Session 数据、模型可见内容、工具结果及瞬态证据顺序保持不变。Client 解析和归并仍处理每个原始成员。这项修改不消除同步数据库延迟、不保证浏览器绘制延迟，也不限制跟随队列积压总量。
