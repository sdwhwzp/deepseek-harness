# Agent Note: Principal authorization across the 0.1.3 upstream merge

Status: implemented

English | [中文](2026-09-05-principal-authorization-across-013-upstream.zh.md)

## Problem

Upstream 0.1.3-alpha.1 uses compact Assistant streams, streaming Fetch request bodies, shared command ranking, and Tool image cards. This fork also requires durable message ownership, per-request read authorization, and image display for generic tools and historical results.

Authorization awaits can change when optional Cordis injections complete and can be cancelled before the protected operation begins. A merge that preserves types without checking these execution paths can change projection availability, error codes, or visible output.

## Decision

**Authentication remains request-local.** The shared Fetch handler resolves the principal before route selection and delegates `requestBodyMode` to the registered route. Each RPC request constructs its handler with that principal. Tool execution receives the admitted message principal and inserts generated context ahead of foreign-principal inbox messages. The [message ownership](2026-08-21-message-scoped-authenticated-principals.md) and [read authorization](2026-08-29-principal-scoped-read-authorization.md) decisions retain their authority.

**Authorization participates in the operation's cancellation mapping.** Both subagent catalog reads and prompt delivery map cancellation during parent authorization to `gateway/cancelled`, while preserving explicit `RemoteError` refusals. Session-log export authorizes lineage with the request signal before creating the archive stream. Descendant reads use a derived producer signal; one request cancellation reaches root, lineage, and descendant reads without requiring signal-object identity.

**Fixtures declare composition and event identity explicitly.** Attachment-free Session tests use `omitAttachments` rather than relying on an optional injection being pending. Tool-result fixtures cite their originating call through `sourceEventSeqs`, matching the loop's durable occurrence identity and preventing duplicate Contexts for one call.

**Tool galleries retain both specialized and generic results.** Complete `read_image` cards keep their collapsed `tool.call.images` gallery. The call tree owns a separate `tool.call.result-images` slot for other image-bearing results, including nested calls and historical image reads without card metadata. Both slots use the attachment plugin's existing gallery and the Session-authorized loader. The tree suppresses its gallery when the specialized card accepts the result.

The [Tool-card image decision](../../archived/feature/2026-08-20-tool-card-image-results.md) continues to own specialized card derivation and collapsed presentation. This decision supersedes only its generic-image limitation: a separate tree-owned slot preserves one declaration owner per slot without a React rendering callback in owner props. Shared command ranking uses `rankByName`.

**The model trigger retains confirmed names during reload.** A connection reset clears the model directory before reloading it. During that interval the trigger keeps the last confirmed model and effort names in both visible text and its accessible label. An initial load without a confirmed selection displays loading text.

**Released migration validators preserve stored principals.** The v0-to-v1 edge validates the optional identity on user-role messages, inbox entries, title-request messages, and turn/step starts; its shared payload validator also serves the v1-to-v2 edge. It retains the exact provider, subject id, username, and role, including when removing a legacy turn trigger. Dropping identity to make old logs readable would change message ownership and accounting, so malformed identities still refuse migration. A recorded v0 transcript replay snapshot and complete-chain cases preserve these fields without changing model output or committed source generations.

## Alternatives considered

**Bind the principal when registering the RPC handler.** Registration outlives individual requests, so it cannot capture the authenticated caller of each operation.

**Treat the specialized image card as a complete replacement for generic galleries.** Its validation requires a `read_image` call and card metadata or a supported nested-call fallback. Generic tools and historical results can contain valid image references without those fields.

**Pass a React rendering callback through Tool owner props.** Client UI composition belongs in declared slots. A distinct tree-owned slot preserves that rule and reuses the attachment renderer.

**Show loading text after every connection reset.** This discards an already confirmed label during a transient reload and makes both the model and effort appear to change.

## Consequences

Principal ownership and read authorization remain compatible with compact Assistant settlements and streaming uploads. Generic result images remain visible while complete image cards retain their collapsed presentation; the cost is one additional image slot declaration and attachment registration.

Focused cases cover authorization cancellation and refusal, request cancellation across export reads, explicit attachment-free composition, Tool occurrence identity, root and nested result galleries, image-card deduplication, and the model trigger's visible text plus accessible label during reset. The assembled image-display scenario exercises historical Tool images through the authorized attachment route; its existing image snapshot remains the expected behavior.
