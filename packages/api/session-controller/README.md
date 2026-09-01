---
description: "Host and Client session control: create, resume, prompt, follow history, and project live session state."
kind: "package-reference"
---
# Session Controller

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-api-session-controller` owns the Host `ctx.sessionController` service and the generated Client `session`, `skills`, and `fileReferences` Remote namespaces. It serves Session lifecycle and history, the Host-generation model catalog, workspace-path opening, user-invocable skill discovery, and the adapter for Agent-scoped file references. Use it through API Gateway when a Client needs operations addressed by a Session.

## Table of Contents

- [Use this package](#use-this-package)
- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

History pages and follow opening snapshots carry a discriminated `SessionHistoryRecord`. Both variants use `{ type, event }`: `type: 'event'` carries one raw `SessionWireEvent`, while `type: 'chunks'` carries one lossless `ChunkRowEvent` for consecutive same-block `assistant/chunk` deltas. Both inner values expose `type`, `seq`, `time`, and `data`, so the Client retains each accepted record as one `SessionEventLikeEntry` without record-by-record conversion. A packed event's `seq` and `time` identify its first member, and `data` retains the fragment and timestamp-gap arrays. Live follow frames remain individual `event` records. Tool arguments, result content, failures, and `tool/result.data.meta` pass through unchanged; the controller does not resolve a Tool definition, run a presenter, or attach UI data.

Each endpoint states its activation policy. List, search, attachment, history pages, log following, skill discovery, and workspace-path opening can inspect persistence without activating an Agent; `canOpenWorkspacePath()` reports native-opening availability without addressing a Session. Queue mutation and cancellation require live state; model, rename, prompt, and file-reference operations may resolve or resume an ordinary Session. Create and fork are the only operations that create a new Agent directly. The skill catalog instead uses a live Agent when present or the recorded preset's standing scope when cold, so listing never starts an Agent.

`session.prompt` reads the transport-verified principal from the active API Gateway invocation and stores it on the new durable `UserMessage`. Anonymous direct calls leave the field absent; request arguments cannot set it.

Every Remote operation that names an existing Session resolves the same message-scoped principal through `ctx.principalAccess` before reading, resuming, mutating, or opening a path for that Session. List authorizes candidate ids before building summaries or probing cold artifacts, search restricts matches to authorized candidate ids, and page rejects an unreadable ordinary Session or subagent parent before loading its log. Follow checks before loading and again before each frame, so revocation terminates the stream without publishing another frame; control filters both the opening baseline and every live frame. Skill and file-reference catalogs use the same check. `session.openWorkspacePath` therefore requires the owning `sessionId` beside the resolved Host path. Create, model catalog, and the native-opener capability probe do not address an existing Session.

No principal-access provider, request-authentication provider, or principal preserves local-anonymous legacy access. Any authenticated composition missing either the principal-access provider or the current principal fails closed; with both present, the deployment provider validates `(source, id)` against its account data and returns the readable Session ids. This resource-visibility precondition does not replace deployment-specific mutation policy. `username` and `role` alone never grant access.

The Client adapter exposes `SessionEventStream`, a Gateway `RemoteJournalStream` bound to one ordinary or direct-subagent address. It opens follow before the initial page, publishes only contiguous `replace`, `prepend`, and `append` changes, and repairs reconnect or sequence gaps through a tail page. Backwards paging has two verbs: `loadOlder()` pulls one 50-message page, and `loadThrough(seq)` — the turn-jump loader — loops 200-message pages until the window covers the target seq, lowering a shared target on repeated calls, stopping on a page that makes no progress, and reporting busy through the same `loadingOlder` snapshot bit. Ordinary records cover `[event.seq, event.seq]`; packed rows cover `[event.seq, event.seq + memberCount - 1]`. A business, persistence, or unresolved continuity failure terminates the stream, while only physical carrier loss selects automatic resumption. `SessionControlStream` is a Gateway `RemoteSnapshotStream`; every generation opens with a complete process-local baseline, so reconnect replaces queue, jobs, and projection state instead of treating transient values as durable events.

The Session object also carries local submission echoes: `session.beginSubmission` inserts one into `SessionSnapshot.pendingSubmissions` synchronously, before the caller serializes and prompts, so a conversation UI can show the message on the submit click's own frame. Session derives each echo's `transcript`, `queued`, or `steering` placement from its current running state and the requested delivery mode, then retains that placement while serialization is in flight. The prompt's `requestId` is the correlation identity: the Host echoes it as the durable user source's `rpcId`, and queue occurrences project it as `SessionQueuedItem.rpcId`. An echo retires one animation frame after its durable event or queue occurrence is observed (the delay keeps it renderable until the replacement is ready), immediately when its identified prompt fails or is abandoned, and as failed on disposal; each retirement fires the registered `onRetire` callback exactly once. Echoes are Client memory only; reload and reconnect rebuild the conversation from durable events alone.

-----

<a id="configuration"></a>
## Configuration

| Field | Default | Meaning |
|---|---:|---|
| `coldBlankProbeMaxBytes` | `1,024` | Maximum physical size of a cold Session artifact eligible for blankness verification; `0` disables probes |
| `nativeOpen` | platform-detected | Whether Session workspace paths can be handed to a native desktop opener |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-api-session-controller) is the exhaustive source for accepted fields and their JSDoc.

-----

<a id="model-experience"></a>
## Model Experience

None, as invoked Agent commands own any model-visible effect.

#### KV Cache effect

No direct effect; model requests remain owned by the Agent and LLM packages.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Control baselines represent process-local state and therefore cannot reconstruct jobs after a Host restart.
- A failed follow resumption remains visible to the caller instead of retrying indefinitely.
- File-reference completion can resume an authorized cold Session after its access check; the `skills/list` catalog is the non-activating alternative for skill metadata.


<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
