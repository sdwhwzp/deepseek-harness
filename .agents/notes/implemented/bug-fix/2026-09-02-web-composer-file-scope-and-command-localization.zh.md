# Agent Note: Web 输入框菜单保持本地范围和本地化标签

Status: implemented

[English](2026-09-02-web-composer-file-scope-and-command-localization.md) | 中文

## 问题

Web 输入框的两个菜单泄露了宿主实现细节，而没有保持用户当前界面的语境。界面切换为中文后，斜杠菜单仍显示宿主传来的英文说明；`@` 菜单还把工作区文件与 Session 混在一起，即使该交互只应作为当前工作区的文件选择器。

## 决策

命令客户端在合成候选项时，把 Web 客户端支持的已知宿主命令映射到自身的 locale 字典。每项映射会同时核对命令名与规范英文说明，因此使用已知全局命令名的作用域命令仍保留自身文案。映射覆盖 `compact`、`export`、`feedback`、`goal`、`image`、`permission`、`plan` 和 `read-image`；可选的图片命令仅在对应宿主命令已注册时出现。未知宿主命令保留宿主提供的说明，客户端 contribution 仍自行提供本地化说明。这项决定只收窄 [Web 命令界面与组装](../architecture/2026-07-25-web-command-surfaces-and-assembly.zh.md) 中的展示策略，不改变宿主命令目录。

Web `@` source 只为当前 Session 查询 `fileReferences/list`，仅提供该 Session 工作区下的文件和文件夹。它不再注入、查询或展示 session-reference 候选服务。session-reference 能力与持久 recall 的渲染仍可供其他客户端和既有日志使用；这项决定仅取代 [Web 文件与 Session 引用](../feature/2026-07-27-web-file-and-session-references.zh.md) 中关于 Web 发现流程的部分。

## 验证

包测试固定了已知命令本地化与扩展命令回退、仅含文件的候选依赖、文件选择和目录逐层浏览。无密钥浏览器场景固定了完整的中文命令菜单、`@` 中不存在 Session 行、文件 chip 编辑，以及既有持久 Session recall 的重放。

## 考虑过的替代方案

**在发送前本地化宿主命令说明。** 宿主不知道每个浏览器当前使用的语言，因此单一 wire description 会迫使所有已连接客户端共享一种语言，并要求界面切换语言后重新获取目录。

**保留 Session 候选项，只按 principal 过滤。** 每个宿主 API 仍必须执行 principal 过滤，但 Web 客户端的 `@` 交互被明确限定为当前工作区文件选择器。其他客户端仍可使用规范 Session mention，之前记录的 recall 节点也仍然可用。

## 后果

新增的已知宿主命令需要显式加入客户端字典才会本地化；未知扩展仍使用自身提供的说明。Web 用户不再通过 `@` 发现 Session；文件补全、文件夹逐层浏览、该菜单之外的规范 session-reference 处理，以及持久 recall 重放均保持可用。
