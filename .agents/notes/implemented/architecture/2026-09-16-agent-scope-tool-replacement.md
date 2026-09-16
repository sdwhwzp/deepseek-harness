# Agent Note: An Agent scope can replace a tool name its own composition already holds

Status: implemented

## Problem

`ToolLayer` keeps one `NamedEntries` per scope and `NamedEntries.insert` rejects a repeated name. `view()` then lets a scope's own registrations shadow everything it inherits. Together those give a clear rule for two compositions that each believe they own a name: the second one is a bug, and it fails loudly.

They give the wrong answer for a different case. `AgentSessionController.composeAgent` mounts an Agent preset with `presets.mount(agentCtx, id)`, so `dsh-tool-fs`, `dsh-tool-fs-search` and `dsh-tool-bash-persistent` land in the Agent scope. A Session opened on a paired local folder has to run `read`, `write`, `edit`, `glob`, `grep` and `bash` on the user's computer instead of this Host, and `dsh-passwords` attaches them from `agent/created` — after the preset, in the same scope. Every name was refused.

The refusal is not merely a lost capability. The Host-side directory behind a paired folder is an empty placeholder by construction, so the surviving Host tools do not fail: `pwd` answers, `ls` reports an empty directory, and `find` searches the server. The model receives plausible results from the wrong machine and reports that the user's files are missing.

## Decision

`ToolLayer` gains a second table, `overrides`, and `ToolRegistry.override()` writes into it from a scoped context. `view()` applies each layer's overrides directly after that layer's registrations, so a replacement outranks a registration made in the same scope and reaches scopes nested inside it.

`register()` keeps its rule; its duplicate-name error now names the alternative.

## Consequences

A subagent forked from a paired Session inherits the replacement, which is correct: it runs on the same computer as its parent.

The original entry is never removed, so the effect disposer restores the previous owner by itself, and scope disposal unwinds replacements alongside registrations. A second replacement of one name in one scope still fails: two answers to "who owns this name here" is a contradiction, not a merge.

`dsh-passwords` calls `override()` when a Session's cwd matches a paired workspace placeholder, and falls back to `register()` against a profile whose harness predates the method. That fallback records the names it could not attach and states in the `local-workspace-capabilities` context that those tools operate the server, so a stale profile degrades visibly instead of silently.

## Alternatives considered

Letting `register` shadow within a scope erases the signal for genuine double-registration, which is the common case the rule was written for.

`restrict({ deny })` masks inherited names only; the preset's registrations live in the Agent's own layer, which restrictions deliberately do not touch.

Providing a paired `ctx.shell` and `ctx.fs` for the Agent scope is impossible: cordis refuses a service an ancestor already registered (`service "x" has been registered at <root>`). Routing inside the global provider instead would make one plugin the sole shell and filesystem for every Session in the deployment.
