# Agent Note: MCP structured content reaches the model text

Status: implemented

English | [中文](2026-09-12-mcp-structured-content-model-text.zh.md)

## Problem

`@deepseek-ai/dsh-mcp-client` renders the model-visible text of a tool result from the `content` blocks only. The MCP specification lets a server with an `outputSchema` return its payload in `structuredContent` and asks it to echo the same JSON in a text block for older clients. Servers in production skip that echo: the variflight flight-data server answers `getFlightList` with `content: [{ text: "Flight list: 11 item(s)" }]` and the eleven flights in `structuredContent`. The canonical value stored in the session log carried both halves, but the model read only the summary line and could not answer the question it had just asked a tool.

## Decision

`render()` and the image-projection fallback produce the model text through one function, `modelText`: the projected `content` text, then `structuredContent` as compact JSON, unless a text block already parses to a value deep-equal to the structured one. An empty `content` array with a structured value renders the JSON alone instead of the "returned no model-visible content" diagnostic. The canonical value is unchanged; the projection is a pure function of it, so replay from the session log reproduces the same text and no new session event is needed.

Compact JSON keeps the token cost to the payload itself. The deep-equal check, not a string comparison, recognizes a spec-compliant echo that the server pretty-printed.

## Alternatives considered

- **Leave the projection as is and ask servers to echo.** Rejected: the harness cannot fix third-party servers, and a model that cannot see a tool's data is a failed tool call from the user's point of view.
- **Render only `structuredContent` when present, dropping the summary text.** Rejected: the summary line is often the human-readable framing the server intends, and a text block may carry information the structured half lacks.
- **Pretty-print the JSON.** Rejected: indentation multiplies tokens on large collections for no gain in model comprehension.

## Consequences

- A tool whose server returns structured output without a text echo now costs the payload's tokens per call; before the change it cost only the summary and returned nothing usable.
- `finalizeContent` keeps comparing the fallback it recorded at execution time, so image projections still apply only when the rendered text matches.
- Tests in `packages/mcp/mcp-client/tests/mcp-client.spec.ts` (`structured content projection`) fix the three cases: appended, echoed, and structured-only.
