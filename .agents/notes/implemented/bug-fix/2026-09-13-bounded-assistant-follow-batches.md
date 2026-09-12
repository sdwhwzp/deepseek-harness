# Agent Note: Bounded Assistant follow batches preserve fresh authorization

Status: implemented

English | [中文](2026-09-13-bounded-assistant-follow-batches.zh.md)

## Problem

A Session follower can remain behind the Agent after generation finishes when every small Assistant frame requires an awaited authorization lookup. A deployment can perform further account checks for each transported frame. Queued text, the durable settlement, and the matching end marker then share the same delayed delivery path. Faster React publication cannot remove work that happens before the Client receives a frame.

Authorization remains necessary while a follower is open: changing account status or Session readability must prevent the next publication. A time-based authorization cache would add a revocation delay. Dropping intermediate frames would instead lose the exact stream indexes and ordering that Client settlement checks require.

## Decision

The [Session Controller](../../../../packages/api/session-controller/README.md) accepts `assistantStreamBatch: true` together with `assistantStream: true`. Its Web adapter requests both. The Host combines only adjacent transient Assistant frames already queued for that follower into an `assistant-stream-batch` response. It does not wait to fill a batch and never moves a durable event across an Assistant frame. Opening baselines, arrival cuts, durable cursors, and committed-before-end ordering keep their existing meaning.

Each batch contains at most 128 frames and its complete serialized JSON, including the envelope and separators, occupies at most 64 KiB of UTF-8. A single frame, including one larger than that byte bound, uses the scalar response. These limits bound one aggregate publication; they do not impose a new size limit on an individual Assistant frame or a bound on the entire follower queue.

The Host applies a fresh principal-access check immediately before publishing each response, including a batch. The batch is one publication unit; constituent frames do not each initiate another lookup. Account gateways retain their current-credential checks when forwarding that unit. No authorization result is cached across publications. The [principal-access decision](../architecture/2026-08-29-principal-scoped-read-authorization.md) remains the authority for resource visibility and incomplete authenticated compositions.

The Client expands every batch member in order through its existing revision, dense-index, and settlement validation. The optimization changes the number of transport envelopes and authorization decisions, not the underlying stream members. Requests without the batch option receive scalar frames; the batch option without Assistant-stream opt-in is invalid. The [embedded-stream decision](../architecture/2026-09-01-v2-embedded-assistant-streams.md) still owns durable attempt evidence, while [frame-coalesced publication](../testing/2026-08-03-opt-in-reasoning-chunk-browser-stress.md) independently bounds rendering work after ingestion.

## Measurement

The component measurement uses the production Session Controller and history follower from source under Vitest, Node.js 22.21.1 on macOS. It is evidence about publication work, not a built-artifact, network, or browser latency result. Concurrent build activity can affect the samples; no timing threshold is adopted.

| Field | Measurement |
|---|---|
| Operation | Deliver the complete synthetic Assistant attempt through the follow iterator, preserving every frame and the durable barrier. |
| Workload | 30 fixed chunks, start and end frames, and one interleaved durable event; an explicit principal-provider gate queues the burst. |
| Entry path | Production `SessionController.follow` and history implementation; only the principal provider is replaced with a controlled 90 ms synchronous wait per check. |
| Clock | Opening snapshot and its two authorization calls are excluded; timing ends after the end frame is delivered and includes operating-system wait rounding. |
| Memory | No retained-memory or peak-memory measurement. |
| Comparison | Three alternating scalar/batch runs use the same workload and preserve the complete output order. |
| Behavior | Timed authorization calls fall from 33 to 4; opening-inclusive counts fall from 35 to 6. Every publication still performs its own check. |

Scalar samples are 3102.60, 3118.87, and 3100.85 ms; batched samples are 409.55, 380.44, and 381.19 ms. Their medians are 3102.60 and 381.19 ms, respectively, an 8.14× component improvement for this deliberately queued workload. This result does not measure sparse traffic, model response time, transport delivery, Client folding, or painting.

## Verification

The [authorization regression](../../../../packages/api/session-controller/tests/assistant-stream-authorization.host.spec.ts) compares complete ordered output for a 1,610-chunk burst with start, durable barrier, and end. Opening-inclusive checks fall from 1,615 to 18. The original scalar implementation fails the bounded-check assertion; the batched implementation passes. This count-based negative control does not depend on host timing.

## Alternatives considered

**Cache successful authorization for a short interval.** This removes repeated lookups but allows a revoked account or resource grant to remain usable until expiry. Batching retains a current decision for each published unit.

**Discard queued deltas once a durable message exists.** The Client needs the matching end marker and exact revision and index sequence to settle an active attempt. Skipping those members can hide a gap or change failed-attempt presentation.

**Only coalesce React updates.** Rendering coalescing operates after receipt and cannot reduce Host or gateway authorization calls. It addresses a separate cost.

**Delay frames until a timer fills a batch.** Artificial collection time makes an otherwise current follower less responsive. Draining only already queued frames amortizes a backlog without adding a wait to sparse traffic.

## Consequences

A slow authorization provider pays once per bounded publication rather than once per constituent frame when a backlog is available. Revocation between publications denies the next complete batch; it cannot retract members of a batch whose authorization has already succeeded. Sparse traffic can remain scalar and therefore receives no batching gain.

Durable Session data, model-visible content, tool results, and the order of transient evidence remain unchanged. Client parsing and folding still process every original member. This change does not remove synchronous database latency, guarantee browser paint latency, or cap total follower backlog.
