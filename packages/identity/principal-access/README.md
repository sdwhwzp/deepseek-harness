---
description: "The deployment authorization Service Definition for principal-scoped Session and Workspace reads."
kind: "package-reference"
---

# @deepseek-ai/dsh-principal-access

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-principal-access` defines `ctx.principalAccess`, the Host-only authorization service that turns a transport-verified `AuthenticatedPrincipal` and candidate Session or Workspace ids into readable subsets. It also exports the single defaulting helper `resolvePrincipalAccess` and the exact-resource check `requirePrincipalAccess`. The package is the Service Definition; an authenticated deployment supplies a Service Provider backed by its authoritative account data, while API controllers are Consumers. It does not authenticate requests or ship a provider.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Consumers call `resolvePrincipalAccess(ctx, principal, { sessionIds, workspaceIds }, signal)` once for a candidate batch. Its `PrincipalAccessResult` contains `readableSessionIds` and `readableWorkspaceIds`; list and feed Consumers filter by those sets, while exact-resource Consumers pass one discriminated `{ kind, id }` value to `requirePrincipalAccess`. A denied exact resource throws `PrincipalAccessDeniedError` with code `PRINCIPAL_ACCESS_DENIED`, reason `subject-denied`, and the denied subject. Display `username` and asserted `role` are never access grants.

The helper owns the complete deployment default:

| Access provider | Request-auth provider | Principal | Result |
|---|---|---|---|
| absent | absent | absent | Allow every requested id for local-anonymous legacy operation |
| absent | any | present | Fail closed with `provider-required` |
| absent | present | absent | Fail closed with `provider-required` |
| present | any | absent | Fail closed with `principal-required` |
| present | any | present | Return only the provider's readable subsets |

A provider implements `PrincipalAccessService.resolve`. It validates the principal's `(source, id)` pair against deployment-owned account and membership records, evaluates every requested id, and omits denied ids. The verified principal is identity metadata, not proof that a named resource belongs to that identity. Providers should honor the supplied abort signal and must not infer ownership from `username` or `role` alone.

Consumers capture the message-scoped principal once when a unary call or stream is opened, then use that value for the operation's lifetime. A list resolves all candidate ids before returning rows. A live feed filters its opening baseline and resolves each later resource-addressed frame, so a global producer never becomes a global response. An exact read resolves access before loading resource contents; a subagent-addressed read uses its ordinary parent Session as the authorization subject and still performs its independent parent-child validation.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The service deliberately returns sets instead of one boolean: list, search, baseline, descendant-export, and workspace-feed Consumers can make one deployment lookup for a candidate batch and preserve their own ordering and pagination. Session and Workspace ids remain branded across the Service Definition. The helper applies defaults before calling a provider and checks cancellation both before and after the asynchronous decision. Provider results are trusted at this typed same-process boundary; wire and database validation remain provider responsibilities.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Service Definition, request/result vocabulary, strict default resolver, and exact-resource denial |
| [`src/invariant.ts`](src/invariant.ts) | Empty invariant companion; deployment providers own the authoritative observations |
| [`tests/service.spec.ts`](tests/service.spec.ts) | Default matrix, provider delegation, exact grants, cancellation, and Cordis registration |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Session Controller](../../api/session-controller/README.md) — one Consumer covering Session list, search, page, follow, and control reads.
- [Message-scoped authenticated principals](../../../.agents/notes/implemented/architecture/2026-08-21-message-scoped-authenticated-principals.md) — how verified identity reaches Host business services.
- [Principal-scoped read authorization](../../../.agents/notes/implemented/architecture/2026-08-29-principal-scoped-read-authorization.md) — the deployment and defaulting decision behind this seam.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

-----

<a id="model-experience"></a>
## Model Experience

### Host read filtering

#### What the model sees

Nothing. `ctx.principalAccess` filters Host API reads and does not add prompts, tools, messages, or result text.

#### Token effect

None. Authorization decisions and denied resources never enter a model request.

#### KV Cache effect

None. The service does not alter a model request prefix.

## Known Limitations and Deferred Work

- The harness ships no account database or concrete Service Provider; authenticated deployments must mount one.
- The Service Definition authorizes reads only. Mutation authorization remains with the business capability that owns each command.
- A live Consumer rechecks addressed frames but does not receive a generic revocation event; deployment-specific immediate stream termination requires a future provider observation API.
