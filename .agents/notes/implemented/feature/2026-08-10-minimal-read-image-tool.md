# Agent Note: A minimal read_image tool over existing seams

Status: implemented

English | [中文](2026-08-10-minimal-read-image-tool.zh.md)

## Problem

The multimodal attachment work gave user uploads a complete durable path, but the model itself had no way to inspect an image on disk. `read` rejects binary content by contract, so an agent asked about a screenshot or rendered chart either failed or used a lossy workaround. A standalone attempt in PR #598 combined the tool with loop-level route scoping, per-route schema visibility, and new session-log concepts. Those features were not required to publish a logged image tool result.

## Decision

Both image-reading operations live in `dsh-tool-fs` and publish ordinary logged tool results over existing extension points.

- **`read_image` reads a filesystem path.** Extension selects the declared PNG/JPEG/WebP/GIF media type; the attachment store's magic-byte and pixel validation stays authoritative. Bytes travel `ctx.fs.stat` → bounded `ctx.fs.readBytes` → `ctx.attachments.saveImage` → `fs/observed`. The tool result contains metadata and an `ImageBlock`.
- **`FileSystem.readBytes(target, signal, maxBytes)`** is a new required provider primitive: the byte bound lives at the seam so no backend can buffer an unbounded file, with the stat-size short-circuit and a one-byte-past-cap stream guard against post-stat growth (`FS_TOO_LARGE`).
- **Registration is composition-conditional, and execution is independent of the model route.** The tools register only under `ctx.inject(['attachments'], …)`. The durable result remains user-visible under every route, while the shared LLM runtime projects its image to a deterministic placeholder for a text-only request. The [Tool-result image display decision](2026-08-26-tool-result-image-display.md) owns the presentation and modality split.
- **PTC mode forwards the image out-of-band**: a nested dispatch returns the canonical value (execution-local, no image block) and defers a `user`-role context message carrying the envelope and image, so the picture still reaches the next request.
- **llm-replay models may declare `inputModalities`**, which lets keyless snapshots cover image-capable delivery and text-only request projection.

## Alternatives considered

- **PR #598's route-scoped design** used a request-ready extension point, per-route schema visibility, reversible projection, and three durable concepts. Shared LLM request projection now handles text-only routes without putting tool registration or session formats into agent-loop.
- **`agent.inject()` instead of the image-bearing tool result** — routes the image around the tool result as a separate injected user message. Rejected: the image *is* the tool's result; splitting them adds a second logged message with no gain, and the tool-result path already works end to end.
- **Magic-byte sniffing instead of extension declaration** — sniffing duplicates detection the attachment store already owns (sharp-backed, authoritative). The extension is only a *declaration*; a mismatch fails closed with a rename remedy rather than being silently accepted, which also keeps the model's mental map (file name ↔ content) honest. This rejection covers extension-bearing paths; [extension-less image paths](../bug-fix/2026-08-28-read-image-extensionless-paths.md) narrows it — a path that declares nothing is identified from its file signature.
- **Registering unconditionally and failing on a missing store** — rejected; a deployment without an attachment store cannot ever satisfy the tool, so its schema would be a standing lie. Model modality is not an execution prerequisite because the durable result also serves user-visible history.

## Consequences

- The tools succeed on a text-only route, while that route represents the image with a request-local placeholder.
- Repeated image results accumulate request cost until request projection or compaction removes them; content addressing deduplicates durable bytes.
- The Web Tool-result card renders the image through the session-authorized attachment loader and shared lightbox.
