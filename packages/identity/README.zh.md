---
description: "identity 包组：部署主体授权，以及按 harness home 共享的匿名关联 id。"
kind: "package-group"
---

# identity/ — 部署身份与匿名身份

[English](README.md) | 中文

## 概述

identity 组定义按主体授权 Session 与 Workspace 读取的部署接口，并为每个 harness home 提供一个供遥测、反馈与 DeepSeek 请求使用的匿名 id。会认证调用方的部署需要提供授权实现；未挂载认证和授权服务的本地单用户组合保持原有匿名访问行为。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

<a id="packages"></a>
## 包

| 包 | 职责 |
|---|---|
| [`anonymous-user-id`](anonymous-user-id/README.zh.md) | 让每个 harness home 拥有一个匿名 id，遥测、反馈与 DeepSeek 请求把它附加到记录上，使来自同一安装的记录无需识别用户即可被辨认 |
| [`principal-access`](principal-access/README.zh.md) | 解析传输层已验证主体可读取的 Session 与 Workspace id，并在认证组合不完整时默认拒绝 |

<a id="related-documentation"></a>
## 相关文档

- [会话遥测子系统](../../docs/subsystems/session-telemetry.zh.md)——在导出中携带该 id 的遥测功能。
- [dsh-llm-deepseek](../llm/llm-deepseek/README.zh.md)——在请求中携带该 id 的 DeepSeek 提供方。
- [dsh-command-feedback](../feedback/command-feedback/README.zh.md)——在确认文本中点名该匿名安装的反馈命令。

<a id="dev-note"></a>
## 开发备注

无。
