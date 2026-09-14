# Agent Note: Hide retained todo plans in idle conversations

Status: implemented

English | [中文](2026-09-14-idle-todo-dock.zh.md)

## Problem

An assistant can finish its answer without writing a final todo list. Showing the retained list above the composer makes its in-progress animation look like an executing task after the Session has stopped.

## Decision

The conversation todo dock reads the Session running state alongside the todo projection and renders only while running. Opening an idle Session also hides the dock. The projection and persisted events retain their original task statuses.

## Alternatives considered

**Mark every todo completed at turn end.** A completed answer does not prove every planned task succeeded; this would fabricate task outcomes.

**Clear the todo projection on turn end.** Historical consumers may need the last recorded plan. Visibility belongs to the conversation dock and does not require changing the shared projection.

## Consequences

Idle conversations have no todo strip above the composer. Returning to a running Session mounts a collapsed panel. The dock does not provide an idle plan browser; historical tool records remain available. Component regressions cover live settlement with an unfinished list, initial idle rendering, and remounting without mutating statuses.
