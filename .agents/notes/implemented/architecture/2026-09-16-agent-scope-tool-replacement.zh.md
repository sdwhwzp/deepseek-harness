# Agent Note: Agent 作用域可以替换自己的组合已经持有的工具名

Status: implemented

[English](2026-09-16-agent-scope-tool-replacement.md) | 中文

## Problem

`ToolLayer` 为每个作用域保留一份 `NamedEntries`，`NamedEntries.insert` 拒绝重复的名字。`view()` 随后让作用域自己的注册遮蔽它继承来的一切。两者合起来，对「两个都以为自己拥有某个名字的组合」给出了明确规则：第二个是 bug，而且会显式报错。

对另一种情形它们给出的答案是错的。`AgentSessionController.composeAgent` 用 `presets.mount(agentCtx, id)` 挂载 Agent 预设，于是 `dsh-tool-fs`、`dsh-tool-fs-search`、`dsh-tool-bash-persistent` 落进 Agent 作用域。在配对本机目录上打开的 Session 必须让 `read`、`write`、`edit`、`glob`、`grep`、`bash` 跑在用户电脑上而不是本 Host，而 `dsh-passwords` 在 `agent/created` 里挂接它们——晚于预设、在同一个作用域。每一个名字都被拒绝了。

这个拒绝不只是丢了能力。配对目录背后的 Host 侧目录按构造就是一个空占位目录，所以留下来的 Host 工具不会报错：`pwd` 有返回、`ls` 报告一个空目录、`find` 在服务器上搜索。模型从错误的机器拿到看似合理的结果，并报告用户的文件不存在。

## Decision

`ToolLayer` 新增第二张表 `overrides`，`ToolRegistry.override()` 从一个带作用域的上下文写入它。`view()` 在每层的注册之后紧接着应用该层的替换，于是替换的排位高于同作用域内的注册，并触及嵌套在其内部的作用域。

`register()` 规则不变；它的重名报错现在指出了替代做法。

## Consequences

从配对 Session 派生的子 Agent 继承该替换，这是正确的：它和父 Agent 跑在同一台电脑上。

原注册项从不删除，因此 effect 的 disposer 自己就能还原上一个所有者，作用域释放时也会把替换和注册一起回卷。同一作用域内第二次替换同一个名字仍然失败：「这个名字在这里归谁」有两个答案是矛盾，不是合并。

`dsh-passwords` 在 Session 的 cwd 命中配对工作区占位目录时调用 `override()`，对 harness 早于该方法的 profile 回退到 `register()`。该回退会记录它没能挂上的名字，并在 `local-workspace-capabilities` 上下文里说明这些工具操作的是服务器，从而让过期的 profile 可见地降级而不是无声降级。

## Alternatives considered

让 `register` 在作用域内遮蔽，会抹掉真正重复注册的信号，而那正是这条规则本来要防的常见情形。

`restrict({ deny })` 只能遮蔽继承来的名字；预设的注册位于 Agent 自己那一层，而限制有意不触及那一层。

为 Agent 作用域提供一份配对的 `ctx.shell` 与 `ctx.fs` 是不可能的：cordis 拒绝一个祖先已经注册过的服务（`service "x" has been registered at <root>`）。改在全局 provider 内部路由，则会让一个插件成为该部署里每个 Session 唯一的 shell 和文件系统。
