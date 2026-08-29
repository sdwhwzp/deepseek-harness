---
description: "identity 包组：部署 principal 授权与匿名按 harness home 关联 id。"
kind: "package-group"
---

# identity/ — 身份与访问

[English](README.md) | 中文

## 概述

identity 组拥有两种不同的 Host 身份：供遥测与反馈使用的随机按 harness home 关联 id，以及把传输层已验证 principal 映射到可读 Session 与 Workspace id 的部署授权 seam。匿名 id 无需配置。认证部署挂载由权威账户数据支持的自有 principal-access 提供方；本地匿名部署在没有该提供方时保留原有读取。本页映射这两个包，每个包 README 负责自身细节。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

<a id="packages"></a>
## 包

| 包 | 职责 |
|---|---|
| [`anonymous-user-id`](anonymous-user-id/README.zh.md) | 让每个 harness home 拥有一个匿名 id，遥测、反馈与 DeepSeek 请求把它附加到记录上，使来自同一安装的记录无需识别用户即可被辨认 |
| [`principal-access`](principal-access/README.zh.md) | 定义部署授权服务、严格的本地匿名默认行为，以及供 Host API 使用的批量 Session/Workspace 读取判定 |

<a id="related-documentation"></a>
## 相关文档

- [会话遥测子系统](../../docs/subsystems/session-telemetry.zh.md)——在导出中携带该 id 的遥测功能。
- [dsh-llm-deepseek](../llm/llm-deepseek/README.zh.md)——在请求中携带该 id 的 DeepSeek 提供方。
- [dsh-command-feedback](../feedback/command-feedback/README.zh.md)——在确认文本中点名该匿名安装的反馈命令。
- [Session Controller](../api/session-controller/README.zh.md)——针对限定 principal 范围的列表、历史与实时状态的 Session 读取 Consumer。

<a id="dev-note"></a>
## 开发备注

无。
