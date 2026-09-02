# Agent Note: Web composer menus keep local scope and localized labels

Status: implemented

English | [中文](2026-09-02-web-composer-file-scope-and-command-localization.zh.md)

## Problem

Two Web composer menus exposed Host implementation details instead of the user's local context. The slash menu showed English Host descriptions after the interface switched to Chinese, and the `@` menu mixed workspace files with sessions even where that interaction was intended to be a current-workspace file picker.

## Decision

The command client maps known Host commands supported by the Web client to its locale dictionary when it synthesizes candidates. Each mapping requires both the command name and its canonical English description, so a scoped command that shadows a known global name keeps its own copy. The mapping covers `compact`, `export`, `feedback`, `goal`, `image`, `permission`, `plan`, and `read-image`; the optional image commands appear only when the corresponding Host commands are registered. An unknown Host command retains the description supplied by the Host, and client contributions continue to own their localized descriptions. This narrows the presentation choice in [Web command surfaces and assembly](../architecture/2026-07-25-web-command-surfaces-and-assembly.md) without changing the Host command directory.

The Web `@` source queries only `fileReferences/list` for the current session and offers only files and folders beneath that session's workspace. It does not inject, query, or render the session-reference candidate service. The session-reference capability and durable recall rendering remain available to other clients and existing logs; this decision supersedes only the Web discovery portion of [Web file and session references](../feature/2026-07-27-web-file-and-session-references.md).

## Verification

Package tests pin known-command localization with extension fallback, file-only candidate dependencies, file picks, and directory drilling. Keyless browser scenarios pin the complete Chinese command menu, the absence of session rows from `@`, file-chip editing, and replay of an existing durable session recall.

## Alternatives considered

**Localize Host command descriptors before sending them.** The Host does not know each browser's active locale, so one wire description would force every connected client to share a language and would require a directory refetch after a locale change.

**Filter session candidates instead of removing them from the Web menu.** Principal filtering remains required for every Host API, but the Web client's `@` interaction is deliberately a current-workspace file picker. Other clients can still use canonical session mentions, and previously recorded recall nodes remain usable.

## Consequences

Every new known Host command needs an explicit client dictionary entry to become localized; unknown extensions remain usable with their supplied text. Web users no longer discover sessions through `@`, while file completion, folder drilling, canonical session-reference processing outside this menu, and durable recall replay remain intact.
