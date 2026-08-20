# Agent Note: Web profile ships the plugin market

Status: implemented

[English](2026-08-20-web-profile-ships-plugin-market.md) | 中文

## Problem

`dshmarket` 插件市场是一个 web profile 插件，需通过 `dsh plugin --profile web add dshmarket` 在每台机器上单独安装。其组合包列表存放在 Harness home 下的 `~/.dsh/profiles/web/package.json`，git 并不跟踪该目录，因此换一台电脑克隆本仓库后不会自带市场，每次都要重复手动安装步骤。

## Decision

`dshmarket@^1.15.0` 是 `apps/cli`（dsh 安装锚点）的依赖，`dsh-app-boot` 中的 `PROFILE_TEMPLATES.web` 为 `['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dshmarket']`。因此全新的 `web` profile 首次加载时会自动初始化并带上插件市场组合包，该组合包从安装锚点（`apps/cli`，pnpm 在那里安装它）解析。已有 profile 保留各自的 `dsh.profile.bundles` 列表——模板只在 profile 目录尚不存在时生效。

`knip.json` 在 `apps/cli` 中忽略 `dshmarket`，因为 Loader 是在运行时解析该组合包，而非通过静态导入。根 `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 记录了当前市场版本，与 profile 工作区自身的供应链策略保持一致。

## Alternatives considered

- **把仓库内的 profile 目录提交并重定向 `DSH_HOME`。** 把 profile 的 `package.json`、patch 与 workspace 配置纳入 git 可以让市场留在仓库里，但每台机器仍需设置 `DSH_HOME` 并重装 `node_modules`；市场仍然没有随产品一起分发。
- **把安装步骤写进文档或脚本。** 一行 setup 说明是最轻量的改法，但全新 clone 上仍然没有市场，而这正是本决策要消除的差距。
- **把 `dshmarket` 加进 `dsh-web-app` 组合包。** 把社区插件面烘焙进模式组合包，会让所有使用该应用组合包的消费者都依赖它；作为 profile 模板层则可以让 profile 通过编辑 `dsh.profile.bundles` 移除或替换市场。

## Verification

`dsh-app-boot` 的 profile 测试钉住了 `PROFILE_TEMPLATES.web` 的随附列表及其自动初始化；在全新 `DSH_HOME` 下执行 `dsh --profile web --dump-config` 会把 `dshmarket` 层组合进配置树。

## Consequences

本 fork 上每个全新的 web profile 都无需安装步骤即可打开插件市场，版本化的依赖随仓库跨机器流转。dsh 安装现在依赖一个第三方 npm 包；市场的可选 peer `@deepseek-ai/dsh-settings` 会通过安装闭包解析，因为 `dsh-web-app` 已经间接依赖它。市场的新版本通过常规的依赖升级到达；每个新发布的版本在超过发布日期门槛前，需要一条 `minimumReleaseAgeExclude` 记录。
