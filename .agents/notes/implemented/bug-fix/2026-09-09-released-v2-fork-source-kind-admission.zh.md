# Agent Note: 接纳本分支已发布 v2 的消息来源种类

Status: implemented

[English](2026-09-09-released-v2-fork-source-kind-admission.md) | 中文

## Problem

本分支安装了 `dsh-at-file` 插件，它在自己贡献的用户消息上写入 `source.kind: 'at-file-mention'`。因此本分支服务器上已发布的 v2 Session 在一个持久且不可变的世代里携带该种类。

v2-to-v3 这条边按封闭清单对消息来源分类，遇到无法识别的种类就拒绝整个 Session——因为它无法分类的来源种类可能藏着必须重映射的 Session 引用。上游从未见过这个插件，其清单缺少该种类，于是每个携带它的 Session 都以 `SessionFormatUnsupportedMigrationError` 拒绝迁移。修复前还原生产语料，实测 57 个 Session 中有 5 个共 13 条这样的消息；这些 Session 在前一世代能打开，在本世代会被拒绝。

## Decision

已发布 v2 来源清单接纳 `at-file-mention`。接纳只做种类分类，不把来源的任何成员解释为 Session 引用，与 agent（智能体）中继归属的接纳方式一致。

原生 V3 完全不对来源种类分类，因此该插件在这条边之外无需接纳，继续原样写入该种类。

## Alternatives considered

**把已存字节改写为受分类的种类。** 否决：已提交世代不可变，且迁移若修补自己的来源，会破坏"前一世代保持可读"这一保证。

**把清单做成可配置。** 否决：接纳集合是关于已写入字节的固定历史事实，不是随部署而变的选择。

**放着被拒绝不管。** 否决：这会在升级时悄悄让用户失去历史，而且在产品报错的那一刻，拒绝与损坏无法区分。

## Consequences

本分支写出的每个已发布 Session 都能在当前世代还原，包括携带[主体身份](../architecture/2026-09-05-principal-authorization-across-013-upstream.zh.md)的那些。

代价是在上游拥有的已发布格式文件里留下一处分支改动：每次上游同步都必须重新施加，而丢掉它的同步只会重新弄坏携带该种类的那些 Session。该接纳只有一个条目，并在改动处点名插件，便于评审者与上游成员区分。

## Testing

`admission.spec.ts` 断言该种类在两个世代都被接纳，与既有用例并列——后者证明一个无关的未知种类在 v2 仍被拒绝、在 v3 被保留，封闭集合依然封闭。改动后还原生产语料，106 个日志全部迁移到 v3（57 个来自 v2，49 个来自 v0），无一拒绝。
