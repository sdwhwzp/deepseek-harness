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

Attachment reads also pass `attachmentIds` to `resolve` and require the corresponding `readableAttachmentIds` grant. Omitting that result field denies every attachment, including with an older Session/Workspace-only provider. Session readability and a reference appearing in Session history are not attachment grants. Providers key grants by verified `(source, id)` and attachment id; display metadata does not alter ownership.

Before accepting uploaded prompt content, Session Controller and browser subagent prompts call `recordPrincipalAttachments`, which invokes `PrincipalAccessService.recordAttachments(principal, { sessionId, attachmentIds }, signal)`. These ids come only from validated inline bytes or upload receipts resolved for the exact receiving Session; browser subagent uploads use the authorized parent Session. The provider must revalidate account and Session ownership and record every grant durably and idempotently. Shared content-addressed bytes may have independent grants for multiple uploading accounts. Failure prevents inbox delivery; already stored immutable bytes may remain unreferenced. An older provider's default method fails with `attachment-provider-required`. No provider is needed in a wholly local-anonymous composition.

Before upgrading a shared account deployment, backfill preexisting attachment grants from trusted ownership evidence. Do not lazily grant an arbitrary requested reference merely because it appears in a readable Session: earlier clients could inject references. Ambiguous ownership must remain denied until an operator resolves it. Uploads staged but not yet accepted by a prompt have no grant from this core hook; browser upload previews use their local bytes. Snapshot ownership data with Session and attachment storage for rollback.

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
- This Service Definition resolves reads and records trusted upload ownership; other mutation authorization remains with the owning capability.
- The seam has no generic revocation event. Deployment-specific immediate stream termination requires a future provider observation API.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No runtime invariant companion is published because providers own authorization data and expose no independent observation stream.
