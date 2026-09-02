---
description: "The deployment authorization Service Definition for principal-scoped Session and Workspace reads."
kind: "package-reference"
---

# @deepseek-ai/dsh-principal-access

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-principal-access` defines the Host-only `ctx.principalAccess` Service Definition. It converts a transport-verified `AuthenticatedPrincipal` and candidate Session or Workspace ids into readable subsets. Authenticated deployments provide the implementation from authoritative account data; API controllers consume it. This package does not authenticate requests or include a provider.

## Table of Contents

- [Use this package](#use-this-package)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>

## Use this package

Call `resolvePrincipalAccess(ctx, principal, { sessionIds, workspaceIds }, signal)` once for a candidate batch. List and feed consumers filter with `readableSessionIds` and `readableWorkspaceIds`. Exact reads pass a discriminated `{ kind, id }` to `requirePrincipalAccess`; denial throws `PrincipalAccessDeniedError` with code `PRINCIPAL_ACCESS_DENIED`. Display names and asserted roles are not access grants.

The helper applies these defaults:

| Access provider | Request-auth provider | Principal | Result |
|---|---|---|---|
| absent | absent | absent | Allow requested ids for local-anonymous operation |
| absent | any | present | Reject with `provider-required` |
| absent | present | absent | Reject with `provider-required` |
| present | any | absent | Reject with `principal-required` |
| present | any | present | Return the provider's readable subsets |

A provider implements `PrincipalAccessService.resolve`, validates `(source, id)` against deployment-owned membership data, and omits denied ids. Consumers capture the request principal when a unary call or stream opens and retain that value for the operation. Exact reads authorize before loading contents; live feeds authorize the opening baseline and each later resource-addressed frame.

<a id="further-exploration"></a>
## Further Exploration

- [Session Controller](../../api/session-controller/README.md) — Session list, search, page, follow, and control consumers.
- [Message-scoped authenticated principals](../../../.agents/notes/implemented/architecture/2026-08-21-message-scoped-authenticated-principals.md) — transport identity propagation.
- [Principal-scoped read authorization](../../../.agents/notes/implemented/architecture/2026-08-29-principal-scoped-read-authorization.md) — deployment and defaulting decision.

<a id="model-experience"></a>
## Model Experience

### Principal access resolution

#### What the model sees

Nothing. Authorization metadata does not enter prompts, messages, tools, or results.

#### Token effect

Zero. Resolving `ctx.principalAccess` creates no model request or model-visible content.

#### KV Cache effect

None; authorization metadata never enters the model-visible prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define what deployment integrations must still own. They are current constraints, not a task backlog.

- Harness supplies no account database or concrete provider.
- This Service Definition authorizes reads only; mutation authorization remains with the owning capability.
- The seam has no generic revocation event. Deployment-specific immediate stream termination requires a future provider observation API.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No runtime relationship is asserted. Providers own authorization data and expose no independent observation stream.
