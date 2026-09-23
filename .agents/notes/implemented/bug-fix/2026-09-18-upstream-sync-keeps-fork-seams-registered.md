# Agent Note: an upstream sync re-registers every fork seam the merge base no longer names

Status: implemented

English | [中文](2026-09-18-upstream-sync-keeps-fork-seams-registered.zh.md)

## Problem

Merging `deepseek-ai/deepseek-harness` master (0.1.6-alpha.1 → 0.1.6-alpha.2, 882 commits) into this fork's `dev` produced 38 conflict files, but the conflicts were not where the fork lost behavior. Two fork features had already vanished in the previous sync while their tests stayed behind: `mcp-client` no longer rendered `structuredContent` into the model text (`modelText` was dropped when `tools.ts` was rebuilt on the upstream file), and the `conversation.input.bootstrap` slot dsh-passwords registers into was declared but never rendered after upstream replaced `ConversationRoot.tsx`. Both test files still asserted the old behavior; nobody ran them because the full suite was skipped.

This sync also met a new upstream generator gate: `gen-tool-catalog` boots every tool plugin, and `browser-use-stagehand-native` derives its `tabs` input from a Zod discriminated union, which `z.toJSONSchema` emits as a root `anyOf`. The fork's `assertToolParametersRoot` refused it, the plugin registered no tools, and the catalog failed — the same schema Anthropic would reject at request time, now caught at registration.

## Decision

Every seam this fork owns is re-registered wherever upstream introduced a new registration surface, and its tests run before the merge is called done:

- `createMcpToolDefinition` normalizes the parameters root itself (`bridgedParameters`), so the MCP bridge and native plugins that build definitions from generated JSON Schema register the same root a model provider accepts. The bridge no longer normalizes separately.
- `conversation.input.bootstrap` is declared in the `SlotMap`, listed among the `conversation.content` factory children, and rendered inside the Hero control row after `conversation.hero.agentPreset`; the row carries `data-hero-controls` so a test can prove the row is absent for an active transcript without relying on slot calls, which the row's elements issue before the phase decides to mount them.
- `modelText` is restored: content text first, then `structuredContent` as compact JSON unless a text block already echoes it.
- The deliverables change-summary, comparison, and changed-file open routes check principal access to the viewed Session before reading, and open through the typert gateway with that principal, matching the existing presented-file route.
- The Connection `/api` route wraps the principal-bound bridge in upstream's `connection/request` waterfall, so admission listeners and the verified principal coexist.
- `requestPrincipal` is classified for the catalog and graph generators; `ConnectionPrincipalRequest` and `ConnectionRequestAuthorization` are exempted type links owned by `packages/client/connection/src/rpc.ts`.

## Alternatives considered

- **Keep `bridgedParameters` at the MCP call site and special-case stagehand in the catalog manifest.** Rejected: every consumer of `createMcpToolDefinition` faces the same provider rejection; one normalization point keeps the guarantee where the definition is built.
- **Relax `assertToolParametersRoot` to let a root `anyOf` through.** Rejected: the 400 it prevents fails the whole model request, not one tool, and the previous incident is recorded in [the parameters-root note](2026-09-14-tool-parameters-object-root.md).
- **Re-add the fork's `data-conversation-view` width-handle rule.** Rejected: upstream's width controls already render handles only for an active transcript, and no source ever set the attribute; the rule and its two assertions were dead since the previous sync and were removed.

## Consequences

- A fork sync is complete only after the affected packages' tests pass: `connection`, `ui-conversation`, `ui-deliverables`, `session-controller`, `ui-workflow-run`, `app-boot`, `tools`, `mcp-client`, `ui-commands`. Tests kept while their implementation is lost are the signature of a dropped seam.
- `packages/mcp/mcp-client/tests/mcp-client.spec.ts` fixes root normalization for a native definition; `packages/client/ui-conversation/tests/skeleton.client.spec.tsx` fixes the Hero row order and its absence in an active transcript; `packages/client/ui-deliverables/tests/changes-open.host.spec.ts` opens through the gateway stub.
