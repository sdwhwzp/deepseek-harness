# Agent Note: Carrying the delegating step's owner into a workflow's children

Status: implemented

English | [中文](2026-09-09-delegated-turn-ownership.zh.md)

## Problem

A workflow script fans work out to subagents. Each child runs in its own session, and its turns record no authenticated owner: the spawn path never received one, so `turn/start` had none to write.

The fork attributes usage, per-account budgets and session visibility to the owner a turn records. A delegated turn therefore charges nobody and hides from the operator who started it, while identical work run directly in the parent session charges and displays normally. On the deployment that surfaced this, one analysis delegated 42 of its 48 model calls, so the visible cost was an eighth of the real one and the operator's own sessions were missing from their list.

The delegation tool already passed `exec.principal` into `subagents.start`; only the workflow engine's path omitted it. `SubagentStartRequest.principal` existed and was documented as persisted on the child's prompt, so the gap was one unset field carried across three packages, not a missing capability.

## Decision

`WorkflowStartRequest` carries an optional `principal`. The workflow tool fills it from `exec.principal`, the worker-thread engine holds it for the run's lifetime, and every `subagents.start` the run issues passes it through. A run started without an owner — a non-agent caller — leaves its children unowned rather than substituting one.

## Alternatives considered

**Record the owner on the child session header.** Rejected: the header is a released format validated against an exact member set, so a new member is a format change requiring a migration edge and refusing older readers — a heavy answer to a field the prompt already carries.

**Resolve ownership at read time from `parentSession`.** Kept, but as accounting repair rather than the fix: [dsh-spend does exactly this](https://github.com/sdwhwzp/dsh-spend) so history already recorded without an owner still bills correctly. It cannot help a consumer that reads the session log directly, and a log that records who ran a turn is worth more than every reader re-deriving it.

## Consequences

Delegated turns now carry the same owner as the step that delegated them, so accounting, budgets and session visibility treat a workflow like the work it replaced.

Only turns started after this ships record it. Sessions already written stay unowned in the log; a consumer that needs their ownership resolves it through the delegation chain.

## Testing

`workflow-worker-thread.spec.ts` asserts that both children of a two-agent script receive the run's owner, and that a run started without one leaves its children unowned instead of guessing.
