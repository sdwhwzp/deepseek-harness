# Agent Note: Chat 宽度提示条仅在拖动时显示

Status: implemented

[English](2026-09-11-chat-width-indicator-drag-only.md) | 中文

## Problem

对话内容的宽度把手在悬停时绘制一段竖向渐变条。由于它出现在对话留白区域，用户反复将它误认为位置异常的滚动条。将把手限制在 Chat 中可以避免覆盖插件页面，但 Chat 中仍有这一干扰。

## Decision

[对话外壳](../../../../packages/client/ui-conversation/README.zh.md#shell-and-standard-props)仅在把手带有 `data-dragging` 时显示提示条。悬停保留调整宽度的鼠标指针，不绘制竖条。仅限 Chat 的约束和已保存的宽度偏好继续生效。

## Alternatives considered

**移除宽度把手。**这能移除竖条，但也会移除现有的鼠标调节对话宽度功能。仅在拖动时反馈可以保留这项控制。

## Consequences

悬停时宽度调节入口的视觉提示减弱，正常阅读则不会出现容易混淆的竖条。[浏览器测试](../../../../apps/web/tests/chat-scroll-contract.e2e.ts)覆盖左右两侧、悬停、拖动、松开、宽度保存，以及轨迹页隐藏。合并上游悬停样式时保留这项 fork 适配。
