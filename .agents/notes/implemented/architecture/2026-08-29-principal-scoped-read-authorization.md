# Agent Note: Principal-scoped read authorization

Status: implemented

English | [中文](2026-08-29-principal-scoped-read-authorization.zh.md)

## Problem

The [message-scoped principal decision](2026-08-21-message-scoped-authenticated-principals.md) establishes who made one authenticated Host request, but identity propagation does not establish which durable Sessions or Workspaces that identity may read. Session list, search, history and live-control producers can enumerate process-wide or persistence-wide data. Passing `AuthenticatedPrincipal` through those calls without a deployment-owned resource decision would still return another account's data.

Harness cannot derive this decision from `role` or `username`. Both are authentication-provider assertions intended for display or broad policy; neither proves membership in one resource. Harness also does not own the deployment's account, organization or sharing database. At the same time, unconfigured local deployments historically run without authentication and must retain that local-anonymous behavior.

## Decision

`@deepseek-ai/dsh-principal-access` is the Service Definition for Host read authorization. `PrincipalAccessService.resolve` accepts a transport-verified principal and batches of branded Session and Workspace ids, then returns only `readableSessionIds` and `readableWorkspaceIds`. An authenticated deployment mounts one Service Provider that validates the principal's `(source, id)` pair against its authoritative account and membership data. Host API packages are Consumers; they do not import provider-specific account types.

`resolvePrincipalAccess` owns one explicit default matrix. Only a composition with no request-authentication provider, no principal, and no access provider treats every requested id as readable, preserving local-anonymous operation. A principal or request-authentication provider without an access provider fails closed with `provider-required`; this includes an authentication provider that returns no principal for the current request. An access provider without a principal fails closed with `principal-required`. With both principal and access provider present, only ids returned by the provider are readable. `requirePrincipalAccess` converts omission of one exact discriminated Session or Workspace subject into `PrincipalAccessDeniedError` with stable code `PRINCIPAL_ACCESS_DENIED` and reason `subject-denied`.

The result is a pair of sets rather than a resource-by-resource boolean API. Consumers can authorize one candidate corpus lookup and preserve their own order and pagination. The Service Definition trusts the provider at the typed same-process boundary; the provider owns database and principal-source validation and must never grant from display `username` or asserted `role` alone.

### Session reads

Session Controller captures the API Gateway principal once at unary invocation or stream opening. Every Remote operation that names an existing Session applies the same readability check before reading, resuming or mutating it. `session.list` authorizes candidate ids before summary projection and cold-artifact probes. `session.search` restricts candidates before content lookup and ranked pagination, so denied results neither leak nor consume the response limit. Page, attachment and skill reads authorize before observing a log; a direct-subagent address authorizes its ordinary parent Session and then retains the independent durable parent-child validation. File-reference completion authorizes the wire Session id before resolving or resuming its Agent.

`session.follow` authorizes before observing the log and again before each frame, so a revocation prevents the next frame from being published. `session.control` filters all three maps in its opening baseline and resolves each later Session-addressed frame before yielding it. Authorization is therefore applied to both initial state and live events; filtering only the baseline would leak later global queue, job or projection updates.

### Workspace reads

Workspace Controller captures the Gateway principal when `workspace.follow` opens. Its baseline filters Workspace rows by Workspace access, each row's Session membership by Session access, and archived Session ids by Session access. Later upserts and archived snapshots resolve access again; an upsert for a previously visible but newly denied Workspace becomes a `remove`, while order and removal frames name only Workspaces already disclosed in that stream generation.

Workspace mutations require readability of every existing Workspace, Session and ordering anchor before writing. Read-bearing mutation results filter Workspace membership, global order and archive sets to the caller's readable ids. Resolving an already registered path hides a denied Workspace; creating a genuinely new Workspace has no existing subject and therefore only validates that the principal/provider composition is complete. Directory admission and ownership assignment remain deployment policy.

### Session-log export

The exact `/api/session.export` Fetch route receives the transport principal and authorizes the root Session before tracing its lineage. When descendants are requested, it authorizes the complete descendant set before flushing or reading any raw artifact or attachment. Resource denial returns the same not-found response as an absent Session; a principal without a provider returns service unavailable, and a provider-backed request without a principal returns unauthorized. The all-or-nothing check prevents partial archives.

### Forwarded Remote events

API Remotes attaches process-local `readSubjects` to Session Controller notifications from their declared Session argument. Gateway resolves those subjects independently for each connected Client principal and queues the notification only when every named Session or Workspace is readable. Request-attributed ordinary events also require an exact principal match; only notifications with neither attribution nor read subjects are global broadcasts. Neither process-local field enters the Remote event wire frame.

## Alternatives considered

**Propagate the principal without a business authorization service.** This identifies the caller but leaves every global producer free to return all durable data, which is the original exposure.

**Authorize from `role` or `username`.** These fields do not prove resource membership, usernames can change or collide across authentication sources, and a broad role is not an ownership record.

**Put accounts and ownership into Harness core.** Deployments already own different account and sharing models. A core database would duplicate their authority and couple the harness to one tenancy scheme.

**Make every API package define its own provider callback and defaults.** Independent defaults would drift, especially for the provider/principal half-configured cases, and deployment adapters would need several unrelated integrations for one account policy.

**Deny every anonymous local read.** This would secure authenticated deployments by breaking the supported local deployment mode. The default matrix distinguishes an intentionally local process from an incomplete authenticated deployment by also checking whether request authentication is mounted.

## Consequences

The capability has all three roles: a stable Harness Service Definition, deployment-owned Service Providers, and Host API Consumers. Authenticated deployments fail closed when either identity or authorization is missing, while unchanged local-anonymous compositions keep working. Batch results support baseline, filter and descendant-style consumers without embedding account logic in the data services.

The cost is an authorization lookup at each unary candidate batch and each applicable live Session, Workspace or Remote-event frame. The service has no generic revocation event, so an already-open Consumer rechecks subsequent frames but does not proactively terminate while idle. Readability is a necessary resource-visibility precondition on Session and Workspace mutations, not permission to perform the verb; deployment and command capabilities still own mutation authorization.

Focused tests pin the local and incomplete-authentication defaults, provider delegation, exact Session and Workspace denial, cancellation, pre-observation Session filtering, follow revocation, Session command gates, Workspace feed and mutation filtering, all-or-nothing export authorization, and per-Client Remote-event delivery. Package type checking pins the branded cross-package API.
