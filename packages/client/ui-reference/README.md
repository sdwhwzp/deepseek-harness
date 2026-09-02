---
description: "Web workspace-file @ reference source for the composer: current-workspace candidates, directory drilling, and atomic inline file references."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-reference

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-reference` is the Web workspace-file `@` reference source: it registers the `reference` entry in the composer's inline-suggestion machinery so typing `@` lists files and folders beneath the current session's workspace. Each row carries only what distinguishes it: a file names its parent directory and nothing at the workspace root, while a drilled directory listing names none because its breadcrumb already does. A pick inserts an atomic file or folder reference whose hidden serialized and clipboard form is the natural text the shared `@path` grammar defines; a directory row additionally carries a drill verb (Tab or the row's chevron) that keeps plain editable path text and the menu active at its trailing slash so the user can descend another level. The source does not query or display sessions and registers no prompt or tool.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The source is active whenever the composition mounts this package and a Host `ctx.fileReferences` provider is available. Type `@` followed by an unquoted token to search the current workspace, or open `@"…` to preserve quoting while searching paths that contain whitespace. The candidate list is a completion menu, not a search result page: pick once and keep typing.

### What a pick inserts

A file closes completion as an atomic inline reference displayed with a file glyph and business-color filename. A directory row carries two verbs: the settling pick (row click or Enter) resolves the folder itself as the same kind of atomic reference — folder glyph, trailing-slash label, canonical `@dir/` mention as its serialized form — while the drill action (Tab or the row's chevron) keeps plain editable path text with a folder glyph and the menu active at its trailing slash, so you can descend another level. Paths containing whitespace use `@"path with spaces"`, and a quote the user opened explicitly remains quoted.

### Failure behavior

An unavailable or failed file lookup yields no candidate rows. The browser does not scan its own filesystem as a fallback.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The source keeps candidate encoding internal to the registration effect: the `/client` export is the plugin body (`apply`/`inject`) only.

### Candidate flow

The browser calls `fileReferences/list` with the current session id, and the Host resolves candidates beneath that session's `cwd`. Rows render under one non-selectable file section without a redundant raw `reference` source title. A drilled query publishes a breadcrumb from the workspace root to the directory being listed; each crumb carries the drill payload a folder row would, so returning to a step and descending into one are one outcome.

### Serialization

File picks preserve the natural text defined by the shared `@path` grammar as the hidden serialized and clipboard form.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the suggestion machinery, the file-reference capability, and the input pipeline.

- [ui-input-trigger](../ui-input-trigger/README.md) — the inline suggestion machinery the source registers into.
- [file-reference](../../context/file-reference/README.md) — the `@file` seam and its provider contract.
- [Web input machine and slash pipeline](../../../.agents/notes/implemented/architecture/2026-07-25-web-input-machine-and-slash-pipeline.md) — how references and commands share the input machine.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the Host-owned file-reference provider that supplies the path guidance this package delegates to it.

#### KV Cache effect

Candidate browsing has no model effect. A selected file changes only the new user-message suffix; its contents remain behind the model-facing `read` tool.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the reference source cannot help; they are current package constraints.

- **Candidate failure is intentionally quiet** — an unavailable or failed Remote discovery call yields no rows.
- **No browser-side file scan** — Web completion requires a mounted Host `ctx.fileReferences` provider; the browser cannot fall back to its own filesystem.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. A single reference/input-trigger source registration whose disposal is proven by the HMR-safety spec — it emits no cordis events and owns no cross-plugin mutable state.
