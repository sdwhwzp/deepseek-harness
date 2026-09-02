---
description: "Web 工作区文件 @ 引用 source：当前工作区候选项、目录下钻与原子行内文件引用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-reference

[English](README.md) | 中文

## 概述

`dsh-client-ui-reference` 是 Web 工作区文件 `@` 引用 source：它把 `reference` 条目注册进 composer 的行内建议机制，输入 `@` 时会列出当前会话工作区下的文件与文件夹。每一行只承载能区分它的信息：文件显示其父目录、位于工作区根目录时不显示；下钻后的目录列表不显示位置，因为面包屑已经承载了它。选择一项会插入原子的文件或文件夹引用，其隐藏的序列化与剪贴板形式就是共享 `@path` 语法所定义的自然文本；目录行额外携带钻取动作（Tab 或行尾 chevron），保持可编辑的路径纯文本并让菜单在尾部斜杠处保持活跃，用户可以继续进入下一层。该 source 不查询或显示会话，也不注册任何提示词或工具。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

只要组合挂载了本包且存在宿主 `ctx.fileReferences` 提供方，该 source 即处于活动状态。输入 `@` 后跟一个未加引号的 token 会搜索当前工作区；打开 `@"…` 则会在搜索包含空白的路径时保留引号。候选列表是补全菜单，不是搜索结果页：选一次、继续输入即可。

### 选择后会插入什么

选择文件会关闭补全，并显示为带文件图标与业务色文件名的原子行内引用。目录行携带两个动词：选定 pick（点击行主体或 Enter）把文件夹本身解析为同类原子引用——文件夹图标、带尾斜杠的标签、以规范 `@dir/` mention 为序列化形式；钻取动作（Tab 或行尾 chevron）则保持带文件夹图标的可编辑路径纯文本，并让菜单在尾部斜杠处保持活跃，用户可以继续进入下一层。包含空白的路径使用 `@"path with spaces"`，用户显式打开的引号会继续保留。

### 失败行为

文件查询不可用或失败时不产生候选行。浏览器不会回退扫描自身文件系统。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

该 source 把候选编码保留在注册 effect 内部：`/client` 导出接口只包含插件主体（`apply`/`inject`）。

### 候选流程

浏览器使用当前 session id 调用 `fileReferences/list`，宿主在该会话的 `cwd` 下解析候选项。各行渲染在一个不可选择的文件分组标题下，不显示重复的原始 `reference` source 标题。下钻后的查询会发布一条从工作区根目录到当前所列目录的面包屑；每一节携带的下钻载荷与文件夹行相同，因此「回到某一步」与「进入某一层」是同一个结果。

### 序列化

文件选择把共享 `@path` 语法所定义的自然文本保留为隐藏的序列化与剪贴板形式。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

以下页面覆盖建议机制、文件引用能力与输入流水线。

- [ui-input-trigger](../ui-input-trigger/README.zh.md)——该 source 注册进的行内建议机制。
- [file-reference](../../context/file-reference/README.zh.md)——`@file` seam 及其提供方约定。
- [Web 输入机器与 slash 流水线](../../../.agents/notes/implemented/architecture/2026-07-25-web-input-machine-and-slash-pipeline.zh.md)——引用与命令如何共享输入机器。

-----

<a id="model-experience"></a>
## 模型体验

间接影响模型体验：通过宿主拥有的文件引用提供方，本包把路径指引委托给该提供方。

#### KV Cache 影响

浏览候选项不会影响模型。选择文件只会改变新用户消息的后缀；文件内容仍由面向模型的 `read` 工具读取。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明引用 source 何时帮不上忙；它们是当前包约束。

- **候选失败有意保持静默**：Remote 发现调用不可用或失败时不产生候选行。
- **浏览器侧不扫描文件**：Web 补全需要挂载宿主 `ctx.fileReferences` 提供方；浏览器无法回退到自身文件系统。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。插件只注册一个 reference/input-trigger source，HMR 测试覆盖释放；它不发出 Cordis 事件，也不持有跨插件可变状态。
