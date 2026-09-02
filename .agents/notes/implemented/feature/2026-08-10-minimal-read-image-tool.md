# Agent Note: A minimal read_image tool over existing seams

Status: implemented

English | [中文](2026-08-10-minimal-read-image-tool.zh.md)

## Problem

The multimodal attachment work gave user uploads a complete durable path, but the model itself had no way to inspect an image on disk. `read` rejects binary content by contract, so an agent asked about a screenshot or rendered chart either failed or used a lossy workaround. A standalone attempt in PR #598 combined the tool with loop-level route scoping, per-route schema visibility, and new session-log concepts. Those features were not required to publish a logged image tool result.

## Decision

Both image-reading operations live in `dsh-tool-fs` and publish ordinary logged tool results over existing extension points.

- **`read_image` reads a filesystem path.** Extension selects the declared PNG/JPEG/WebP/GIF media type; the attachment store's magic-byte and pixel validation stays authoritative. Bytes travel `ctx.fs.stat` → bounded `ctx.fs.readBytes` → `ctx.attachments.saveImage` → `fs/observed`. The tool result contains metadata and an `ImageBlock`.
- **`FileSystem.readBytes(target, signal, maxBytes)`** is a new required provider primitive: the byte bound lives at the seam so no backend can buffer an unbounded file, with the stat-size short-circuit and a one-byte-past-cap stream guard against post-stat growth (`FS_TOO_LARGE`).
- **Registration is composition-conditional, execution is route-independent.** The tools register only under `ctx.inject(['attachments'], …)`. Execution checks the attachment service, file format, and deployment image limits, then persists the image regardless of the current model route. The shared LLM runtime projects the durable image to a placeholder when assembling a request for a text-only route.
- **PTC mode forwards the image out-of-band**: a nested dispatch returns the canonical value (execution-local, no image block) and defers a `user`-role context message carrying the envelope and image, so the picture still reaches the next request.
- **llm-replay models may declare `inputModalities`**, which lets keyless recorded-session snapshots cover image delivery to a visual route and placeholder projection to a text-only route.

## Alternatives considered

- **PR #598's route-scoped design** used a request-ready extension point, per-route schema visibility, reversible projection, and three durable concepts. Shared LLM request projection now handles text-only routes without putting tool registration or session formats into agent-loop.
- **`agent.inject()` instead of the image-bearing tool result** — routes the image around the tool result as a separate injected user message. Rejected: the image *is* the tool's result; splitting them adds a second logged message with no gain, and the tool-result path already works end to end.
- **Magic-byte sniffing instead of extension declaration** — sniffing duplicates detection the attachment store already owns (sharp-backed, authoritative). The extension is only a *declaration*; a mismatch fails closed with a rename remedy rather than being silently accepted, which also keeps the model's mental map (file name ↔ content) honest. This rejection covers extension-bearing paths; [extension-less image paths](../bug-fix/2026-08-28-read-image-extensionless-paths.md) narrows it — a path that declares nothing is identified from its file signature.
- **Registering unconditionally and failing on a missing store** — rejected; a deployment without an attachment store cannot ever satisfy the tool, so its schema would be a standing lie. Model modality does not govern the durable result and remains a request-projection concern.

## Consequences

- A text-only route still commits the image result; the Web conversation renders it while model input contains the request-local placeholder.
- Repeated image results accumulate request cost on image-capable routes until request projection or compaction removes them; content addressing deduplicates durable bytes.
- The Tool-result card renders pixels through the conversation's session-authorized attachment loader, shared cache, and lightbox; see [Tool-result image display](2026-08-26-tool-result-image-display.md).
