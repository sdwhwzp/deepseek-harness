# Agent Note: Web workspace-file references and session recall

Status: implemented

English | [中文](2026-07-27-web-file-and-session-references.zh.md)

## Problem

The Web composer had a reusable slash/reference trigger pipeline, but its `@` source was inert subagent-label text. Web needed Host-backed workspace-path discovery without scanning the Host filesystem in the browser. The Host also needed a separate structured cross-session snapshot capability that did not bind session identity to a display label.

## Decision

Web exposes a workspace-file-only `@` menu through `@deepseek-ai/dsh-client-ui-reference`. Every query calls the generated `fileReferences/list` Remote method with the current session id; the Host resolves that id to the agent whose `cwd` bounds discovery. Locale-registered file and folder labels appear under one non-selectable section heading without entering the keyboard-selection index, and the source suppresses its raw group title through loading and settled states. The menu does not call `sessionReferenceResolver/candidates` or offer Session rows. A failed file lookup yields no candidates.

The file capability follows the three-package seam: `@deepseek-ai/dsh-file-reference` owns `ctx.fileReferences`, the shared `@path` token grammar, candidate shape, and stable model guidance; `@deepseek-ai/dsh-file-reference-local` owns bounded per-agent Host-filesystem indexes, invalidation, and scoped prompt installation; `dsh-client-ui-reference` consumes the generated Remote namespaces and shared grammar. A file pick is an atomic composer reference with a file glyph and filename; its serialized form remains path-only prompt text. A directory stays editable path text with a folder glyph and retriggers completion below its trailing slash.

Cross-session recall remains a separate Host capability. A supported text client can send the canonical `@[label](dsh-session:…)` mention produced by the Host, but the Web `@` menu does not discover or create it. The session-reference service parses accepted direct user messages at `agent/pre-step`, captures every source, replaces the canonical mention with readable text while preserving the direct message id, and inserts the frozen snapshot immediately after that message. Web renders the recalled-context row with the chat glyph while other context keeps the document glyph. The API Proxy contains no reference-specific route, dependency, or error code.

The input machine keeps ordinary draft text and atomic file references until the default sink reports Host acceptance. Its session-store mirror persists each occurrence's canonical clipboard projection, so remounting without the occurrence table retains a parseable path instead of a display-only label. Serialization or prompt transport failure returns the same draft to editing. The logged prompt remains the replay authority. The chat continues to render durable direct-message-then-recall order for accepted cross-session mentions, associates exact session labels only from the immediately following sourced recall, and keeps snapshot JSON behind the collapsed recall row. File references retain their icon-and-text decoration, including extensionless basenames, while sentence punctuation stays outside the reference range.

## Reference transaction

```text
type @ → file-reference Remote call → pick folder text or atomic file reference
       → serialize draft → ordinary session.prompt enqueue

canonical session mention from a supported text client
       → agent/pre-step parses mention → capture source → readable prompt + context
```

File lookup is advisory and cancellable; selection itself performs no read. Session preparation is all-or-nothing for one accepted model step. A queued message captures each source when the message is claimed, so queue edits and queue-to-steer relocation use the same path without gateway coordination.

## Alternatives considered

**Implement file discovery and grammar inside the Web client.** Rejected because browser-side code cannot safely access the Host workspace, while duplicating grammar, ranking, bounds, and invalidation would drift from the Host provider.

**Scan files through ordinary filesystem-tool RPCs.** Rejected because recursive fuzzy discovery is editor latency work, not a model-facing exact filesystem operation, and would couple the menu to tool policy and provider round trips.

**Eagerly attach selected file contents.** Rejected because selection would spend context before relevance is known and bypass the logged, auditable `read` call/result sequence.

**Represent sessions as plain `@label` text.** Rejected because labels are neither stable nor unique and cannot identify the source snapshot. Canonical Host-produced mentions preserve opaque session identity while keeping a readable display.

**Clear the composer before prompt admission settles.** Rejected because a transport or admission failure would lose the only editable copy of the request and visually claim acceptance that never occurred.

## Verification

Package tests pin shared file grammar and ranking, cache invalidation and lifecycle cleanup, workspace-scoped Web lookup, quoted paths, candidate failure, cancellation, source-title suppression through pending and ready states, file/directory continuation, structured file references, complete inline labels, file glyphs, disabled-layer ownership, canonical draft persistence across remount, adjacent-reference and adjacent-text projection, extensionless file and sentence-punctuation rendering, codec round-trip, generated Remote type inference, direct-before-recall pre-step preparation, downstream rejection, and following-recall association for multi-word and consecutive session labels. The keyless assembled Web snapshot renders only the workspace-file section without the raw source title, selects a file through the real client composition, excludes Session candidates, and replays an existing multi-word session recall in direct-before-recall order.

## Consequences

Web uses the shared `@file` discovery seam while the Host remains the authority for filesystem access. File discovery is a unary Remote contract on its owning service, so generated client types replace handwritten RPC interfaces and the browser bundle remains free of Node APIs. Candidate lookup failures remain quiet menu degradation. File references cost only path text plus stable conditional guidance. Cross-session references retain the bounded snapshot cost and trust framing owned by `dsh-session-reference`, but Web users do not encounter them in `@` completion.
