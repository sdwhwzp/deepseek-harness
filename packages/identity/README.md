---
description: "The identity package group: deployment principal authorization and anonymous, per-harness-home correlation ids."
kind: "package-group"
---

# identity/ — deployment and anonymous identity

English | [中文](README.zh.md)

## Summary

The identity group defines deployment authorization for principal-scoped Session and Workspace reads and provides one anonymous id per harness home for telemetry, feedback, and DeepSeek requests. Deployments that authenticate callers supply the authorization provider; local single-user compositions keep their existing anonymous access when neither service is mounted.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

<a id="packages"></a>
## Packages

| Package | Role |
|---|---|
| [`anonymous-user-id`](anonymous-user-id/README.md) | Gives every harness home one anonymous id that telemetry, feedback, and DeepSeek requests attach to their records, so records from one installation can be recognized without identifying the user |
| [`principal-access`](principal-access/README.md) | Resolves the Session and Workspace ids a transport-verified principal may read and fails closed for incomplete authenticated composition |

<a id="related-documentation"></a>
## Related documentation

- [Session telemetry subsystem](../../docs/subsystems/session-telemetry.md) — the telemetry feature that carries the id on exports.
- [dsh-llm-deepseek](../llm/llm-deepseek/README.md) — the DeepSeek provider that carries the id on requests.
- [dsh-command-feedback](../feedback/command-feedback/README.md) — the feedback command that names the anonymous installation in its acknowledgement.

<a id="dev-note"></a>
## Dev Note

None.
