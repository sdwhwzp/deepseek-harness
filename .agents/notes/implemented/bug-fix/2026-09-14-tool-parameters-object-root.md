# Agent Note: Object-rooted tool parameters at registration

Status: implemented

English | [中文](2026-09-14-tool-parameters-object-root.zh.md)

## Problem

A model request carries every registered tool in one `tools` array, so one unusable parameters schema fails the whole turn, not just its own tool. An MCP server advertised `dast_flight_happy` with a root `oneOf` spelling "pass either the flight number or the city pair" beside its `type: "object"`. The bridge forwarded that root verbatim, and every turn in that deployment ended with `tools.58.custom.input_schema: input_schema does not support oneOf, allOf, or anyOf at the top level` — no tool call, no answer, and nothing in the message naming which of the 59 tools was at fault.

## Decision

`ToolRuntime.register()` asserts the parameters root through `assertToolParametersRoot`: the schema must be a record with `type: "object"` and must not declare `oneOf`, `anyOf`, `allOf`, or `not`. Tool arguments are always one JSON object, so a union or negation at that root has nothing to range over; the assertion names the offending tool and keyword at registration instead of at the provider.

Only the root is checked. Property schemas keep whatever vocabulary the author or server used — a bridged `anyOf: [{type: 'string'}, {type: 'null'}]` is ordinary MCP output and providers accept it below the root.

`dsh-mcp-client` normalizes before it registers, because the offending schema comes from another party. It drops exactly the keywords the registry rejects, shares the list as `PARAMETERS_ROOT_COMPOSITION_KEYWORDS` so the two sides cannot drift, and logs the server and tool name. The server still enforces the constraint on `tools/call`; what the drop costs is the model's advance knowledge of it.

## Alternatives considered

**Normalize in the provider adapter instead.** The limit reads as a Claude one, but the root of a tool-parameters schema is an arguments object under every tool-call API, so a root union is meaningless everywhere and silently ignored where it is not rejected. Putting the rule in one adapter leaves the other routes serving a schema the model cannot satisfy.

**Reject the offending MCP tool at sync.** `syncTools` fails a generation as a whole, so one bad schema would take down the other eight tools of a working server — a strictly worse outcome than a looser schema for one tool, and one the deployment cannot fix from its own side.

**Validate bridged schemas against the enforced harness subset.** `assertSupportedJsonSchema` rejects `format`, `$ref`, `default`, and nested `anyOf`, which nearly every real MCP server emits. It is the right gate for schemas this repository authors and the wrong one for schemas it relays.

**Leave registration unchecked and fix only the bridge.** MCP is not the only source of a raw `parameters` record — dynamic `cordis_define` packages register their own. The registry is where the invariant holds for all of them.

## Consequences

A tool whose parameters root is not an object now fails loudly at registration, with the tool name and keyword in the error. In-repo tools built through `defineTool` always satisfy it. An MCP server that advertises a root composition keyword keeps all of its tools, loses that one constraint from the model-facing schema, and produces one warn line per affected tool per sync. Unit coverage pins the registry rejection for each keyword and the non-object root, and pins the bridge on the real `dast_flight_happy` root — stripped at the root, untouched in a property `anyOf`.
