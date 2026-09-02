# Agent Note: Web profile ships the plugin market

Status: implemented

[English](2026-09-02-web-profile-ships-plugin-market.md) | 中文

## Problem

`dshmarket` 插件市场原本需要在每台机器的本地 web profile 中单独安装。在另一台机器克隆或部署本 fork 时，管理员重复执行安装之前不会出现插件市场。

## Decision

`dshmarket@^1.39.0` 作为 dsh 安装锚点的依赖，随附的 `web` profile 模板则把 `dshmarket` 放在 base 与 web-app 组合包之后。全新 profile 在首次加载时从安装位置解析市场并将其组合进配置。模板只在 profile 不存在时应用，因此已有 profile 会保留自己的组合包列表。

该确定版本不受仓库最小发布时长策略限制，因此有意更新随附市场的部署可以立即安装已评审的版本。

## Verification

app-boot profile 测试会确认随附 web 模板中包含市场。包、依赖、文档与构建后 profile 检查覆盖运行时解析的依赖和组合后的组合包。

## Consequences

本 fork 的全新安装无需单独命令即包含插件市场。CLI 安装会多携带一个第三方运行时依赖，管理员仍可以在已有 profile 中删除或替换该组合包。
