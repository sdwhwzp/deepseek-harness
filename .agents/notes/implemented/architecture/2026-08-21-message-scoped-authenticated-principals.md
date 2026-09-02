# Agent Note: Message-scoped authenticated principals

Status: implemented

English | [中文](2026-08-21-message-scoped-authenticated-principals.zh.md)

## Problem

Remote deployments can authenticate an HTTP request before it reaches Harness, but the runtime previously had no identity value that survived beyond that request. A Session-level “current user” would not solve the problem: multiple authenticated users can share one Session, queued prompts may run later, steering can arrive during another user's turn, and crash recovery replays durable events without the original HTTP connection.

Any mutable Session identity would let the latest visitor determine the owner of earlier queued work. Model spend, tool credentials and filesystem authority would then cross users even though the gateway authenticated every request correctly. Browser-provided identity fields are also unsuitable because the caller can forge them.

## Decision

`AuthenticatedPrincipal` is the common identity value: authentication source, stable subject id, username and `admin` or `user` role. A trusted Host `requestPrincipal` provider authenticates transport-owned data before shared `/api` route selection. The browser payload has no authority to create or replace this value.

Connection validates and freezes a detached principal before selecting an exact route or Remote interceptor, then passes it as the selected RPC handler's process-local fourth argument. Typert Gateway scopes it to one Remote invocation with `AsyncLocalStorage`. A provider rejection returns 401 before an endpoint runs. With no provider, existing local and legacy anonymous behavior remains available.

### Durable message ownership

`session.prompt` snapshots the request principal on the new `UserMessage`. Inbox claims group authenticated messages by `(source, id)` and treat a principal-less `user` source as the anonymous group; principal-less non-user messages remain neutral internal context. The first pending caller group fixes the complete turn, so authenticated, other-user and anonymous work never share a turn identity. An authenticated owner is written to `turn/start` and every `step/start` and is supplied to `agent/pre-step`, `agent/request` and `ToolExecution.principal`.

Identity belongs to the message and its durable events, not to Session, Agent or connection state. Queueing, steering, replay and restart therefore recover the same owner. Tool-generated context takes the execution principal and stays in that turn ahead of racing foreign-group input. Code-mode nested tools and subagent start, browser follow-up, report and settlement paths propagate the same principal; they do not consult a mutable parent-session user.

Legacy events without a principal remain readable. Consumers that require personal authority, including credential-backed tools and personal spend reports, reject undefined principals themselves.

### Trust boundary

The identity remains in a process-local handler argument and is never serialized to a response. The Host validator accepts only bounded non-empty strings and the closed role set, freezes a copy, and ignores identity-looking JSON fields. A deployment authentication plugin may verify signed gateway headers, cookies or another transport mechanism, but only its returned principal enters the runtime.

The principal is identity metadata, not a credential. It carries no password, token, signature or encryption key. The [principal-scoped read authorization](2026-08-29-principal-scoped-read-authorization.md) Service Definition centralizes deployment resource-read decisions; authority-specific consumers still validate source and subject against their own account data before granting access.

## Alternatives considered

**Store the current user on Session or Agent.** This loses message ownership as soon as another user submits to the shared Session and cannot reconstruct queued or replayed work after restart.

**Trust a principal field in browser JSON.** Schema validation cannot establish who authored a self-asserted identity. This would turn every per-user tool and spend check into an impersonation endpoint.

**Keep identity only on the HTTP request.** The request ends before queued turns, later model steps, subagents and crash replay execute, so downstream authorization would be anonymous or would fall back to mutable state.

**Reject every anonymous historical Session.** That would break existing local logs unnecessarily. Compatibility remains at the core event layer, while authority-requiring consumers fail closed.

## Consequences

Shared Sessions can safely interleave authenticated and anonymous callers: event ownership, model-step admission, tool credentials and accounting follow the admitted principal group without anonymous escalation. The cost is a principal field across the message, event, Agent, tool, subagent and transport contracts, plus a deployment-owned authentication provider.

Focused tests pin browser-field stripping, request-local Remote identity, authenticated/anonymous inbox grouping, fixed turn and tool ownership, tool-context attribution and subagent follow-up settlement propagation. Type checking and the generated Cordis catalog pin the cross-package contract. Real reverse-gateway signatures and downstream account policy remain deployment integration responsibilities rather than core authentication logic.
