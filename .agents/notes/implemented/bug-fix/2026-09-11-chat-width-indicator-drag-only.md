# Agent Note: Chat width indicators appear only during dragging

Status: implemented

English | [中文](2026-09-11-chat-width-indicator-drag-only.zh.md)

## Problem

The transcript width handle paints a short vertical gradient on hover. Readers repeatedly mistake it for a misplaced scrollbar because it appears inside the conversation margin. Restricting handles to Chat prevents overlap with plugin pages but leaves this distraction in Chat.

## Decision

The [conversation shell](../../../../packages/client/ui-conversation/README.md#shell-and-standard-props) displays the indicator only while the handle carries `data-dragging`. Hover retains the resize cursor without painting a bar. The Chat-only restriction and persisted width preference remain in force.

## Alternatives considered

**Remove width handles.** This removes the artifact but also removes the existing pointer control for transcript width. Drag-only feedback preserves that control.

## Consequences

Width adjustment is less visually discoverable on hover, while ordinary reading stays free of the ambiguous bar. [Browser coverage](../../../../apps/web/tests/chat-scroll-contract.e2e.ts) checks both sides, hover, dragging, release, persistence, and exclusion from Trajectory. Keep this fork adaptation when merging upstream hover styling.
