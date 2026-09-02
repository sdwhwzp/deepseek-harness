# Agent Note: Tool-result image display on text-only routes

Status: implemented

English | [中文](2026-08-26-tool-result-image-display.zh.md)

## Problem

`read_image` produced a durable `ImageBlock`, but a model route without declared image input prevented the tool from reading the file. The Web conversation rendered image blocks only in user and assistant messages, so other successful Tool results exposed a path or durable reference without displaying the pixels. Model input modality and conversation presentation are separate responsibilities.

## Decision

Image-bearing Tool results are durable conversation content independently of the current model's input modality.

- `read_image` remains conditional on the durable attachment service, a supported PNG/JPEG/WebP/GIF source, and deployment image limits. It saves the image and appends the standard text-and-image Tool result under image-capable, text-only, unknown, and unresolved model routes. A path without an extension retains content-signature detection.
- `ToolCallTree` extracts standard image blocks from each settled root and nested Tool result and renders them directly below the owning Tool row. `read_image` uses the existing read-row presentation.
- Tool-result images use the conversation-owned historical image renderer with `start` alignment. The attachment presentation plugin remains responsible for session-authorized loading, shared per-session object-URL caching, thumbnail sizing, retry behavior, and the original-image lightbox.
- Model request projection remains authoritative for modality. Image-capable routes receive request pixels; exact text-only routes receive the stable attachment placeholder while the event log and Web preview retain the image reference.

The default Web composition displays a generated or filesystem image in the conversation after `read_image`, even when the active model is text-only. Any other Tool that appends standard image blocks receives the same presentation for root and nested calls.

## Alternatives considered

**Keep the strict execution gate.** This avoids an image result the model cannot inspect, but also suppresses a valid durable artifact that the user can inspect. Request projection already prevents unsupported pixels from reaching a text-only model.

**Return only the filesystem path and ask the user to open it outside the conversation.** A host path is not remotely portable, session-authorized, or visible in resumed Web history. It also does not provide the requested inline interaction.

**Let the Web client load the local filesystem path directly.** The browser cannot safely or consistently read an arbitrary host path, and such a URL would bypass durable attachment authorization and integrity checks. Rendering the logged attachment reference reuses the existing authorized path.

**Add a `read_image`-specific UI component.** Image blocks are part of the standard Tool-result content vocabulary and may come from root calls, Code Dispatch children, MCP tools, or later image producers. Rendering by content type keeps presentation independent of the producing Tool name.

## Consequences

- A text-only model cannot inspect the pixels and sees the deterministic placeholder, but the user can preview and open the durable image in the same conversation.
- Repeated image reads add durable history and request cost on later image-capable routes; content addressing deduplicates stored bytes, not message occurrences.
- A composition without the optional attachment presentation plugin keeps the durable result but renders no gallery. The default Web bundle includes the plugin.
- Root and nested Tool results use the same authorized loader, per-session cache, and lightbox as user and assistant history, so no filesystem URL or base64 payload enters the client rendering interface.
